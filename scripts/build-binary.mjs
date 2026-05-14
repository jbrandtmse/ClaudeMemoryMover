#!/usr/bin/env node
// Builds a Node SEA (Single Executable Application) binary for the host
// platform/arch using the recipe documented at
// https://nodejs.org/api/single-executable-applications.html (Node 22).
//
// Story 5.2 — produces one binary native to the host. Cross-compilation is
// rejected (AC9): Node SEA can only produce a binary matching the running
// Node runtime's platform/arch. The four supported targets are built in CI
// (Windows x64, macOS arm64, macOS x64, Linux x64), one per matrix runner.

import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(__dirname, '..');

// Single source of truth for the four supported targets.
// `validatePlatform()`, `binaryOutputPath()`, and AC9's error message all
// derive from this constant. Adding a 5th target (e.g., linux-arm64) is
// a single-line change here.
//
// Keys are `<process.platform>-<process.arch>` strings, values describe
// the output naming convention and any platform-specific quirks.
export const SUPPORTED_TARGETS = Object.freeze({
  'win32-x64': Object.freeze({ outputBase: 'cmemmov-windows-x64', ext: '.exe', macho: false }),
  'darwin-arm64': Object.freeze({ outputBase: 'cmemmov-macos-arm64', ext: '', macho: true }),
  'darwin-x64': Object.freeze({ outputBase: 'cmemmov-macos-x64', ext: '', macho: true }),
  'linux-x64': Object.freeze({ outputBase: 'cmemmov-linux-x64', ext: '', macho: false }),
});

const SIZE_MIN_BYTES = 50 * 1024 * 1024;
const SIZE_MAX_BYTES = 110 * 1024 * 1024;

/**
 * Validates that the host platform/arch is one of the four supported SEA
 * targets. Returns the target descriptor on success. Throws on rejection
 * with the AC9 error message.
 *
 * @param {string} platform - `process.platform`
 * @param {string} arch - `process.arch`
 * @returns {{ outputBase: string, ext: string, macho: boolean }}
 */
export function validatePlatform(platform, arch) {
  const key = `${platform}-${arch}`;
  const target = SUPPORTED_TARGETS[key];
  if (!target) {
    const supportedList = Object.keys(SUPPORTED_TARGETS)
      .map((k) => `${k} (host=${k})`)
      .join(', ');
    throw new Error(
      `Cross-platform binary build not supported. Node SEA can only produce binaries native to the host platform. ` +
        `Current host: ${platform}-${arch}. ` +
        `Supported targets: ${supportedList}. ` +
        `To build all four binaries, use the CI matrix on GitHub Actions.`,
    );
  }
  return target;
}

/**
 * Returns the absolute output path for the binary on the given platform/arch.
 * @param {string} platform - `process.platform`
 * @param {string} arch - `process.arch`
 * @returns {string}
 */
export function binaryOutputPath(platform, arch) {
  const target = validatePlatform(platform, arch);
  return join(repoRoot, 'dist', 'binaries', `${target.outputBase}${target.ext}`);
}

function log(msg) {
  process.stdout.write(`[build-binary] ${msg}\n`);
}

function warn(msg) {
  process.stderr.write(`[build-binary] WARN: ${msg}\n`);
}

