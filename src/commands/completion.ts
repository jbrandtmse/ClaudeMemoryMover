import { basename } from 'node:path';
import { CmemmovError } from '../core/error.js';
import { Output } from '../ui/output.js';

export interface CompletionOpts {
  silent?: boolean;
  json?: boolean;
  dryRun?: boolean;
}

// Single source of truth for the per-subcommand flag inventory. All four
// shell-script builders consume this constant so the four scripts cannot
// drift. If a new flag is added to a subcommand in src/cli.ts, update here.
// Tests in completion.test.ts assert every key and every flag appears in
// every emitted script body — those tests will fail if anything is missing.
const COMMANDS_AND_FLAGS = {
  export: [
    '--categories',
    '--output',
    '--include-credentials',
    '--include-sessions',
    '--all-projects',
    '--projects',
    '--project-path',
  ],
  import: ['--mode', '--no-integrity-check', '--remap'],
  'fix-paths': ['--remap'],
  share: [
    '--categories',
    '--output',
    '--include-credentials',
    '--include-pattern',
    '--exclude-pattern',
  ],
  rollback: ['--backup'],
  completion: [],
} as const;

const GLOBAL_FLAGS = [
  '--silent',
  '--json',
  '--dry-run',
  '--help',
  '--version',
  '-V',
] as const;

const SUBCOMMANDS = Object.keys(COMMANDS_AND_FLAGS) as readonly (keyof typeof COMMANDS_AND_FLAGS)[];

const SUPPORTED_SHELLS = ['bash', 'zsh', 'fish', 'powershell'] as const;
type SupportedShell = (typeof SUPPORTED_SHELLS)[number];

// Descriptions are interpolated into single-quoted zsh and fish strings
// (e.g. `'<sub>:<desc>'` and `-d '<desc>'`). MUST NOT contain apostrophes or
// the emitted scripts will be syntactically broken. Enforced by a unit test
// in completion.test.ts ("descriptions must be apostrophe-free").
const SUBCOMMAND_DESCRIPTIONS: Record<keyof typeof COMMANDS_AND_FLAGS, string> = {
  export: 'Export your Claude Code environment to a bundle file',
  import: 'Import a bundle onto this machine',
  'fix-paths': 'Re-associate project slugs with new repository locations',
  share: 'Export a sanitized bundle for sharing with a team',
  rollback: 'Restore the most recent pre-import backup',
  completion: 'Generate shell completion scripts',
};

export const __SUBCOMMAND_DESCRIPTIONS_FOR_TEST = SUBCOMMAND_DESCRIPTIONS;

function isSupportedShell(s: string): s is SupportedShell {
  return (SUPPORTED_SHELLS as readonly string[]).includes(s);
}

function resolveShell(shell: string | undefined): SupportedShell {
  if (shell === undefined) {
    if (process.platform === 'win32') {
      throw new CmemmovError({
        code: 'INTERNAL',
        hint: 'on Windows, specify the shell explicitly: cmemmov completion powershell',
      });
    }
    const envShell = process.env.SHELL ?? '';
    const base = envShell === '' ? '' : basename(envShell);
    if (base === 'bash' || base === 'zsh' || base === 'fish') {
      return base;
    }
    throw new CmemmovError({
      code: 'INTERNAL',
      hint: 'specify shell: cmemmov completion <bash|zsh|fish|powershell>',
    });
  }
  if (!isSupportedShell(shell)) {
    throw new CmemmovError({
      code: 'INTERNAL',
      hint: `unsupported shell: ${shell}. Supported: bash, zsh, fish, powershell`,
    });
  }
  return shell;
}

function flagsForSubcommand(name: keyof typeof COMMANDS_AND_FLAGS): readonly string[] {
  // Combine per-subcommand flags with global flags. Global flags are valid
  // after any subcommand (e.g. `cmemmov export --json`), so every per-sub
  // case offers them too.
  return [...COMMANDS_AND_FLAGS[name], ...GLOBAL_FLAGS];
}

export function buildBashScript(): string {
  const cmdList = SUBCOMMANDS.join(' ');
  const cases = SUBCOMMANDS.map((sub) => {
    const flags = flagsForSubcommand(sub).join(' ');
    return `    ${sub})\n      COMPREPLY=( $(compgen -W "${flags}" -- "$cur") )\n      ;;`;
  }).join('\n');
  return `# Install: eval "$(cmemmov completion bash)"
# Or persist: cmemmov completion bash >> ~/.bashrc
_cmemmov_complete() {
  local cur prev cmd
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  cmd="\${COMP_WORDS[1]:-}"

  if [[ $COMP_CWORD -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "${cmdList}" -- "$cur") )
    return 0
  fi

  case "$cmd" in
${cases}
    *)
      COMPREPLY=( $(compgen -W "${GLOBAL_FLAGS.join(' ')}" -- "$cur") )
      ;;
  esac
}
complete -F _cmemmov_complete cmemmov
`;
}

