import { fileURLToPath } from 'node:url';
import { Command, CommanderError } from 'commander';
import { CmemmovError } from './core/error.js';
import { Output } from './ui/output.js';
import { VERSION } from './version.js';

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

  program
    .command('export')
    .description('Export your Claude Code environment to a bundle file')
    .action(async () => {
      const { run } = await import('./commands/export.js');
      await run();
    });

  program
    .command('import')
    .description('Import a bundle onto this machine')
    .action(async () => {
      const { run } = await import('./commands/import.js');
      await run();
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

  program
    .command('rollback')
    .description('Restore the most recent pre-import backup')
    .action(async () => {
      const { run } = await import('./commands/rollback.js');
      await run();
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
