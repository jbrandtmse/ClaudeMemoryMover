import { describe, it, expect } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { platform } from 'node:process';
import {
  buildBashScript,
  buildZshScript,
  buildFishScript,
  buildPowershellScript,
} from '../../src/commands/completion.js';

const IS_WIN = platform === 'win32';

// Detect whether a shell binary is on PATH using the platform's native lookup
// tool. We use `where` on Windows and `which` elsewhere. This is invoked once
// per test setup (synchronously) so the it.skipIf gating runs deterministically.
function shellOnPath(bin: string): boolean {
  const tool = IS_WIN ? 'where' : 'which';
  const result = spawnSync(tool, [bin], { stdio: 'ignore' });
  return result.status === 0;
}

interface ShellSpec {
  name: 'bash' | 'zsh' | 'fish' | 'powershell';
  build: () => string;
  marker: RegExp;
  // Binary name to look up on PATH. powershell uses 'powershell' on win, 'pwsh' elsewhere.
  binary: string;
  // Args for parse-only invocation. Each shell parses but does not execute
  // when given a "noop"-ish stdin or a -c snippet that just defines a function.
  parseArgs: readonly string[];
  // Are we passing the script via stdin or argv?
  via: 'stdin' | 'argv';
}

const POWERSHELL_BIN = IS_WIN ? 'powershell' : 'pwsh';

// For zsh, a bare `zsh -c "<script>"` invocation with #compdef will warn but
// not error in non-completion-loaded contexts. Source-loading it via stdin and
// asserting exit 0 is sufficient evidence the script parses cleanly. We use
// `zsh -n` (no-exec parse only) for the strongest check.
//
// For fish, `fish -n -c` is "parse but don't run".
// For bash, `bash -n` is parse-only.
// For PowerShell, `pwsh -NoProfile -NonInteractive -Command "& {<script>}"` runs
// the script block; if there is a syntax error the exit code is non-zero.
// A safer parse-only check on PowerShell is `[System.Management.Automation.Language.Parser]::ParseInput(<script>, ...)`
// which we evaluate inline.
const SHELLS: readonly ShellSpec[] = [
  {
    name: 'bash',
    build: buildBashScript,
    marker: /complete -F _cmemmov_complete cmemmov/,
    binary: 'bash',
    parseArgs: ['-n'],
    via: 'stdin',
  },
  {
    name: 'zsh',
    build: buildZshScript,
    marker: /^#compdef cmemmov/m,
    binary: 'zsh',
    parseArgs: ['-n'],
    via: 'stdin',
  },
  {
    name: 'fish',
    build: buildFishScript,
    marker: /complete -c cmemmov/,
    binary: 'fish',
    // fish -n parses without executing.
    parseArgs: ['-n'],
    via: 'stdin',
  },
  {
    name: 'powershell',
    build: buildPowershellScript,
    marker: /Register-ArgumentCompleter -Native -CommandName cmemmov/,
    binary: POWERSHELL_BIN,
    // We use a small PS launcher that reads stdin, parses it, and reports parse errors via exit code.
    parseArgs: [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "$src = [Console]::In.ReadToEnd(); $errors = $null; $tokens = $null; [System.Management.Automation.Language.Parser]::ParseInput($src, [ref]$tokens, [ref]$errors) | Out-Null; if ($errors.Count -gt 0) { $errors | ForEach-Object { Write-Error $_.Message }; exit 1 } else { exit 0 }",
    ],
    via: 'stdin',
  },
];

async function runShellParse(spec: ShellSpec, script: string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const child = spawn(spec.binary, [...spec.parseArgs], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        // Surface stderr in the assertion failure to make CI diagnosis easy.
        reject(new Error(`${spec.binary} exited ${code?.toString() ?? 'null'}: ${stderr}`));
        return;
      }
      resolve(code);
    });
    child.stdin.write(script);
    child.stdin.end();
  });
}

describe('completion — universal structural checks (AC8, all OSes)', () => {
  // These run unconditionally on every CI runner because they require no shell binary.
  for (const spec of SHELLS) {
    it(`${spec.name} script contains its required structural marker`, () => {
      const script = spec.build();
      expect(script).toMatch(spec.marker);
      // And non-empty: defensive — catches accidental empty-string regressions.
      expect(script.length).toBeGreaterThan(100);
    });
  }
});

describe('completion — per-shell parse-only smoke tests (AC8, conditional)', () => {
  for (const spec of SHELLS) {
    const hasShell = shellOnPath(spec.binary);
    it.skipIf(!hasShell)(
      `${spec.name} parses the emitted script without syntax errors (${spec.binary} on PATH)`,
      async () => {
        const script = spec.build();
        const code = await runShellParse(spec, script);
        expect(code).toBe(0);
      },
      // Generous timeout for slow CI runners spinning up powershell.exe.
      20_000,
    );
  }
});
