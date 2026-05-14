import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { run as exportRun } from '../../src/commands/export.js';
import { run as importRun } from '../../src/commands/import.js';
import * as prompts from '../../src/ui/prompts.js';
import { seedClaudeTree, type TempClaudeDir } from './helpers/temp-claude-dir.js';
import { mockPlatform, type PlatformMock } from './helpers/platform-mock.js';
import { snapshotTree } from './helpers/snapshot-tree.js';

// claudeJson is exported unconditionally and isn't user-selectable; the list
// below names the every other category we want shipped through the bundle.
const ALL_CATS =
  'globalSettings,projectSettings,globalMemory,projectMemory,claudeMd,customCommands';

const CROSS_OS_CASES = [
  { src: 'win32',  srcUser: 'alice', tgt: 'darwin', tgtUser: 'maya' },
  { src: 'win32',  srcUser: 'alice', tgt: 'linux',  tgtUser: 'maya' },
  { src: 'darwin', srcUser: 'alice', tgt: 'win32',  tgtUser: 'maya' },
  { src: 'darwin', srcUser: 'alice', tgt: 'linux',  tgtUser: 'maya' },
  { src: 'linux',  srcUser: 'alice', tgt: 'darwin', tgtUser: 'maya' },
  { src: 'linux',  srcUser: 'alice', tgt: 'win32',  tgtUser: 'maya' },
] as const;

type CrossOsCase = (typeof CROSS_OS_CASES)[number];

