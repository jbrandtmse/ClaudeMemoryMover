import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  run,
  buildBashScript,
  buildZshScript,
  buildFishScript,
  buildPowershellScript,
  __SUBCOMMAND_DESCRIPTIONS_FOR_TEST,
} from './completion.js';
import { CmemmovError } from '../core/error.js';

interface ShellCase {
  name: 'bash' | 'zsh' | 'fish' | 'powershell';
  build: () => string;
  marker: RegExp;
}

const SHELLS: readonly ShellCase[] = [
  { name: 'bash', build: buildBashScript, marker: /complete -F _cmemmov_complete cmemmov/ },
  { name: 'zsh', build: buildZshScript, marker: /^#compdef cmemmov/m },
  { name: 'fish', build: buildFishScript, marker: /complete -c cmemmov/ },
  {
    name: 'powershell',
    build: buildPowershellScript,
    marker: /Register-ArgumentCompleter -Native -CommandName cmemmov/,
  },
];

const SUBCOMMANDS = ['export', 'import', 'fix-paths', 'share', 'rollback', 'completion'] as const;

// Cross-shell flag list: the user-facing global flags. PowerShell's
// completion script uses a literal list that includes -V; bash/zsh/fish
// scripts include short -V via global_flags. Tests assert presence as
// substrings (not exact tokens) — `--version` and `-V` both appear in
// every script.
const GLOBAL_FLAGS = ['--silent', '--json', '--dry-run', '--help', '--version'] as const;

// Per-subcommand flags drawn from src/cli.ts. Kept in lockstep with
// COMMANDS_AND_FLAGS in completion.ts; the test fails loudly if either
// side adds a flag without updating the other.
const SUB_FLAGS: Record<(typeof SUBCOMMANDS)[number], readonly string[]> = {
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
};

function captureStdout(): { restore: () => void; get: () => string } {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  });
  return {
    restore: () => {
      spy.mockRestore();
    },
    get: () => chunks.join(''),
  };
}

describe('completion — script builders (AC1–AC4)', () => {
  for (const shell of SHELLS) {
    describe(`${shell.name} script`, () => {
      it('includes the shell-specific structural marker', () => {
        const script = shell.build();
        expect(script).toMatch(shell.marker);
      });

      it('first non-empty content explains how to install (header comment block)', () => {
        const script = shell.build();
        // Take the first ~5 lines and ensure at least one starts with '#' and
        // mentions "Install" — the AC text wants the install snippet
        // visible at the top of the script.
        const head = script.split('\n').slice(0, 5).join('\n');
        expect(head).toMatch(/^# .*[Ii]nstall/m);
      });

      it('lists every subcommand', () => {
        const script = shell.build();
        for (const sub of SUBCOMMANDS) {
          expect(script).toContain(sub);
        }
      });

      it('lists every user-facing global flag', () => {
        const script = shell.build();
        for (const flag of GLOBAL_FLAGS) {
          if (shell.name === 'fish') {
            // fish scripts use `-l flag-name` syntax (strips --), so assert the bare name.
            expect(script).toContain(flag.replace(/^--/, ''));
          } else {
            expect(script).toContain(flag);
          }
        }
      });

      it('lists every per-subcommand flag', () => {
        const script = shell.build();
        for (const sub of SUBCOMMANDS) {
          for (const flag of SUB_FLAGS[sub]) {
            if (shell.name === 'fish') {
              expect(script).toContain(flag.replace(/^--/, ''));
            } else {
              expect(script).toContain(flag);
            }
          }
        }
      });
    });
  }
});

describe('completion — run() emits the right script (AC1–AC4)', () => {
  let cap: ReturnType<typeof captureStdout>;
  beforeEach(() => {
    cap = captureStdout();
  });
  afterEach(() => {
    cap.restore();
  });

  for (const shell of SHELLS) {
    it(`run('${shell.name}') writes the ${shell.name} script to stdout`, async () => {
      await run(shell.name, {});
      const stdout = cap.get();
      expect(stdout).toMatch(shell.marker);
    });
  }
});

describe('completion — POSIX auto-detect (AC5)', () => {
  const originalPlatform = process.platform;
  const originalShell = process.env.SHELL;
  let cap: ReturnType<typeof captureStdout>;

  beforeEach(() => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    cap = captureStdout();
  });
  afterEach(() => {
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      configurable: true,
    });
    if (originalShell === undefined) {
      delete process.env.SHELL;
    } else {
      process.env.SHELL = originalShell;
    }
    cap.restore();
  });

  it('SHELL=/usr/bin/zsh → zsh script', async () => {
    process.env.SHELL = '/usr/bin/zsh';
    await run(undefined, {});
    expect(cap.get()).toMatch(/^#compdef cmemmov/m);
  });

  it('SHELL=/bin/bash → bash script', async () => {
    process.env.SHELL = '/bin/bash';
    await run(undefined, {});
    expect(cap.get()).toMatch(/complete -F _cmemmov_complete cmemmov/);
  });

  it('SHELL=/usr/local/bin/fish → fish script', async () => {
    process.env.SHELL = '/usr/local/bin/fish';
    await run(undefined, {});
    expect(cap.get()).toMatch(/complete -c cmemmov/);
  });

  it('SHELL unset → INTERNAL error with AC5 hint', async () => {
    delete process.env.SHELL;
    await expect(run(undefined, {})).rejects.toMatchObject({
      code: 'INTERNAL',
      hint: 'specify shell: cmemmov completion <bash|zsh|fish|powershell>',
    });
  });

  it('SHELL empty string → INTERNAL error with AC5 hint', async () => {
    process.env.SHELL = '';
    await expect(run(undefined, {})).rejects.toMatchObject({
      code: 'INTERNAL',
      hint: 'specify shell: cmemmov completion <bash|zsh|fish|powershell>',
    });
  });

  it('SHELL=/usr/bin/tcsh (unknown) → INTERNAL error with AC5 hint', async () => {
    process.env.SHELL = '/usr/bin/tcsh';
    await expect(run(undefined, {})).rejects.toMatchObject({
      code: 'INTERNAL',
      hint: 'specify shell: cmemmov completion <bash|zsh|fish|powershell>',
    });
  });
});

