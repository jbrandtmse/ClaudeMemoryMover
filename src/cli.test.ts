import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { MockInstance } from 'vitest';
import { CmemmovError } from './core/error.js';

interface Tracker {
  loaded: string[];
  runImpl: Record<string, () => Promise<void>>;
}

const tracker = vi.hoisted<Tracker>(() => ({
  loaded: [],
  runImpl: {},
}));

function defaultPlaceholderRun(): () => Promise<void> {
  return async () => {
    await Promise.resolve();
    throw new CmemmovError({ code: 'INTERNAL', hint: 'not yet implemented' });
  };
}

vi.mock('./commands/export.js', () => ({
  run: vi.fn(async () => {
    tracker.loaded.push('export');
    const impl = tracker.runImpl.export ?? defaultPlaceholderRun();
    await impl();
  }),
}));
vi.mock('./commands/import.js', () => ({
  run: vi.fn(async () => {
    tracker.loaded.push('import');
    const impl = tracker.runImpl.import ?? defaultPlaceholderRun();
    await impl();
  }),
}));
vi.mock('./commands/fix-paths.js', () => ({
  run: vi.fn(async () => {
    tracker.loaded.push('fix-paths');
    const impl = tracker.runImpl['fix-paths'] ?? defaultPlaceholderRun();
    await impl();
  }),
}));
vi.mock('./commands/share.js', () => ({
  run: vi.fn(async () => {
    tracker.loaded.push('share');
    const impl = tracker.runImpl.share ?? defaultPlaceholderRun();
    await impl();
  }),
}));
vi.mock('./commands/rollback.js', () => ({
  run: vi.fn(async () => {
    tracker.loaded.push('rollback');
    const impl = tracker.runImpl.rollback ?? defaultPlaceholderRun();
    await impl();
  }),
}));
vi.mock('./commands/completion.js', () => ({
  run: vi.fn(async () => {
    tracker.loaded.push('completion');
    const impl = tracker.runImpl.completion ?? defaultPlaceholderRun();
    await impl();
  }),
}));

type WriteFn = (chunk: string | Uint8Array) => boolean;
type ExitFn = (code?: number | string | null) => never;

interface CliExitError extends Error {
  exitCode?: number;
}

function makeExitError(code: number | undefined): CliExitError {
  const e: CliExitError = new Error('process.exit called');
  if (code !== undefined) e.exitCode = code;
  return e;
}

