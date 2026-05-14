import { vi, describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { run as shareRun } from '../../src/commands/share.js';
import { run as importRun } from '../../src/commands/import.js';
import { BundleSchema } from '../../src/core/bundle-schema.js';
import {
  seedShareSourceTree,
  type ShareSourceTempClaudeDir,
} from './helpers/temp-claude-dir.js';
import { mockPlatform, type PlatformMock } from './helpers/platform-mock.js';
import { snapshotTree } from './helpers/snapshot-tree.js';

// Intercept getSourceHomedir so integration tests can inject a deterministic
// fake homedir (tmpRoot) without calling os.homedir() in test code.
// locateClaude passes through to the real implementation so CLAUDE_CONFIG_DIR
// is honoured for each test.
const homedirState = { value: '' };
vi.mock('../../src/services/claude-locator.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/services/claude-locator.js')>();
  return {
    ...real,
    getSourceHomedir: () => homedirState.value,
  };
});

// Use the runtime platform for tests that don't need cross-platform behavior.
// This ensures isAbsolutePath() in the sanitization rules matches correctly.
const RUNTIME_PLATFORM: 'win32' | 'linux' = process.platform === 'win32' ? 'win32' : 'linux';

const SHARE_CATS = 'claudeMd,customCommands,mcpConfig,settings,teams,plugins';

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

async function captureJsonRun(fn: () => Promise<void>): Promise<{
  parsed: Record<string, unknown>;
}> {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk as Buffer).toString('utf8'));
    return true;
  });
  try {
    await fn();
  } finally {
    spy.mockRestore();
  }
  const stdout = chunks.join('');
  const lastLine = stdout.split('\n').filter((l) => l.trim().length > 0).pop() ?? '';
  return { parsed: JSON.parse(lastLine) as Record<string, unknown> };
}

function silenceOutput(): { restore: () => void } {
  const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  return {
    restore: () => {
      out.mockRestore();
      err.mockRestore();
    },
  };
}

interface TestCtx {
  tmpRoots: string[];
  originalEnvDir: string | undefined;
  platformMocks: PlatformMock[];
}

function makeCtx(src: ShareSourceTempClaudeDir): TestCtx {
  return {
    tmpRoots: [src.tmpRoot],
    originalEnvDir: process.env.CLAUDE_CONFIG_DIR,
    platformMocks: [],
  };
}

async function teardown(ctx: TestCtx | undefined): Promise<void> {
  // Defensive reset: even if a test panics after setting homedirState.value
  // but before its per-test cleanup runs, the next test must start with a
  // clean slate. Done unconditionally and BEFORE the ctx-undefined guard so
  // it fires on every test exit regardless of ctx state.
  homedirState.value = '';
  if (ctx === undefined) return;
  for (const m of ctx.platformMocks) m.restore();
  if (ctx.originalEnvDir === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR;
  } else {
    process.env.CLAUDE_CONFIG_DIR = ctx.originalEnvDir;
  }
  for (const root of ctx.tmpRoots) {
    await rm(root, { recursive: true, force: true });
  }
}

async function makeTarget(ctx: TestCtx): Promise<{ tgtTmpRoot: string; tgtClaudeDir: string }> {
  const tgtTmpRoot = await mkdtemp(join(tmpdir(), 'cmemmov-share-tgt-'));
  ctx.tmpRoots.push(tgtTmpRoot);
  const tgtClaudeDir = join(tgtTmpRoot, '.claude');
  await mkdir(tgtClaudeDir, { recursive: true });
  return { tgtTmpRoot, tgtClaudeDir };
}