export function buildZshScript(): string {
  const cmdLines = SUBCOMMANDS.map(
    (sub) => `    '${sub}:${SUBCOMMAND_DESCRIPTIONS[sub]}'`,
  ).join('\n');
  const subCases = SUBCOMMANDS.map((sub) => {
    const flagArgs = flagsForSubcommand(sub)
      .map((f) => `'${f}'`)
      .join(' ');
    return `        ${sub}) _arguments ${flagArgs} ;;`;
  }).join('\n');
  return `#compdef cmemmov
# Install: cmemmov completion zsh > "\${fpath[1]}/_cmemmov"
# Or for one session: source <(cmemmov completion zsh)
_cmemmov() {
  local -a commands
  commands=(
${cmdLines}
  )
  _arguments -C \\
    '1: :->command' \\
    '*::arg:->args'
  case "$state" in
    command) _describe -t commands 'cmemmov command' commands ;;
    args)
      case "$line[1]" in
${subCases}
      esac
      ;;
  esac
}
_cmemmov "$@"
`;
}

export function buildFishScript(): string {
  const header = `# Install: cmemmov completion fish > ~/.config/fish/completions/cmemmov.fish
complete -c cmemmov -f`;
  const subLines = SUBCOMMANDS.map(
    (sub) =>
      `complete -c cmemmov -n '__fish_use_subcommand' -a '${sub}' -d '${SUBCOMMAND_DESCRIPTIONS[sub]}'`,
  );
  const subFlagLines: string[] = [];
  for (const sub of SUBCOMMANDS) {
    for (const flag of COMMANDS_AND_FLAGS[sub]) {
      const long = flag.replace(/^--/, '');
      subFlagLines.push(
        `complete -c cmemmov -n '__fish_seen_subcommand_from ${sub}' -l ${long}`,
      );
    }
  }
  const globalLines = GLOBAL_FLAGS.filter((f) => f.startsWith('--')).map(
    (f) => `complete -c cmemmov -l ${f.replace(/^--/, '')}`,
  );
  // -V short alias for --version
  globalLines.push(`complete -c cmemmov -s V`);
  return [header, ...subLines, ...subFlagLines, ...globalLines].join('\n') + '\n';
}

export function buildPowershellScript(): string {
  const cmdList = SUBCOMMANDS.map((s) => `'${s}'`).join(', ');
  const globalFlagList = GLOBAL_FLAGS.map((f) => `'${f}'`).join(', ');
  const subFlagEntries = SUBCOMMANDS.map((sub) => {
    const flags = COMMANDS_AND_FLAGS[sub].map((f) => `'${f}'`).join(', ');
    return `    '${sub}' = @(${flags})`;
  }).join('\n');
  return `# Install (session): cmemmov completion powershell | Out-String | Invoke-Expression
# Install (persistent): append the above line to your $PROFILE
Register-ArgumentCompleter -Native -CommandName cmemmov -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)
  $commands = @(${cmdList})
  $globalFlags = @(${globalFlagList})
  $subFlags = @{
${subFlagEntries}
  }
  $tokens = @($commandAst.CommandElements)
  # tokens[0] is always 'cmemmov'. If user has not yet typed a subcommand,
  # offer the command list filtered by $wordToComplete; otherwise offer
  # the subcommand-specific flags + global flags.
  if ($tokens.Count -le 2) {
    $commands | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
      [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
    }
    return
  }
  $sub = $tokens[1].Value
  $suggestions = @()
  if ($subFlags.ContainsKey($sub)) { $suggestions += $subFlags[$sub] }
  $suggestions += $globalFlags
  $suggestions | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterName', $_)
  }
}
`;
}

function buildScript(shell: SupportedShell): string {
  switch (shell) {
    case 'bash':
      return buildBashScript();
    case 'zsh':
      return buildZshScript();
    case 'fish':
      return buildFishScript();
    case 'powershell':
      return buildPowershellScript();
  }
}

export async function run(
  shell: string | undefined,
  opts: CompletionOpts = {},
): Promise<void> {
  await Promise.resolve();
  const resolved = resolveShell(shell);
  const script = buildScript(resolved);
  const out = new Output('completion', { json: opts.json === true });

  if (opts.json === true) {
    out.finish(`${resolved} completion script generated`, true, {
      shell: resolved,
      script,
    });
    return;
  }

  // Non-JSON: emit the raw script. Output.finish writes the summary string
  // to stdout followed by '\n' in non-JSON mode, which matches the AC1–AC4
  // contract (the script itself, nothing else, ending with a newline).
  out.finish(script, true);
}