describe('cli', () => {
  let exitSpy: MockInstance<ExitFn>;
  let stdoutSpy: MockInstance<WriteFn>;
  let stderrSpy: MockInstance<WriteFn>;
  let lastExitCode: number | undefined;
  let priorProcessExitCode: number | string | undefined;

  beforeEach(() => {
    lastExitCode = undefined;
    tracker.loaded.length = 0;
    tracker.runImpl = {};
    priorProcessExitCode = process.exitCode;
    process.exitCode = undefined;
    exitSpy = vi.spyOn(process, 'exit');
    exitSpy.mockImplementation((code?: number | string | null) => {
      lastExitCode = typeof code === 'number' ? code : undefined;
      throw makeExitError(typeof code === 'number' ? code : undefined);
    });
    stdoutSpy = vi.spyOn(process.stdout, 'write');
    stdoutSpy.mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, 'write');
    stderrSpy.mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = priorProcessExitCode;
  });

  async function runCli(args: string[]): Promise<void> {
    const { main } = await import('./cli.js');
    try {
      await main(['node', 'cmemmov', ...args]);
    } catch (err) {
      if (!(err instanceof Error) || (err as CliExitError).exitCode === undefined) {
        throw err;
      }
    }
    if (lastExitCode === undefined && typeof process.exitCode === 'number') {
      lastExitCode = process.exitCode;
    }
  }

  function joinWrites(spy: MockInstance<WriteFn>): string {
    return spy.mock.calls
      .map((c) => {
        const chunk = c[0];
        return typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
      })
      .join('');
  }

  describe('AC1: --help shows all commands and global flags', () => {
    it('prints usage with all six commands and global flags, exits 0', async () => {
      await runCli(['--help']);

      const stdoutText = joinWrites(stdoutSpy);
      expect(stdoutText).toContain('export');
      expect(stdoutText).toContain('import');
      expect(stdoutText).toContain('fix-paths');
      expect(stdoutText).toContain('share');
      expect(stdoutText).toContain('rollback');
      expect(stdoutText).toContain('completion');
      expect(stdoutText).toContain('--silent');
      expect(stdoutText).toContain('--json');
      expect(stdoutText).toContain('--dry-run');
      expect(stdoutText).toContain('--help');
      expect(stdoutText).toContain('--version');

      expect(lastExitCode).toBe(0);
    });
  });

  describe('AC2: --version prints VERSION and exits 0', () => {
    it('prints VERSION from src/version.ts, exits 0', async () => {
      const { VERSION } = await import('./version.js');
      await runCli(['--version']);

      const stdoutText = joinWrites(stdoutSpy);
      expect(stdoutText).toContain(VERSION);
      expect(lastExitCode).toBe(0);
    });
  });

  describe('AC3: bogus command exits 2 with stderr error', () => {
    it('prints structured error to stderr and exits 2', async () => {
      await runCli(['bogus-command']);

      expect(lastExitCode).toBe(2);
      const stderrText = joinWrites(stderrSpy);
      expect(stderrText).toContain('[INTERNAL]');
    });
  });

  describe('AC4: CmemmovError propagates with its exitCode', () => {
    it('exits with err.exitCode (2 for INTERNAL placeholder)', async () => {
      await runCli(['export']);

      expect(lastExitCode).toBe(2);
      const stderrText = joinWrites(stderrSpy);
      expect(stderrText).toContain('[INTERNAL]');
      expect(stderrText).toContain('not yet implemented');
    });

    it('exit code matches CmemmovError.exitCode for non-INTERNAL codes (IMPORT_PARTIAL → 1)', async () => {
      tracker.runImpl.export = async () => {
        await Promise.resolve();
        throw new CmemmovError({ code: 'IMPORT_PARTIAL', hint: 'partial' });
      };
      await runCli(['export']);

      expect(lastExitCode).toBe(1);
      const stderrText = joinWrites(stderrSpy);
      expect(stderrText).toContain('[IMPORT_PARTIAL]');
    });
  });

  describe('AC5: non-CmemmovError is wrapped as INTERNAL and exits 2', () => {
    it('wraps generic Error and exits 2', async () => {
      tracker.runImpl.export = async () => {
        await Promise.resolve();
        throw new Error('boom');
      };
      await runCli(['export']);

      expect(lastExitCode).toBe(2);
      const stderrText = joinWrites(stderrSpy);
      expect(stderrText).toContain('[INTERNAL]');
    });
  });

  describe('AC6: only one top-level try/catch lives in src/cli.ts', () => {
    it('cli.ts contains exactly one try block; placeholder commands contain none', async () => {
      const fs = await import('node:fs/promises');
      const url = await import('node:url');
      const cliSource = await fs.readFile(
        url.fileURLToPath(new URL('./cli.ts', import.meta.url)),
        'utf8',
      );
      const cliTryMatches = cliSource.match(/\btry\s*{/g) ?? [];
      expect(cliTryMatches).toHaveLength(1);

      // All Epic 1–5 commands are implemented:
      //  'export' (1.10), 'import' (1.11), 'rollback' (1.12), 'fix-paths' (3.1),
      //  'share' (4.2), 'completion' (5.1). No placeholders remain.
      const placeholders: readonly string[] = [];
      for (const name of placeholders) {
        const src = await fs.readFile(
          url.fileURLToPath(new URL(`./commands/${name}.ts`, import.meta.url)),
          'utf8',
        );
        const tryMatches = src.match(/\btry\s*{/g) ?? [];
        expect(tryMatches, `commands/${name}.ts must contain no try blocks`).toHaveLength(0);
      }
    });
  });

  // AC7 (placeholder-throws-INTERNAL) was retired in Story 5.1 once every
  // top-level command was implemented. Kept as a documentation comment so
  // future readers know the test was intentional, not lost. If a new
  // placeholder command is ever added, restore the it.each pattern.

  describe('AC11: share command wiring — real flags recognized', () => {
    it('cmemmov share --include-credentials dispatches to share run() (rejection is share-level, not commander)', async () => {
      tracker.runImpl.share = async () => {
        await Promise.resolve();
      };
      await runCli(['share', '--include-credentials']);
      expect(tracker.loaded).toContain('share');
    });

    it('cmemmov share --output foo.cmemmov dispatches to share run()', async () => {
      tracker.runImpl.share = async () => {
        await Promise.resolve();
      };
      await runCli(['share', '--output', 'foo.cmemmov']);
      expect(tracker.loaded).toContain('share');
    });

    it('cmemmov share --include-pattern todo* --exclude-pattern private* dispatches to share run()', async () => {
      tracker.runImpl.share = async () => {
        await Promise.resolve();
      };
      await runCli(['share', '--include-pattern', 'todo*', '--exclude-pattern', 'private*']);
      expect(tracker.loaded).toContain('share');
    });
  });

  describe('AC8: command run() is invoked only on dispatch', () => {
    it('cmemmov --help invokes no command run()', async () => {
      await runCli(['--help']);
      expect(tracker.loaded).toEqual([]);
    });

    it('cmemmov --version invokes no command run()', async () => {
      await runCli(['--version']);
      expect(tracker.loaded).toEqual([]);
    });

    it('importing cli.js does not invoke any command run()', async () => {
      await import('./cli.js');
      expect(tracker.loaded).toEqual([]);
    });

    it('cmemmov export invokes only the export command run()', async () => {
      await runCli(['export']);
      expect(tracker.loaded).toEqual(['export']);
    });

    it('cmemmov import <bundle> invokes only the import command run()', async () => {
      await runCli(['import', '/tmp/bundle.cmemmov']);
      expect(tracker.loaded).toEqual(['import']);
    });

    it('cmemmov rollback invokes only the rollback command run()', async () => {
      // Provide a no-op success implementation: the real rollback command
      // module is now implemented (Story 1.12) and would otherwise hit the
      // filesystem; we only want to verify dispatch wiring here.
      tracker.runImpl.rollback = async () => {
        await Promise.resolve();
      };
      await runCli(['rollback']);
      expect(tracker.loaded).toEqual(['rollback']);
    });
  });

  describe('AC8: cli.ts has no static (eager) imports of command modules', () => {
    it('cli.ts source contains no top-level `from \'./commands/...\'` import', async () => {
      const fs = await import('node:fs/promises');
      const url = await import('node:url');
      const cliSource = await fs.readFile(
        url.fileURLToPath(new URL('./cli.ts', import.meta.url)),
        'utf8',
      );
      // Match runtime (value) imports of command modules. Type-only imports
      // (`import type ...`) are erased by the TypeScript compiler and do not
      // pull the module into the runtime bundle, so they are exempt from the
      // lazy-load invariant. Story 3.1 introduces one such type-only import
      // for FixPathsOpts so the cli can type-check the optsWithGlobals call.
      const staticImportRe = /^\s*import\s+(?!type\s)[^;]*?from\s+['"]\.\/commands\/[^'"]+['"]/gm;
      const staticMatches = cliSource.match(staticImportRe) ?? [];
      expect(staticMatches).toHaveLength(0);

      const dynamicImportRe = /await\s+import\(\s*['"]\.\/commands\/[a-z-]+\.js['"]\s*\)/g;
      const dynamicMatches = cliSource.match(dynamicImportRe) ?? [];
      expect(dynamicMatches.length).toBeGreaterThanOrEqual(6);
    });
  });

  describe('--json mode error rendering', () => {
    it('emits JSON error blob on stdout and suppresses human stderr error', async () => {
      await runCli(['export', '--json']);
      expect(lastExitCode).toBe(2);

      const stdoutText = joinWrites(stdoutSpy);
      const stderrText = joinWrites(stderrSpy);
      const lastLine = stdoutText.split('\n').filter((l) => l.length > 0).pop() ?? '';
      const parsed = JSON.parse(lastLine) as {
        success: boolean;
        command: string;
        errors: { code: string; hint?: string }[];
      };
      expect(parsed.success).toBe(false);
      expect(parsed.command).toBe('cmemmov');
      expect(parsed.errors).toHaveLength(1);
      expect(parsed.errors[0]).toMatchObject({ code: 'INTERNAL', hint: 'not yet implemented' });
      expect(stderrText).not.toContain('[INTERNAL]');
    });
  });
});