function ensureDir(dirPath) {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

function runSmokeCheck(binaryPath) {
  // AC4: --version and --help must work on the host.
  // Both must exit 0; their stdout is captured so failures get a descriptive error.
  const versionResult = execFileSync(binaryPath, ['--version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const versionTrimmed = versionResult.trim();
  if (!versionTrimmed) {
    throw new Error(`smoke check failed: --version produced empty stdout (binary: ${binaryPath})`);
  }
  log(`smoke check: --version → ${versionTrimmed}`);

  const helpResult = execFileSync(binaryPath, ['--help'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (!helpResult.includes('Usage:') || !helpResult.includes('cmemmov')) {
    throw new Error(
      `smoke check failed: --help missing expected markers (binary: ${binaryPath})\n--- stdout ---\n${helpResult}`,
    );
  }
  // AC4: --help must list the six subcommands. A regression where a
  // lazy-imported command drops out of the SEA bundle would print a valid
  // Commander help but be missing one of the six command names. The
  // integration test also asserts this, but the build-script smoke check is
  // the CI gate that stops a broken binary from being uploaded.
  const requiredSubcommands = ['export', 'import', 'fix-paths', 'share', 'rollback', 'completion'];
  const missing = requiredSubcommands.filter((cmd) => !helpResult.includes(cmd));
  if (missing.length > 0) {
    throw new Error(
      `smoke check failed: --help missing subcommands [${missing.join(', ')}] (binary: ${binaryPath})\n--- stdout ---\n${helpResult}`,
    );
  }
  log(`smoke check: --help OK (${helpResult.split('\n').length} lines, all six subcommands present)`);
}

function checkSizeWarning(binaryPath) {
  // AC6: warn if size is outside the empirical 50-110 MB range. Not a hard
  // fail — Node version bumps may shift the band, and a hard fail would
  // couple this story to a moving target.
  const { size } = statSync(binaryPath);
  const sizeMB = (size / (1024 * 1024)).toFixed(1);
  if (size < SIZE_MIN_BYTES || size > SIZE_MAX_BYTES) {
    const minMB = (SIZE_MIN_BYTES / (1024 * 1024)).toFixed(0);
    const maxMB = (SIZE_MAX_BYTES / (1024 * 1024)).toFixed(0);
    warn(
      `binary size ${sizeMB} MB is outside expected ${minMB}-${maxMB} MB range. ` +
        `This is a warning, not a failure — Node SEA size varies with the Node runtime version.`,
    );
  } else {
    log(`binary size: ${sizeMB} MB (within expected range)`);
  }
}

async function main() {
  const platform = process.platform;
  const arch = process.arch;

  // AC9: validate FIRST, fail before any work.
  let target;
  try {
    target = validatePlatform(platform, arch);
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(2);
  }

  log(`host: ${platform}-${arch} → target: ${target.outputBase}${target.ext}`);

  // Ensure the bundled entry point exists. AC2 says: minimum is an existence
  // check; the orchestration can call `npm run build` unconditionally for
  // simplicity in CI. We do existence-check + clear error so local devs get
  // an actionable message instead of a confusing SEA failure.
  // tsup emits the bundled SEA entry as `.cjs` (see config #2 in
  // tsup.config.ts). The `.cjs` extension is load-bearing: it forces Node
  // to treat the file as CommonJS, sidestepping the parent package.json's
  // `"type": "module"` declaration that would otherwise route the file to
  // the ESM loader and crash SEA's `embedderRunCjs` path.
  const bundledEntry = join(repoRoot, 'dist', 'cmemmov-bundled.cjs');
  if (!existsSync(bundledEntry)) {
    throw new Error(
      `bundled entry not found at ${bundledEntry}. Run 'npm run build' first.`,
    );
  }

  const seaPrepDir = join(repoRoot, 'dist', 'sea-prep');
  ensureDir(seaPrepDir);
  const binariesDir = join(repoRoot, 'dist', 'binaries');
  ensureDir(binariesDir);

  // Step 1: write the sea-config.
  const seaConfigPath = join(seaPrepDir, 'sea-config.json');
  const blobPath = join(seaPrepDir, 'cmemmov.blob');
  // Node 22 SEA only supports CommonJS as the main script format. The
  // `"mainFormat": "module"` option exists in Node 23+ docs but is not
  // recognized in v22 — Node still routes the embedded main through
  // `embedderRunCjs`. The tsup config (see config #2 in tsup.config.ts)
  // emits `dist/cmemmov-bundled.js` as CJS specifically so this entry
  // works under SEA on Node 22. `useSnapshot` deferred to a future story.
  const seaConfig = {
    main: bundledEntry,
    output: blobPath,
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
  };
  writeFileSync(seaConfigPath, JSON.stringify(seaConfig, null, 2), 'utf8');
  log(`wrote sea-config: ${seaConfigPath}`);

  // Step 2: produce the SEA blob.
  execFileSync(process.execPath, ['--experimental-sea-config', seaConfigPath], {
    stdio: 'inherit',
  });
  log(`produced SEA blob: ${blobPath}`);

  // Step 3: copy the Node binary to the output path.
  const outputBinary = binaryOutputPath(platform, arch);
  copyFileSync(process.execPath, outputBinary);
  // Make sure it's executable on POSIX (NTFS doesn't use unix perms).
  if (platform !== 'win32') {
    chmodSync(outputBinary, 0o755);
  }
  log(`copied node runtime → ${outputBinary}`);

  // Step 4 (macOS only): strip the existing codesign signature before postject.
  if (target.macho) {
    try {
      execFileSync('codesign', ['--remove-signature', outputBinary], {
        stdio: 'inherit',
      });
      log(`codesign --remove-signature OK`);
    } catch (err) {
      // If the binary wasn't signed, codesign exits non-zero; treat as soft warning.
      warn(`codesign --remove-signature failed (continuing): ${err.message}`);
    }
  }

  // Step 5: inject the blob via postject.
  const postjectArgs = [
    'postject',
    outputBinary,
    'NODE_SEA_BLOB',
    blobPath,
    '--sentinel-fuse',
    'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  ];
  if (target.macho) {
    postjectArgs.push('--macho-segment-name', 'NODE_SEA');
  }
  // Use `npx --yes postject` so the script is non-interactive in CI even if
  // postject isn't installed locally. AC2 implementation guidance says: don't
  // shell out via string `exec` — use execFileSync with an arg array.
  // `npx` lives next to node on POSIX and at `<node-dir>/npx.cmd` on Windows.
  const npxBin = platform === 'win32' ? 'npx.cmd' : 'npx';
  execFileSync(npxBin, ['--yes', ...postjectArgs], {
    stdio: 'inherit',
    shell: platform === 'win32',
  });
  log(`postject injected blob into ${outputBinary}`);

  // Step 6 (macOS only): ad-hoc re-sign the binary. AC5.
  if (target.macho) {
    execFileSync('codesign', ['--sign', '-', '--force', outputBinary], {
      stdio: 'inherit',
    });
    log(`codesign --sign - --force OK (ad-hoc signature)`);
  }

  // Step 7: smoke checks (AC4). If they fail, exit non-zero so CI gates here.
  runSmokeCheck(outputBinary);

  // Step 8: size warning band (AC6).
  checkSizeWarning(outputBinary);

  log(`done: ${outputBinary}`);
}

// Only run main() when invoked directly (not when imported by tests).
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  main().catch((err) => {
    process.stderr.write(`[build-binary] ERROR: ${err.message}\n`);
    if (err.stderr) process.stderr.write(`${err.stderr}\n`);
    process.exit(1);
  });
}
