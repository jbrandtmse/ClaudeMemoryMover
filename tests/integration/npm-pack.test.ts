import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { accessSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// AC7: prove the npm tarball includes every dist/*.js chunk the lazy-import
// runtime needs and excludes the SEA binaries. Without this whitelist gate,
// `npm install -g cmemmov` would publish a broken tree that crashes with
// ERR_MODULE_NOT_FOUND the moment the user runs anything beyond --version.

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');

// Detect npm availability — every CI runner has it, but skip gracefully
// rather than fail noisily on unusual hosts (e.g. minimal docker images).
function npmOnPath(): boolean {
  const tool = process.platform === 'win32' ? 'where' : 'which';
  const bin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(tool, [bin], { stdio: 'ignore' });
  return result.status === 0;
}

// Pre-compute once: avoid spawning `where npm` 4×.
const HAS_NPM = npmOnPath();

describe('npm pack — tarball whitelist (AC7)', () => {
  let workDir: string;
  let tarballPath: string;
  let extractedRoot: string;

  beforeAll(() => {
    if (!HAS_NPM) return;

    workDir = mkdtempSync(join(tmpdir(), 'cmemmov-pack-'));

    // Step 1: ensure dist/ exists. We assume the developer or CI ran
    // `npm run build` before invoking the test suite — that's the standard
    // CI sequence (`npm ci && npm run build && npm test` in this story's
    // matrix). If dist/cmemmov.js is missing, fail loudly so the test
    // doesn't false-positive on an empty tree.
    const distEntry = join(repoRoot, 'dist', 'cmemmov.js');
    try {
      accessSync(distEntry);
    } catch {
      throw new Error(
        `dist/cmemmov.js missing at ${distEntry}. Run 'npm run build' before this test.`,
      );
    }

    // Step 2: npm pack --json --pack-destination <workDir>.
    // `--pack-destination` keeps the tarball OUT of the repo root (which is
    // dirty otherwise and may also confuse downstream tooling).
    // On Windows, spawnSync needs `shell: true` to resolve npm.cmd via PATH.
    const isWin = process.platform === 'win32';
    const packResult = spawnSync(
      isWin ? 'npm.cmd' : 'npm',
      ['pack', '--json', '--pack-destination', workDir],
      { cwd: repoRoot, encoding: 'utf8', shell: isWin },
    );
    if (packResult.status !== 0) {
      throw new Error(
        `npm pack failed (status ${String(packResult.status)}): ${packResult.stderr}`,
      );
    }
    // npm pack --json prints a JSON array on stdout describing each tarball.
    // The trailing newline matters; trim it.
    interface PackResult {
      filename: string;
    }
    const parsed = JSON.parse(packResult.stdout) as PackResult[];
    expect(parsed).toHaveLength(1);
    const first = parsed[0];
    if (first === undefined) throw new Error('npm pack returned empty array');
    tarballPath = join(workDir, first.filename);

    // Step 3: extract via `tar -xzf`. tar is universally available on
    // macOS/Linux and on Windows 10+ (BSD-style tar ships with the OS).
    // GNU tar (e.g. via Git Bash) interprets `C:\path` as `host:path` rsh
    // syntax; passing the tarball as a relative filename with cwd set to
    // workDir avoids that ambiguity for BOTH bsdtar (Windows native) and
    // GNU tar (Git Bash), so we don't need a per-tar-flavor flag dance.
    extractedRoot = join(workDir, 'extracted');
    mkdirSync(extractedRoot, { recursive: true });
    const tarballBasename = first.filename;
    const tarResult = spawnSync(
      'tar',
      ['-xzf', tarballBasename, '-C', 'extracted'],
      { cwd: workDir, encoding: 'utf8' },
    );
    if (tarResult.status !== 0) {
      throw new Error(
        `tar -xzf failed (status ${String(tarResult.status)}): stdout=${tarResult.stdout} stderr=${tarResult.stderr} tarball=${tarballPath}`,
      );
    }
  });

  // After-all cleanup. `rmSync` with `force: true` swallows missing-path errors.
  // We use a synchronous afterAll inside an arrow because beforeAll already
  // captured the workDir reference.
  it.skipIf(!HAS_NPM)(
    'tarball includes dist/cmemmov.js (the bin entry)',
    () => {
      const packageDir = join(extractedRoot, 'package');
      const distFiles = readdirSync(join(packageDir, 'dist'));
      expect(distFiles).toContain('cmemmov.js');
    },
  );

  it.skipIf(!HAS_NPM)(
    'tarball includes at least one lazy-import chunk (proves AC7 fix for cr-1.9)',
    () => {
      const packageDir = join(extractedRoot, 'package');
      const distFiles = readdirSync(join(packageDir, 'dist'));
      // Chunks look like `export-<hash>.js`, `import-<hash>.js`,
      // `chunk-<hash>.js`, etc. At least one must be present.
      const chunks = distFiles.filter((f) =>
        /^(export|import|fix-paths|share|rollback|completion|chunk)-[A-Z0-9]+\.js$/.test(f),
      );
      expect(chunks.length).toBeGreaterThan(0);
    },
  );

  it.skipIf(!HAS_NPM)(
    'tarball does NOT include dist/binaries/** (SEA artifacts stay out of npm)',
    () => {
      const packageDir = join(extractedRoot, 'package');
      const distFiles = readdirSync(join(packageDir, 'dist'));
      expect(distFiles).not.toContain('binaries');
      // The bundled SEA entry (`cmemmov-bundled.cjs`) is also excluded —
      // it's a build artifact for SEA, not part of the npm payload. The
      // `files` pattern (dist/**/*.js, dist/**/*.d.ts) naturally excludes
      // .cjs, and .npmignore enforces the same.
      expect(distFiles).not.toContain('cmemmov-bundled.cjs');
    },
  );

  // AC8 (Story 5.4): docs/ lives in the repo but must NOT ship in the npm
  // tarball. The `files` whitelist in package.json (`dist/**/*.js`,
  // `dist/**/*.d.ts`, `README.md`, `LICENSE`) excludes it by virtue of being
  // an allowlist; this assertion makes the invariant mechanical so a future
  // change that accidentally adds `docs/**` to `files` fails loudly here.
  it.skipIf(!HAS_NPM)(
    'tarball does NOT include the docs/ directory (AC8)',
    () => {
      const packageDir = join(extractedRoot, 'package');
      const tarballEntries = readdirSync(packageDir);
      expect(tarballEntries).not.toContain('docs');
      expect(tarballEntries).not.toContain('docs/');
    },
  );

  it.skipIf(!HAS_NPM)(
    'extracted `node dist/cmemmov.js --version` exits 0 with expected version',
    () => {
      const packageDir = join(extractedRoot, 'package');
      const entry = join(packageDir, 'dist', 'cmemmov.js');

      // `npm pack` produces source-only tarballs without node_modules —
      // running cmemmov.js bare would crash with ERR_MODULE_NOT_FOUND on
      // commander/picocolors/zod/etc. Install production deps into the
      // extracted package so the bin entry can resolve its runtime imports.
      // --omit=dev keeps the install lean; --no-package-lock and --no-audit
      // shave seconds off the install for this smoke test.
      const isWin = process.platform === 'win32';
      const installResult = spawnSync(
        isWin ? 'npm.cmd' : 'npm',
        ['install', '--omit=dev', '--no-package-lock', '--no-audit', '--no-fund', '--silent'],
        { cwd: packageDir, encoding: 'utf8', shell: isWin },
      );
      if (installResult.status !== 0) {
        throw new Error(
          `npm install in extracted dir failed (status ${String(installResult.status)}): ${installResult.stderr}`,
        );
      }

      const result = spawnSync(process.execPath, [entry, '--version'], {
        encoding: 'utf8',
      });
      expect(result.status).toBe(0);
      // Match SemVer prefix from package.json — exact comparison would
      // couple this test to the bumped version on every release.
      expect(result.stdout).toMatch(/^\d+\.\d+\.\d+/);
    },
    // Bumping default 5s timeout — `npm install` of commander/clack/etc
    // can take 30-60s on a cold runner.
    120_000,
  );

  // Self-cleanup. We don't use afterAll() — vitest runs the tests then
  // exits; the OS reaps tmpdir on next reboot. But we DO delete the
  // tarball + extraction tree explicitly to avoid leaking 1 MB per run
  // on long-running dev machines.
  it.skipIf(!HAS_NPM)('cleanup', () => {
    rmSync(workDir, { recursive: true, force: true });
    // We re-check the workDir variable was set — defensive against
    // accidental ordering changes in vitest's test execution.
    expect(workDir).toBeTruthy();
  });
});