interface CrossOsContext {
  src: TempClaudeDir;
  bundlePath: string;
  tgtTmpRoot: string;
  tgtClaudeDir: string;
  tgtClaudeJsonPath: string;
  platformMock: PlatformMock;
  originalEnvDir: string | undefined;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

async function setupSourceAndExport(c: CrossOsCase): Promise<{
  src: TempClaudeDir;
  bundlePath: string;
}> {
  // Mock platform to source FIRST so bundle.sourcePlatform is set correctly
  // by export-selection.assertSupportedPlatform(process.platform).
  const srcMock = mockPlatform(c.src);
  try {
    const src = await seedClaudeTree({
      sourcePlatform: c.src,
      sourceUser: c.srcUser,
      targetUser: c.tgtUser,
    });
    process.env.CLAUDE_CONFIG_DIR = join(src.tmpRoot, '.claude');

    const bundlePath = join(src.tmpRoot, 'export.cmemmov');
    await exportRun({
      silent: true,
      json: true,
      categories: ALL_CATS,
      allProjects: true,
      output: bundlePath,
      includeCredentials: false,
    });

    return { src, bundlePath };
  } finally {
    srcMock.restore();
  }
}

async function setupTargetTree(c: CrossOsCase): Promise<{
  tgtTmpRoot: string;
  tgtClaudeDir: string;
  tgtClaudeJsonPath: string;
  platformMock: PlatformMock;
}> {
  const tgtTmpRoot = await mkdtemp(join(tmpdir(), 'cmemmov-crossos-tgt-'));
  const tgtClaudeDir = join(tgtTmpRoot, '.claude');
  const tgtClaudeJsonPath = join(tgtTmpRoot, '.claude.json');
  await mkdir(tgtClaudeDir, { recursive: true });
  process.env.CLAUDE_CONFIG_DIR = tgtClaudeDir;
  const platformMock = mockPlatform(c.tgt);
  return { tgtTmpRoot, tgtClaudeDir, tgtClaudeJsonPath, platformMock };
}

async function teardownContext(ctx: CrossOsContext | undefined): Promise<void> {
  if (ctx === undefined) return;
  ctx.platformMock.restore();
  if (ctx.originalEnvDir === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR;
  } else {
    process.env.CLAUDE_CONFIG_DIR = ctx.originalEnvDir;
  }
  await rm(ctx.src.tmpRoot, { recursive: true, force: true });
  await rm(ctx.tgtTmpRoot, { recursive: true, force: true });
}

describe('cross-OS import round-trips', () => {
  let ctx: CrossOsContext | undefined;

  beforeEach(() => {
    ctx = undefined;
  });

  afterEach(async () => {
    await teardownContext(ctx);
    ctx = undefined;
  });

  it.each(CROSS_OS_CASES)(
    'src:$src → tgt:$tgt full round-trip',
    async (c) => {
      const originalEnvDir = process.env.CLAUDE_CONFIG_DIR;
      const { src, bundlePath } = await setupSourceAndExport(c);
      const tgt = await setupTargetTree(c);

      ctx = {
        src,
        bundlePath,
        tgtTmpRoot: tgt.tgtTmpRoot,
        tgtClaudeDir: tgt.tgtClaudeDir,
        tgtClaudeJsonPath: tgt.tgtClaudeJsonPath,
        platformMock: tgt.platformMock,
        originalEnvDir,
      };

      // --remap source home prefix → real target tmpdir. The target home is
      // the REAL on-disk tmpdir so the substituted path lands in a writable
      // location that satisfies isInsideHome().
      const remapSpec = `${src.homeDir}=${tgt.tgtTmpRoot}`;

      await importRun(bundlePath, {
        mode: 'merge',
        silent: true,
        json: true,
        remap: [remapSpec],
      });

      // AC #3 (per lead direction): on-disk project directory keeps the SOURCE
      // slug. Only path strings INSIDE settings.json / .claude.json are rewritten
      // to target-OS style. Story 3.x ("fix-paths") handles directory renames.
      const projectDirOnDisk = join(tgt.tgtClaudeDir, 'projects', src.projectSlug);
      expect(await pathExists(projectDirOnDisk)).toBe(true);

      // Project settings.json: permission rule paths must use target-OS
      // separators. The seed fixture has a `Write(<srcHome>/projects/my-app/**)`
      // rule whose path prefix matches the --remap rule, so it gets rewritten.
      const projSettingsPath = join(projectDirOnDisk, 'settings.json');
      const projSettingsRaw = await readFile(projSettingsPath, 'utf8');
      const projSettings = JSON.parse(projSettingsRaw) as {
        permissions: string[];
      };
      const writeRule = projSettings.permissions.find((r) => r.startsWith('Write('));
      expect(writeRule).toBeDefined();
      // The write rule was the source-OS-style write permission. After remap
      // it must reference the target tmpdir.
      expect(writeRule).toContain(tgt.tgtTmpRoot);
      // The mocked-target tests still run on a real OS — `tgtTmpRoot` uses the
      // runtime-OS separator regardless of the mocked target. What we can
      // guarantee end-to-end is that the SUFFIX from the source bundle got
      // normalized to match `tgtTmpRoot`'s separator style. Verify the suffix
      // after the tmpdir prefix contains only the runtime separator (no
      // leakage of the foreign separator from the source-OS suffix).
      const writeSuffix = (writeRule ?? '').slice(
        (writeRule ?? '').indexOf(tgt.tgtTmpRoot) + tgt.tgtTmpRoot.length,
      );
      // Strip the closing `)` so we're only inspecting the path tail.
      const writePathTail = writeSuffix.replace(/\)$/, '');
      const runtimeUsesBackslash = tgt.tgtTmpRoot.includes('\\');
      if (runtimeUsesBackslash) {
        expect(writePathTail.includes('/')).toBe(false);
      } else {
        expect(writePathTail.includes('\\')).toBe(false);
      }

      // Global settings.json — the global `Read(...)` rule references the
      // TARGET user's projects dir (not the source user's), so it has no
      // matching --remap entry and should pass through unchanged. Verify the
      // file exists and parses.
      const globalSettingsRaw = await readFile(
        join(tgt.tgtClaudeDir, 'settings.json'),
        'utf8',
      );
      const globalSettings = JSON.parse(globalSettingsRaw) as { model?: string };
      expect(globalSettings.model).toBe('sonnet');

      // .claude.json on the target: lastSessionCwd, currentProject, and
      // recentProjects[0].path must all be rewritten to target-OS-style paths
      // rooted at tgtTmpRoot.
      const tgtClaudeJsonRaw = await readFile(tgt.tgtClaudeJsonPath, 'utf8');
      const tgtClaudeJson = JSON.parse(tgtClaudeJsonRaw) as {
        lastSessionCwd: string;
        currentProject: string;
        recentProjects: { path: string }[];
      };
      expect(tgtClaudeJson.lastSessionCwd.startsWith(tgt.tgtTmpRoot)).toBe(true);
      expect(tgtClaudeJson.currentProject.startsWith(tgt.tgtTmpRoot)).toBe(true);
      expect(tgtClaudeJson.recentProjects[0]?.path.startsWith(tgt.tgtTmpRoot)).toBe(true);

      // Separator-style assertion on .claude.json paths: the suffix after
      // `tgtTmpRoot` must contain only the runtime-OS separator. Source-OS
      // separators in the originalPath suffix get normalized by
      // remapByDecisions, so a `darwin → win32` test on a Linux runner sees
      // only `/` after the tmpdir prefix.
      const lastSessionTail = tgtClaudeJson.lastSessionCwd.slice(
        tgtClaudeJson.lastSessionCwd.indexOf(tgt.tgtTmpRoot) +
          tgt.tgtTmpRoot.length,
      );
      if (runtimeUsesBackslash) {
        expect(lastSessionTail.includes('/')).toBe(false);
      } else {
        expect(lastSessionTail.includes('\\')).toBe(false);
      }

      // Global memory MEMORY.md exists in the target tree and references the
      // single seeded note file. AC #3 phrasing — "MEMORY.md indexes match the
      // on-disk file layout" — also requires the referenced file to be present
      // in the target tree, not just mentioned in the index.
      const tgtMemoryIndex = await readFile(
        join(tgt.tgtClaudeDir, 'memory', 'MEMORY.md'),
        'utf8',
      );
      expect(tgtMemoryIndex).toContain('note.md');
      expect(await pathExists(join(tgt.tgtClaudeDir, 'memory', 'note.md'))).toBe(true);
    },
  );
});

