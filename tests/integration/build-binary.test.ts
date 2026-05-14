import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// AC11 integration check: build the binary on the host runner end-to-end
// and prove it works. The build script's internal smoke check (AC4) is the
// authoritative gate; this test is the redundant outer guardrail that fires
// at `npm test` time, NOT only at `npm run build:binary` time, so a broken
// SEA pipeline can't sneak through `npm test` on a green-but-stale build.
//
// We don't mock anything — the whole point is to exercise the real
// `node --experimental-sea-config` + `postject` + (on macOS) `codesign`
// chain. The test takes ~15-30 seconds per host; it runs on every CI
// runner that ships a supported `<platform>-<arch>` combo (all four in
// the binary-build matrix and the three existing `check` matrix runners
// which all happen to match supported targets).

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');

interface SupportedTarget {
  outputBase: string;
  ext: string;
  macho: boolean;
}

interface BuildBinaryModule {
  SUPPORTED_TARGETS: Record<string, SupportedTarget>;
  binaryOutputPath: (platform: string, arch: string) => string;
}

function hostIsSupported(): boolean {
  const key = `${process.platform}-${process.arch}`;
  // Mirror the SUPPORTED_TARGETS keys in scripts/build-binary.mjs. We
  // can't import them statically because this is a .ts file under Vitest
  // and dynamic import works fine — but for the skipIf guard we don't
  // want to await, so we inline the four keys.
  return ['win32-x64', 'darwin-arm64', 'darwin-x64', 'linux-x64'].includes(key);
}

const HOST_SUPPORTED = hostIsSupported();

describe.skipIf(!HOST_SUPPORTED)(
  'build-binary — host-runner end-to-end (AC11)',
  () => {
    let binaryPath: string;

    beforeAll(async () => {
      // Dynamic import — keeps the SUPPORTED_TARGETS source of truth
      // honest. If the constant moves or changes shape, this test breaks.
      const mod = (await import('../../scripts/build-binary.mjs')) as BuildBinaryModule;
      binaryPath = mod.binaryOutputPath(process.platform, process.arch);

      // Run the full build pipeline. We invoke it as a child process
      // rather than calling main() directly because the build script
      // calls process.exit() on error paths and we want the error to
      // surface as a normal child-process failure (not crash vitest).
      const isWin = process.platform === 'win32';
      const result = spawnSync(
        isWin ? 'npm.cmd' : 'npm',
        ['run', 'build:binary'],
        { cwd: repoRoot, encoding: 'utf8', shell: isWin },
      );
      if (result.status !== 0) {
        throw new Error(
          `build:binary failed (status ${String(result.status)}): stdout=${result.stdout} stderr=${result.stderr}`,
        );
      }
    }, 300_000); // 5-minute timeout — SEA + postject can run ~30-60s on cold runners.

    it('produces a binary at the AC3 path', () => {
      expect(existsSync(binaryPath)).toBe(true);
    });

    it('binary --version exits 0 with a SemVer string', () => {
      const result = spawnSync(binaryPath, ['--version'], { encoding: 'utf8' });
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    });

    it('binary --help exits 0 and lists the six subcommands', () => {
      const result = spawnSync(binaryPath, ['--help'], { encoding: 'utf8' });
      expect(result.status).toBe(0);
      // The same six subcommands wired in src/cli.ts. Asserting all six
      // catches a regression where the bundled CLI loses one of the
      // lazy-imported commands (i.e. the bundling step inlined incorrectly).
      for (const cmd of ['export', 'import', 'fix-paths', 'share', 'rollback', 'completion']) {
        expect(result.stdout).toContain(cmd);
      }
    });

    it('binary size sits in the AC6 50-110 MB band (logged regardless)', () => {
      const { size } = statSync(binaryPath);
      const sizeMB = size / (1024 * 1024);
      // Surface the size in test output for CI-log inspection — useful
      // when the build script's stderr warning gets buried by other logs.
      process.stdout.write(
        `[build-binary integration] ${binaryPath} size: ${sizeMB.toFixed(1)} MB\n`,
      );
      // Soft check matching AC6's warn-don't-fail policy. Bound the band
      // generously (40-150 MB) so this test doesn't flake on Node version
      // bumps; the build script's own stderr warning still surfaces drift.
      expect(sizeMB).toBeGreaterThan(40);
      expect(sizeMB).toBeLessThan(150);
    });
  },
);
