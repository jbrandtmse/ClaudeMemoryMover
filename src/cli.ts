import { fileURLToPath } from 'node:url';
import { Command, CommanderError } from 'commander';
import { CmemmovError } from './core/error.js';
import { Output } from './ui/output.js';
import { VERSION } from './version.js';

interface GlobalCLIOpts {
  silent?: boolean;
  json?: boolean;
  dryRun?: boolean;
}

interface ExportCLIOpts extends GlobalCLIOpts {
  categories?: string;
  output?: string;
  includeCredentials?: boolean;
  includeSessions?: boolean;
  allProjects?: boolean;
  projects?: string;
  projectPath?: Record<string, string>;
}

interface ImportCLIOpts extends GlobalCLIOpts {
  mode?: string;
  integrityCheck?: boolean;
  remap?: string[];
}

interface RollbackCLIOpts extends GlobalCLIOpts {
  backup?: string;
}

function parseProjectPath(val: string, prev: Record<string, string>): Record<string, string> {
  const eqIdx = val.indexOf('=');
  if (eqIdx < 1) return prev;
  const slug = val.slice(0, eqIdx);
  const path = val.slice(eqIdx + 1);
  return { ...prev, [slug]: path };
}

function parseRemap(val: string, prev: string[]): string[] {
  return [...prev, val];
}

export function buildProgram(): Command {
  const program = new Command();

  program
    .name('cmemmov')
    .description('Migrate, backup, and share your Claude Code environment across machines')
    .version(VERSION, '-V, --version', 'print version')
    .option('--silent', 'suppress interactive prompts (requires --categories and other flags)')
    .option('--json', 'emit JSON on stdout instead of human-readable output')
    .option('--dry-run', 'simulate writes without touching the filesystem')
    .exitOverride();

  const exportCmd = program
    .command('export')
    .description('Export your Claude Code environment to a bundle file')
    .option('--categories <list>', 'comma-separated categories (camelCase or kebab-case; or "all")')
    .option('--output <path>', 'output file path (default: claude-export-YYYY-MM-DD.cmemmov in cwd)')
    .option('--include-credentials', 'include credentials in bundle (emits warning)')
    .option('--include-sessions', 'include session history in bundle')
    .option('--all-projects', 'include all projects without prompting')
    .option('--projects <list>', 'comma-separated project slugs, or "all"')
    .option(
      '--project-path <spec>',
      'provide originalPath for a memory-only project (slug=path)',
      parseProjectPath,
      {} as Record<string, string>,
    );

  exportCmd.action(async () => {
    const allOpts = exportCmd.optsWithGlobals<ExportCLIOpts>();
    const { run } = await import('./commands/export.js');
    await run(allOpts);
  });

  const importCmd = program
    .command('import')
    .description('Import a bundle onto this machine')
    .argument('<bundle>', 'path to the .cmemmov bundle file')
    .option('--mode <spec>', 'merge|overwrite|overwrite=<category>', 'merge')
    .option('--no-integrity-check', 'skip bundle checksum verification')
    .option(
      '--remap <spec>',
      'remap prefix for cross-OS import: "source-prefix=target-prefix" (repeatable)',
      parseRemap,
      [] as string[],
    );

  importCmd.action(async () => {
    const bundlePath = importCmd.args[0] ?? '';
    const allOpts = importCmd.optsWithGlobals<ImportCLIOpts>();
    const { run } = await import('./commands/import.js');
    await run(bundlePath, allOpts);
  });

  program
    .command('fix-paths')
    .description('Re-associate project slugs with new repository locations')
    .action(async () => {
      const { run } = await import('./commands/fix-paths.js');
      await run();
    });

  program
    .command('share')
    .description('Export a sanitized bundle for sharing with a team')
    .action(async () => {
      const { run } = await import('./commands/share.js');
      await run();
    });

  const rollbackCmd = program
    .command('rollback')
    .description('Restore the most recent pre-import backup')
    .option(
      '--backup <path>',
      'restore a specific backup directory instead of the most recent',
    );

  rollbackCmd.action(async () => {
    const allOpts = rollbackCmd.optsWithGlobals<RollbackCLIOpts>();
    const { run } = await import('./commands/rollback.js');
    await run(allOpts);
  });

  program
    .command('completion')
    .description('Generate shell completion scripts (bash/zsh/fish/pwsh)')
    .action(async () => {
      const { run } = await import('./commands/completion.js');
      await run();
    });

  return program;
}

export async function main(argv: string[] = process.argv): Promise<void> {
  const jsonMode = argv.includes('--json');
  const out = new Output('cmemmov', { json: jsonMode });
  const program = buildProgram();

  function reportError(err: CmemmovError, exitCode: 1 | 2): void {
    out.error(err);
    if (jsonMode) {
      out.finish('', false);
    }
    process.exitCode = exitCode;
  }

  try {
    await program.parseAsync(argv);
  } catch (err) {
    if (err instanceof CommanderError) {
      if (err.exitCode === 0) {
        process.exit(0);
      }
      reportError(new CmemmovError({ code: 'INTERNAL', hint: err.message }), 2);
      return;
    }
    if (err instanceof CmemmovError) {
      reportError(err, err.exitCode);
      return;
    }
    reportError(new CmemmovError({ code: 'INTERNAL', cause: err }), 2);
  }
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] !== undefined && process.argv[1] === __filename) {
  void main();
}