describe('share + team bundle round-trip integration tests', () => {
  let ctx: TestCtx | undefined;

  afterEach(async () => {
    await teardown(ctx);
    ctx = undefined;
  });

  it('(a) round trip: share produces a valid team-baseline bundle and import lands it on a clean target', async () => {
    const src = await seedShareSourceTree({ sourcePlatform: RUNTIME_PLATFORM });
    ctx = makeCtx(src);
    homedirState.value = src.sourceHomedir;
    process.env.CLAUDE_CONFIG_DIR = join(src.tmpRoot, '.claude');

    const bundlePath = join(src.tmpRoot, 'team-baseline.cmemmov');
    const { parsed: shareParsed } = await captureJsonRun(() =>
      shareRun({ silent: true, json: true, categories: SHARE_CATS, output: bundlePath }),
    );

    expect(await pathExists(bundlePath)).toBe(true);
    const shareSummary = shareParsed.summary as Record<string, unknown>;
    expect(shareSummary.dryRun).toBeUndefined();

    const bundle = BundleSchema.parse(JSON.parse(await readFile(bundlePath, 'utf8')));

    expect(bundle.profile).toBe('team-baseline');
    expect(bundle.global.claudeMd).toBe('# Global memory\n');

    // Custom command in bundle
    const cmds = bundle.global.customCommands ?? [];
    expect(cmds.some((c) => c.filename === 'team-cmd.md')).toBe(true);

    // MCP servers: network and bare-program preserved; local stripped
    const settings = bundle.global.settings as Record<string, unknown> | undefined;
    const mcpServers = settings?.mcpServers as Record<string, unknown> | undefined;
    expect(mcpServers).toBeDefined();
    expect(Object.keys(mcpServers ?? {})).toContain('internal-toolserver');
    expect(Object.keys(mcpServers ?? {})).toContain('bare-program');
    expect(Object.keys(mcpServers ?? {})).not.toContain('fileserver-local');

    // Home-dir permission rule stripped
    const homeDirRules = bundle.wasRedacted?.homeDirPermissionRules ?? [];
    expect(homeDirRules.some((r) => r.includes(src.sourceHomedir))).toBe(true);

    // Local MCP server stripped
    expect(bundle.wasRedacted?.localMcpServers ?? []).toContain('fileserver-local');

    // claudeJson user-id fields stripped (seeded fields)
    const claudeJsonFields = bundle.wasRedacted?.claudeJsonFields ?? [];
    expect(claudeJsonFields).toContain('email');
    expect(claudeJsonFields).toContain('machineId');
    expect(claudeJsonFields).toContain('recentProjects');
    expect(claudeJsonFields).toContain('lastSessionCwd');

    // NFR6 layer 2: share calls buildBundle({ includeCredentials: false }), so
    // bundle.credentials is never populated. wasRedacted.credentials does NOT
    // fire for share (that record is reserved for callers who actually feed
    // credentials into applySanitization, e.g., export with
    // --include-credentials). The byte-sweep test in (f) below is the
    // mechanical NFR6 guarantee for share.
    expect(bundle.credentials).toBeUndefined();

    // Import onto clean target
    const { tgtClaudeDir } = await makeTarget(ctx);

    // Pre-seed target credentials to verify they are NOT overwritten
    const targetCredContent = JSON.stringify({ token: 'target-machine-credentials-DO-NOT-OVERWRITE' });
    await writeFile(join(tgtClaudeDir, '.credentials.json'), targetCredContent, 'utf8');

    process.env.CLAUDE_CONFIG_DIR = tgtClaudeDir;
    const silence = silenceOutput();
    try {
      await importRun(bundlePath, { silent: true, json: true, mode: 'merge' });
    } finally {
      silence.restore();
    }

    // CLAUDE.md and custom command landed
    expect(await pathExists(join(tgtClaudeDir, 'CLAUDE.md'))).toBe(true);
    expect(await pathExists(join(tgtClaudeDir, 'commands', 'team-cmd.md'))).toBe(true);

    // settings.json on target: safe rules preserved, home-dir rule absent, local MCP absent
    const tgtSettings = JSON.parse(
      await readFile(join(tgtClaudeDir, 'settings.json'), 'utf8'),
    ) as Record<string, unknown>;
    const perms = tgtSettings.permissions as string[] | undefined;
    expect(perms?.some((r) => r.includes('./local-thing'))).toBe(true);
    expect(perms?.some((r) => r.includes('git status'))).toBe(true);
    expect(perms?.some((r) => r.includes(src.sourceHomedir))).toBe(false);

    const tgtMcp = tgtSettings.mcpServers as Record<string, unknown> | undefined;
    expect(Object.keys(tgtMcp ?? {})).not.toContain('fileserver-local');

    // Memory: personalNotes absent, teamConventions present
    // (share categories don't include globalMemory, so no memories are imported)
    expect(await pathExists(join(tgtClaudeDir, 'memory', 'personal_notes.md'))).toBe(false);

    // Target credentials untouched
    const afterCred = await readFile(join(tgtClaudeDir, '.credentials.json'), 'utf8');
    expect(afterCred).toBe(targetCredContent);
  });

  it('(b) --include-credentials is rejected at parse time with SHARE_INVALID_SOURCE and writes no bundle', async () => {
    const src = await seedShareSourceTree({ sourcePlatform: RUNTIME_PLATFORM });
    ctx = makeCtx(src);
    homedirState.value = src.sourceHomedir;
    process.env.CLAUDE_CONFIG_DIR = join(src.tmpRoot, '.claude');

    const outputPath = join(src.tmpRoot, 'should-not-exist.cmemmov');

    // Silent mode — parse-time check
    await expect(
      shareRun({ silent: true, includeCredentials: true, categories: SHARE_CATS, output: outputPath }),
    ).rejects.toMatchObject({ code: 'SHARE_INVALID_SOURCE', exitCode: 2 });
    expect(await pathExists(outputPath)).toBe(false);

    // Non-silent mode — parse-time check fires BEFORE any prompts
    await expect(
      shareRun({ includeCredentials: true, categories: SHARE_CATS, output: outputPath }),
    ).rejects.toMatchObject({ code: 'SHARE_INVALID_SOURCE', exitCode: 2 });
    expect(await pathExists(outputPath)).toBe(false);
  });

  it('(c) home-directory absolute-path permission rules are stripped from the produced bundle', async () => {
    for (const platform of ['win32', 'linux'] as const) {
      const origEnv = process.env.CLAUDE_CONFIG_DIR;
      const mock = mockPlatform(platform);
      const src = await seedShareSourceTree({ sourcePlatform: platform });
      homedirState.value = src.sourceHomedir;
      try {
        process.env.CLAUDE_CONFIG_DIR = join(src.tmpRoot, '.claude');
        const bundlePath = join(src.tmpRoot, `c-${platform}.cmemmov`);
        const silence = silenceOutput();
        try {
          await shareRun({ silent: true, json: true, categories: SHARE_CATS, output: bundlePath });
        } finally {
          silence.restore();
        }

        const bundle = BundleSchema.parse(JSON.parse(await readFile(bundlePath, 'utf8')));
        const homeDirRules = bundle.wasRedacted?.homeDirPermissionRules ?? [];
        // The home-dir absolute permission rule must be recorded in wasRedacted
        expect(homeDirRules.length).toBeGreaterThanOrEqual(1);
        expect(homeDirRules.some((r) => r.includes(src.sourceHomedir))).toBe(true);

        // No remaining permission contains the source home dir as absolute path arg
        const settings = bundle.global.settings as Record<string, unknown> | undefined;
        const perms = (settings?.permissions ?? []) as string[];
        for (const rule of perms) {
          const argMatch = /^\w+\((.+)\)$/.exec(rule);
          if (argMatch?.[1] !== undefined) {
            const arg = argMatch[1];
            const startsWithHome =
              platform === 'win32'
                ? arg.toLowerCase().startsWith(src.sourceHomedir.toLowerCase())
                : arg.startsWith(src.sourceHomedir);
            expect(startsWithHome).toBe(false);
          }
        }
      } finally {
        mock.restore();
        if (origEnv === undefined) {
          delete process.env.CLAUDE_CONFIG_DIR;
        } else {
          process.env.CLAUDE_CONFIG_DIR = origEnv;
        }
        await rm(src.tmpRoot, { recursive: true, force: true });
      }
    }
    // ctx is undefined — tmpRoots cleaned up in the loop
  });

  it('(d) network-path MCP server is preserved verbatim through share AND import', async () => {
    for (const platform of ['win32', 'linux'] as const) {
      const origEnv = process.env.CLAUDE_CONFIG_DIR;
      const mock = mockPlatform(platform);
      const src = await seedShareSourceTree({ sourcePlatform: platform });
      homedirState.value = src.sourceHomedir;
      try {
        process.env.CLAUDE_CONFIG_DIR = join(src.tmpRoot, '.claude');
        const bundlePath = join(src.tmpRoot, `d-${platform}.cmemmov`);
        const silence = silenceOutput();
        try {
          await shareRun({ silent: true, json: true, categories: SHARE_CATS, output: bundlePath });
        } finally {
          silence.restore();
        }

        const bundle = BundleSchema.parse(JSON.parse(await readFile(bundlePath, 'utf8')));
        const settings = bundle.global.settings as Record<string, unknown> | undefined;
        const mcpServers = settings?.mcpServers as Record<string, unknown> | undefined;
        expect(Object.keys(mcpServers ?? {})).toContain('internal-toolserver');

        const expectedCmd =
          platform === 'win32'
            ? '\\\\internal\\toolserver\\bin\\server.exe'
            : '//internal/toolserver/bin/server';
        const netServer = mcpServers?.['internal-toolserver'] as Record<string, unknown> | undefined;
        expect(netServer?.command).toBe(expectedCmd);

        // Import and verify network MCP lands on target
        const tgtTmpRoot = await mkdtemp(join(tmpdir(), 'cmemmov-share-tgt-'));
        const tgtClaudeDir = join(tgtTmpRoot, '.claude');
        await mkdir(tgtClaudeDir, { recursive: true });
        process.env.CLAUDE_CONFIG_DIR = tgtClaudeDir;
        const importSilence = silenceOutput();
        try {
          await importRun(bundlePath, { silent: true, json: true, mode: 'merge' });
        } finally {
          importSilence.restore();
        }

        const tgtSettings = JSON.parse(
          await readFile(join(tgtClaudeDir, 'settings.json'), 'utf8'),
        ) as Record<string, unknown>;
        const tgtMcp = tgtSettings.mcpServers as Record<string, unknown> | undefined;
        expect(Object.keys(tgtMcp ?? {})).toContain('internal-toolserver');
        const tgtNet = tgtMcp?.['internal-toolserver'] as Record<string, unknown> | undefined;
        expect(tgtNet?.command).toBe(expectedCmd);

        await rm(tgtTmpRoot, { recursive: true, force: true });
      } finally {
        mock.restore();
        if (origEnv === undefined) {
          delete process.env.CLAUDE_CONFIG_DIR;
        } else {
          process.env.CLAUDE_CONFIG_DIR = origEnv;
        }
        await rm(src.tmpRoot, { recursive: true, force: true });
      }
    }
    // ctx is undefined — tmpRoots cleaned up in the loop
  });

  it('(e) personal memory file is excluded from the bundle and absent on the target', async () => {
    const src = await seedShareSourceTree({ sourcePlatform: RUNTIME_PLATFORM, credentials: true });
    ctx = makeCtx(src);
    homedirState.value = src.sourceHomedir;
    process.env.CLAUDE_CONFIG_DIR = join(src.tmpRoot, '.claude');

    // Explicitly verify personal_notes.md EXISTS in the source (non-vacuous)
    expect(await pathExists(join(src.tmpRoot, '.claude', 'memory', 'personal_notes.md'))).toBe(true);

    const bundlePath = join(src.tmpRoot, 'team-baseline.cmemmov');
    const silence = silenceOutput();
    try {
      await shareRun({ silent: true, json: true, categories: SHARE_CATS, output: bundlePath });
    } finally {
      silence.restore();
    }

    const bundle = BundleSchema.parse(JSON.parse(await readFile(bundlePath, 'utf8')));

    // globalMemory is not a share category, so memories are never in the bundle.
    // personal_notes.md must NOT be in any memory list.
    const globalMemories = bundle.global.memories ?? [];
    expect(globalMemories.some((m) => m.filename === 'personal_notes.md')).toBe(false);

    // Import and confirm personal notes absent on target
    const { tgtClaudeDir } = await makeTarget(ctx);
    process.env.CLAUDE_CONFIG_DIR = tgtClaudeDir;
    const importSilence = silenceOutput();
    try {
      await importRun(bundlePath, { silent: true, json: true, mode: 'merge' });
    } finally {
      importSilence.restore();
    }

    expect(await pathExists(join(tgtClaudeDir, 'memory', 'personal_notes.md'))).toBe(false);
  });

  it('(f) credential file present in source produces a bundle with no credential content (NFR6)', async () => {
    const src = await seedShareSourceTree({ sourcePlatform: RUNTIME_PLATFORM, credentials: true });
    ctx = makeCtx(src);
    homedirState.value = src.sourceHomedir;

    // Explicitly verify credentials file IS on disk before share (non-vacuous)
    expect(await pathExists(join(src.tmpRoot, '.claude', '.credentials.json'))).toBe(true);

    process.env.CLAUDE_CONFIG_DIR = join(src.tmpRoot, '.claude');
    const bundlePath = join(src.tmpRoot, 'team-baseline.cmemmov');
    const silence = silenceOutput();
    try {
      await shareRun({ silent: true, json: true, categories: SHARE_CATS, output: bundlePath });
    } finally {
      silence.restore();
    }

    expect(await pathExists(bundlePath)).toBe(true);

    // Raw bytes must not contain the credential sentinel
    const bundleText = await readFile(bundlePath, 'utf8');
    expect(bundleText.includes('secret-test-token-EYES-ONLY')).toBe(false);

    // NFR6 layer 2: share calls buildBundle({ includeCredentials: false }), so
    // bundle.credentials is never populated. wasRedacted.credentials does NOT
    // fire for share (that record is reserved for callers who actually feed
    // credentials into applySanitization, e.g., export with
    // --include-credentials). The byte-sweep above is the mechanical NFR6
    // guarantee for share.
    const bundle = BundleSchema.parse(JSON.parse(bundleText));
    expect(bundle.credentials).toBeUndefined();
    expect(bundle.hasCredentials).toBe(false);

    // Import; target credential must be untouched
    const { tgtClaudeDir } = await makeTarget(ctx);
    const targetCredContent = '{"token":"target-machine-credentials-DO-NOT-OVERWRITE"}';
    await writeFile(join(tgtClaudeDir, '.credentials.json'), targetCredContent, 'utf8');
    process.env.CLAUDE_CONFIG_DIR = tgtClaudeDir;
    const importSilence = silenceOutput();
    try {
      await importRun(bundlePath, { silent: true, json: true, mode: 'merge' });
    } finally {
      importSilence.restore();
    }

    const afterCred = await readFile(join(tgtClaudeDir, '.credentials.json'), 'utf8');
    expect(afterCred).toBe(targetCredContent);
  });

  it('(g) --dry-run produces zero filesystem changes', async () => {
    const src = await seedShareSourceTree({ sourcePlatform: RUNTIME_PLATFORM });
    ctx = makeCtx(src);
    homedirState.value = src.sourceHomedir;
    process.env.CLAUDE_CONFIG_DIR = join(src.tmpRoot, '.claude');

    const outputPath = join(src.tmpRoot, 'dry-run-output.cmemmov');
    const beforeSnapshot = await snapshotTree(src.tmpRoot);

    const { parsed } = await captureJsonRun(() =>
      shareRun({ silent: true, json: true, dryRun: true, categories: SHARE_CATS, output: outputPath }),
    );

    const afterSnapshot = await snapshotTree(src.tmpRoot);

    // Zero filesystem changes
    expect(afterSnapshot).toEqual(beforeSnapshot);
    expect(await pathExists(outputPath)).toBe(false);

    const summary = parsed.summary as Record<string, unknown>;
    expect(summary.dryRun).toBe(true);
  });

  it('(h) .claude.json user-identifying fields are stripped per CLAUDE_JSON_TEAM_ALLOWLIST', async () => {
    const src = await seedShareSourceTree({ sourcePlatform: RUNTIME_PLATFORM });
    ctx = makeCtx(src);
    homedirState.value = src.sourceHomedir;
    process.env.CLAUDE_CONFIG_DIR = join(src.tmpRoot, '.claude');

    const bundlePath = join(src.tmpRoot, 'team-baseline.cmemmov');
    const silence = silenceOutput();
    try {
      await shareRun({ silent: true, json: true, categories: SHARE_CATS, output: bundlePath });
    } finally {
      silence.restore();
    }

    const bundleText = await readFile(bundlePath, 'utf8');
    // Machine ID sentinel must not appear in bundle bytes
    expect(bundleText.includes('fake-machine-uuid-EYES-ONLY')).toBe(false);

    const bundle = BundleSchema.parse(JSON.parse(bundleText));

    // Allowlist fields survive
    const claudeJson = bundle.global.claudeJson as Record<string, unknown> | undefined;
    expect(claudeJson?.theme).toBe('dark');
    expect(claudeJson?.experiments).toEqual(['plus']);

    // Deny-listed fields stripped
    const stripped = bundle.wasRedacted?.claudeJsonFields ?? [];
    expect(stripped).toContain('email');
    expect(stripped).toContain('machineId');
    expect(stripped).toContain('recentProjects');
    expect(stripped).toContain('lastSessionCwd');
    expect(claudeJson?.email).toBeUndefined();
    expect(claudeJson?.machineId).toBeUndefined();
  });

  it('(i) custom commands survive the round trip', async () => {
    const src = await seedShareSourceTree({ sourcePlatform: RUNTIME_PLATFORM });
    ctx = makeCtx(src);
    homedirState.value = src.sourceHomedir;
    process.env.CLAUDE_CONFIG_DIR = join(src.tmpRoot, '.claude');

    const bundlePath = join(src.tmpRoot, 'team-baseline.cmemmov');
    const silence = silenceOutput();
    try {
      await shareRun({ silent: true, json: true, categories: SHARE_CATS, output: bundlePath });
    } finally {
      silence.restore();
    }

    const bundle = BundleSchema.parse(JSON.parse(await readFile(bundlePath, 'utf8')));
    const cmds = bundle.global.customCommands ?? [];
    const cmd = cmds.find((c) => c.filename === 'team-cmd.md');
    expect(cmd).toBeDefined();
    expect(cmd?.content).toContain('/team-cmd');

    // Import and verify command lands on target
    const { tgtClaudeDir } = await makeTarget(ctx);
    process.env.CLAUDE_CONFIG_DIR = tgtClaudeDir;
    const importSilence = silenceOutput();
    try {
      await importRun(bundlePath, { silent: true, json: true, mode: 'merge' });
    } finally {
      importSilence.restore();
    }

    const cmdPath = join(tgtClaudeDir, 'commands', 'team-cmd.md');
    expect(await pathExists(cmdPath)).toBe(true);
    const cmdContent = await readFile(cmdPath, 'utf8');
    expect(cmdContent).toContain('/team-cmd');
  });

  it('(j) local-path MCP server is stripped with a warning in summary.warnings', async () => {
    const src = await seedShareSourceTree({ sourcePlatform: RUNTIME_PLATFORM });
    ctx = makeCtx(src);
    homedirState.value = src.sourceHomedir;
    process.env.CLAUDE_CONFIG_DIR = join(src.tmpRoot, '.claude');

    const bundlePath = join(src.tmpRoot, 'team-baseline.cmemmov');
    const { parsed } = await captureJsonRun(() =>
      shareRun({ silent: true, json: true, categories: SHARE_CATS, output: bundlePath }),
    );

    expect(await pathExists(bundlePath)).toBe(true);

    const bundle = BundleSchema.parse(JSON.parse(await readFile(bundlePath, 'utf8')));
    const settings = bundle.global.settings as Record<string, unknown> | undefined;
    const mcpServers = settings?.mcpServers as Record<string, unknown> | undefined;
    expect(Object.keys(mcpServers ?? {})).not.toContain('fileserver-local');
    expect(bundle.wasRedacted?.localMcpServers ?? []).toContain('fileserver-local');

    // warnings array must mention fileserver-local
    const warnings = parsed.warnings as string[] | undefined;
    expect(Array.isArray(warnings)).toBe(true);
    const warningForLocal = (warnings ?? []).find((w) => w.includes('fileserver-local'));
    expect(warningForLocal).toBeDefined();
  });
});