describe('cross-OS edge cases', () => {
  let ctx: CrossOsContext | undefined;

  beforeEach(() => {
    ctx = undefined;
  });

  afterEach(async () => {
    await teardownContext(ctx);
    ctx = undefined;
  });

  // AC #4: when a project is skipped via the cross-OS prompt, the post-import
  // target tree does NOT contain that project's directory. Use vi.spyOn on
  // the interactive prompt (instead of vi.mock at module level, which would
  // hoist and break locator behavior).
  it('skips a project when user chooses skip in interactive cross-OS mode', async () => {
    const c: CrossOsCase = {
      src: 'darwin',
      srcUser: 'alice',
      tgt: 'linux',
      tgtUser: 'maya',
    };
    const originalEnvDir = process.env.CLAUDE_CONFIG_DIR;
    const { src, bundlePath } = await setupSourceAndExport(c);
    const tgt = await setupTargetTree(c);
    ctx = {
      src,
      bundlePath,
      tgtTmpRoot: tgt.tgtTmpRoot,
      tgtClaudeDir: tgt.tgtClaudeDir,
      tgtClaudeJsonPath: tgt.tgtClaudeJsonPath,
      platformMock: tgt.platformMock,
      originalEnvDir,
    };

    const spy = vi
      .spyOn(prompts, 'confirmCrossOsPath')
      .mockResolvedValue({ action: 'skip', path: '' });

    try {
      // Non-silent cross-OS mode (no --remap, no silent flag) routes through
      // confirmCrossOsPath. With our spy returning { action: 'skip' }, the
      // single project is skipped. Import then throws IMPORT_PARTIAL because
      // every project was skipped — that's expected per import.ts behavior.
      await expect(
        importRun(bundlePath, { mode: 'merge', json: true }),
      ).rejects.toMatchObject({ code: 'IMPORT_PARTIAL' });
    } finally {
      spy.mockRestore();
    }

    // The skipped project's directory must NOT exist on the target tree —
    // applyProjectCategories filters by resolved (non-skipped) slugs.
    const skippedDir = join(tgt.tgtClaudeDir, 'projects', src.projectSlug);
    expect(await pathExists(skippedDir)).toBe(false);
  });

  // AC #5 (NFR12): dry-run produces ZERO changes on the target tree. Snapshot
  // before vs. after must be byte-for-byte identical.
  it('dry-run produces zero changes on target tree', async () => {
    const c: CrossOsCase = {
      src: 'win32',
      srcUser: 'alice',
      tgt: 'linux',
      tgtUser: 'maya',
    };
    const originalEnvDir = process.env.CLAUDE_CONFIG_DIR;
    const { src, bundlePath } = await setupSourceAndExport(c);
    const tgt = await setupTargetTree(c);
    ctx = {
      src,
      bundlePath,
      tgtTmpRoot: tgt.tgtTmpRoot,
      tgtClaudeDir: tgt.tgtClaudeDir,
      tgtClaudeJsonPath: tgt.tgtClaudeJsonPath,
      platformMock: tgt.platformMock,
      originalEnvDir,
    };

    // Byte-for-byte snapshot of the entire target tree (claudeDir +
    // adjacent .claude.json) BEFORE the dry run. AC #5 / NFR12: "byte-for-byte
    // snapshot of the target tree before vs. after is identical — zero
    // changes." Whole-tree comparison closes the gap that path-presence checks
    // would miss (e.g., a stray file written into an existing directory).
    const beforeTree = await snapshotTree(tgt.tgtClaudeDir);
    const beforeClaudeJson = (await pathExists(tgt.tgtClaudeJsonPath))
      ? (await readFile(tgt.tgtClaudeJsonPath)).toString('base64')
      : null;

    await importRun(bundlePath, {
      mode: 'merge',
      silent: true,
      json: true,
      dryRun: true,
      remap: [`${src.homeDir}=${tgt.tgtTmpRoot}`],
    });

    const afterTree = await snapshotTree(tgt.tgtClaudeDir);
    const afterClaudeJson = (await pathExists(tgt.tgtClaudeJsonPath))
      ? (await readFile(tgt.tgtClaudeJsonPath)).toString('base64')
      : null;
    expect(afterTree).toEqual(beforeTree);
    expect(afterClaudeJson).toEqual(beforeClaudeJson);
  });

  // AC #6: a corrupted bundle exits 2 with BUNDLE_CHECKSUM_MISMATCH; no
  // auto-backup is created (the parse step runs before backup); target tree
  // is untouched.
  it('corrupted bundle throws BUNDLE_CHECKSUM_MISMATCH and leaves target tree untouched', async () => {
    const c: CrossOsCase = {
      src: 'darwin',
      srcUser: 'alice',
      tgt: 'win32',
      tgtUser: 'maya',
    };
    const originalEnvDir = process.env.CLAUDE_CONFIG_DIR;
    const { src, bundlePath } = await setupSourceAndExport(c);
    const tgt = await setupTargetTree(c);
    ctx = {
      src,
      bundlePath,
      tgtTmpRoot: tgt.tgtTmpRoot,
      tgtClaudeDir: tgt.tgtClaudeDir,
      tgtClaudeJsonPath: tgt.tgtClaudeJsonPath,
      platformMock: tgt.platformMock,
      originalEnvDir,
    };

    // Corrupt the bundle in a way that keeps JSON parseable + schema-valid
    // but trips the SHA-256 integrity check: tweak a known string content
    // field. A blind byte-flip risks landing on a structural char and
    // surfacing as BUNDLE_INVALID_SCHEMA (not what AC #6 specifies). The
    // bundle for our seed is small enough that gzip is skipped (sessions are
    // empty in this case → < 5MB threshold), so we can JSON.parse → mutate →
    // re-serialize without touching the integrity field, leaving the stored
    // hash mismatching the recomputed one on read.
    const raw = await readFile(bundlePath, 'utf8');
    const parsed = JSON.parse(raw) as {
      global: { claudeMd?: string };
    };
    if (typeof parsed.global.claudeMd === 'string') {
      parsed.global.claudeMd = parsed.global.claudeMd + ' /* tampered */';
    } else {
      parsed.global.claudeMd = '# tampered';
    }
    await writeFile(bundlePath, JSON.stringify(parsed, null, 2), 'utf8');

    await expect(
      importRun(bundlePath, {
        mode: 'merge',
        silent: true,
        json: true,
        remap: [`${src.homeDir}=${tgt.tgtTmpRoot}`],
      }),
    ).rejects.toMatchObject({ code: 'BUNDLE_CHECKSUM_MISMATCH' });

    // No project directory was written.
    const projectDir = join(tgt.tgtClaudeDir, 'projects', src.projectSlug);
    expect(await pathExists(projectDir)).toBe(false);
    // No backup was created — parseBundle runs before createBackup, so a
    // checksum mismatch short-circuits before the backups dir comes into
    // existence.
    expect(await pathExists(join(tgt.tgtClaudeDir, 'backups'))).toBe(false);
    // No .claude.json was written on the target.
    expect(await pathExists(tgt.tgtClaudeJsonPath)).toBe(false);
  });
});