describe('completion — Windows explicit-shell requirement (AC6)', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  });
  afterEach(() => {
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      configurable: true,
    });
  });

  it('no shell arg on Windows → INTERNAL error with AC6 hint', async () => {
    const err = await run(undefined, {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CmemmovError);
    expect(err).toMatchObject({
      code: 'INTERNAL',
      hint: 'on Windows, specify the shell explicitly: cmemmov completion powershell',
    });
    // Exit-code contract: INTERNAL → 2.
    if (err instanceof CmemmovError) {
      expect(err.exitCode).toBe(2);
    }
  });

  it('explicit powershell on Windows still works', async () => {
    const cap = captureStdout();
    try {
      await run('powershell', {});
      expect(cap.get()).toMatch(/Register-ArgumentCompleter -Native -CommandName cmemmov/);
    } finally {
      cap.restore();
    }
  });
});

describe('completion — unknown shell (AC7)', () => {
  let cap: ReturnType<typeof captureStdout>;
  beforeEach(() => {
    cap = captureStdout();
  });
  afterEach(() => {
    cap.restore();
  });

  it("run('bogus-shell') → INTERNAL with exact AC7 hint", async () => {
    const err = await run('bogus-shell', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CmemmovError);
    expect(err).toMatchObject({
      code: 'INTERNAL',
      hint: 'unsupported shell: bogus-shell. Supported: bash, zsh, fish, powershell',
    });
    if (err instanceof CmemmovError) {
      expect(err.exitCode).toBe(2);
    }
  });

  it("run('BASH') is case-sensitive — rejects with the bogus-shell-style hint", async () => {
    await expect(run('BASH', {})).rejects.toMatchObject({
      code: 'INTERNAL',
      hint: 'unsupported shell: BASH. Supported: bash, zsh, fish, powershell',
    });
  });

  it("run('Bash') is case-sensitive — rejects", async () => {
    await expect(run('Bash', {})).rejects.toMatchObject({
      code: 'INTERNAL',
      hint: 'unsupported shell: Bash. Supported: bash, zsh, fish, powershell',
    });
  });

  it("run('pwsh') → INTERNAL (we only accept 'powershell')", async () => {
    await expect(run('pwsh', {})).rejects.toMatchObject({
      code: 'INTERNAL',
      hint: 'unsupported shell: pwsh. Supported: bash, zsh, fish, powershell',
    });
  });
});

describe('completion — script-quoting invariants', () => {
  // SUBCOMMAND_DESCRIPTIONS are interpolated into single-quoted zsh and fish
  // strings (e.g. `'<sub>:<desc>'` and `-d '<desc>'`). An apostrophe inside a
  // description would close the surrounding quote prematurely and break the
  // emitted script's syntax. Catch drift at build time.
  it('every SUBCOMMAND_DESCRIPTION is apostrophe-free', () => {
    for (const [sub, desc] of Object.entries(__SUBCOMMAND_DESCRIPTIONS_FOR_TEST)) {
      expect(desc, `description for "${sub}" must not contain an apostrophe`).not.toMatch(/'/);
    }
  });
});

describe('completion — JSON mode (AC9)', () => {
  let cap: ReturnType<typeof captureStdout>;
  beforeEach(() => {
    cap = captureStdout();
  });
  afterEach(() => {
    cap.restore();
  });

  it("run('bash', { json: true }) emits exactly one JSON line with the script payload", async () => {
    await run('bash', { json: true });
    const stdout = cap.get();
    // Exactly one non-empty line on stdout.
    const lines = stdout.split('\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(1);
    const parsed: unknown = JSON.parse(lines[0] ?? '');
    expect(parsed).toMatchObject({
      success: true,
      command: 'completion',
      errors: [],
      warnings: [],
    });
    // summary is an object with text/shell/script when extra is passed.
    const p = parsed as { summary: { text: string; shell: string; script: string } };
    expect(p.summary.text).toBe('bash completion script generated');
    expect(p.summary.shell).toBe('bash');
    expect(p.summary.script).toMatch(/complete -F _cmemmov_complete cmemmov/);
  });

  it("run('powershell', { json: true }) emits a JSON payload with the powershell script", async () => {
    await run('powershell', { json: true });
    const stdout = cap.get();
    const lines = stdout.split('\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0] ?? '') as {
      summary: { shell: string; script: string };
    };
    expect(parsed.summary.shell).toBe('powershell');
    expect(parsed.summary.script).toMatch(/Register-ArgumentCompleter -Native/);
  });
});
