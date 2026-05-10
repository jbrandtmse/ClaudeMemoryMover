import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, stat, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToSlug } from '../../src/core/path-engine.js';
import { applyDecisions, run } from '../../src/commands/fix-paths.js';
import { seedClaudeTree, type TempClaudeDir } from './helpers/temp-claude-dir.js';
import { mockPlatform, type PlatformMock } from './helpers/platform-mock.js';

// Capture-and-parse the JSON line emitted by Output.finish (which writes to
// process.stdout). Mirrors the pattern in src/commands/fix-paths.test.ts so
// integration tests can assert on the structured summary without parsing
// human-readable progress lines.
async function captureJsonRun(
  fn: () => Promise<void>,
): Promise<{ stdout: string; lastLine: string; parsed: Record<string, unknown> }> {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  });
  try {
    await fn();
  } finally {
    spy.mockRestore();
  }
  const stdout = chunks.join('');
  const lastLine = stdout.split('\n').filter((l) => l.trim().length > 0).pop() ?? '';
  const parsed = JSON.parse(lastLine) as Record<string, unknown>;
  return { stdout, lastLine, parsed };
}

// Some integration tests exercise the non-JSON path so we must silence
// stdout/stderr to keep the test reporter readable.
function silenceStdio(): { restore: () => void } {
  const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  return {
    restore: (): void => {
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
    },
  };
}

interface TestCtx {
  tmpRoot: string;
  originalConfigDir: string | undefined;
}

async function makeBareTmp(): Promise<TestCtx> {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'cmemmov-fixpaths-'));
  const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = join(tmpRoot, '.claude');
  return { tmpRoot, originalConfigDir };
}

async function teardownTmp(ctx: TestCtx): Promise<void> {
  if (ctx.originalConfigDir === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR;
  } else {
    process.env.CLAUDE_CONFIG_DIR = ctx.originalConfigDir;
  }
  await rm(ctx.tmpRoot, { recursive: true, force: true });
}

interface SeededCtx {
  ctx: TempClaudeDir;
  originalConfigDir: string | undefined;
}

async function makeSeededTmp(): Promise<SeededCtx> {
  const ctx = await seedClaudeTree({
    sourcePlatform: 'linux',
    sourceUser: 'alice',
    targetUser: 'alice',
  });
  const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = join(ctx.tmpRoot, '.claude');
  return { ctx, originalConfigDir };
}

async function teardownSeeded(s: SeededCtx): Promise<void> {
  if (s.originalConfigDir === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR;
  } else {
    process.env.CLAUDE_CONFIG_DIR = s.originalConfigDir;
  }
  await rm(s.ctx.tmpRoot, { recursive: true, force: true });
}

// -----------------------------------------------------------------------------
// AC1(a): clean tree → all projects FOUND → early exit, no remap
// -----------------------------------------------------------------------------

describe('AC1(a): all projects FOUND → early exit, no remap', () => {
  let testCtx: TestCtx | undefined;

  afterEach(async () => {
    if (testCtx !== undefined) {
      await teardownTmp(testCtx);
      testCtx = undefined;
    }
  });

  it('emits "No projects need fixing." and creates no backup', async () => {
    testCtx = await makeBareTmp();
    const { tmpRoot } = testCtx;

    // Build a minimal fixture where the only project's session JSONL points
    // at an on-disk path so resolveOriginalPath returns a path that stat()s
    // successfully → exists: true → FOUND.
    const projectPath = join(tmpRoot, 'my-project');
    await mkdir(projectPath, { recursive: true });
    const slug = pathToSlug(projectPath);
    const sessionsDir = join(tmpRoot, '.claude', 'projects', slug, 'sessions');
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(
      join(sessionsDir, 'session.jsonl'),
      JSON.stringify({ type: 'message', cwd: projectPath }) + '\n',
      'utf8',
    );
    await writeFile(join(tmpRoot, '.claude.json'), JSON.stringify({}), 'utf8');

    const { parsed } = await captureJsonRun(() => run({ json: true }));
    const summary = parsed.summary as { text: string };
    expect(parsed.success).toBe(true);
    expect(summary.text).toBe('No projects need fixing.');

    // Backup dir must NOT exist — the early exit path skips applyDecisions.
    await expect(stat(join(tmpRoot, '.claude', 'backups'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});

// -----------------------------------------------------------------------------
// AC1(b) + AC2 + AC3: missing project → scripted --remap applies and renames
// -----------------------------------------------------------------------------

describe('AC1(b)+AC2+AC3: missing project → scripted --remap renames slug, updates .claude.json', () => {
  let seeded: SeededCtx | undefined;

  afterEach(async () => {
    if (seeded !== undefined) {
      await teardownSeeded(seeded);
      seeded = undefined;
    }
  });

  it('renames slug dir, updates .claude.json path fields, JSON output reports remap', async () => {
    seeded = await makeSeededTmp();
    const { ctx } = seeded;

    // ctx.projectRealPath = '/home/alice/projects/my-app' (does not exist on
    // disk → MISSING). Remap /home/alice/projects → /home/alice/new-projects.
    const targetPath = ctx.projectRealPath.replace(
      '/home/alice/projects',
      '/home/alice/new-projects',
    );
    const oldSlug = ctx.projectSlug;
    const newSlug = pathToSlug(targetPath);

    const { parsed } = await captureJsonRun(() =>
      run({
        json: true,
        silent: true,
        remap: ['/home/alice/projects=/home/alice/new-projects'],
      }),
    );

    // AC3: new slug present, old slug absent.
    const projectsDir = join(ctx.tmpRoot, '.claude', 'projects');
    await expect(stat(join(projectsDir, newSlug))).resolves.toBeDefined();
    await expect(stat(join(projectsDir, oldSlug))).rejects.toMatchObject({ code: 'ENOENT' });

    // AC3: .claude.json path fields rewritten to the target path.
    const claudeJson = JSON.parse(
      await readFile(join(ctx.tmpRoot, '.claude.json'), 'utf8'),
    ) as {
      lastSessionCwd: string;
      currentProject: string;
      recentProjects: { path: string }[];
    };
    expect(claudeJson.lastSessionCwd).toBe(targetPath);
    expect(claudeJson.currentProject).toBe(targetPath);
    expect(claudeJson.recentProjects[0]?.path).toBe(targetPath);

    // AC2: JSON summary structure — remappings array records the remap action
    // and the resolved targetPath.
    const summary = parsed.summary as {
      text: string;
      remappings: { action: string; targetPath: string | null }[];
      backupPath: string | null;
    };
    expect(parsed.success).toBe(true);
    expect(summary.remappings).toHaveLength(1);
    expect(summary.remappings[0]?.action).toBe('remap');
    expect(summary.remappings[0]?.targetPath).toBe(targetPath);

    // AC2: backup directory was created (live mode, not dry-run).
    expect(typeof summary.backupPath).toBe('string');
    await expect(stat(join(ctx.tmpRoot, '.claude', 'backups'))).resolves.toBeDefined();
  });
});

// -----------------------------------------------------------------------------
// AC1(c): mixed tree → only missing projects are remapped
// -----------------------------------------------------------------------------

describe('AC1(c): mixed tree — only missing projects are remapped', () => {
  let testCtx: TestCtx | undefined;

  afterEach(async () => {
    if (testCtx !== undefined) {
      await teardownTmp(testCtx);
      testCtx = undefined;
    }
  });

  it('FOUND project unchanged; MISSING project renamed via --silent --remap', async () => {
    testCtx = await makeBareTmp();
    const { tmpRoot } = testCtx;

    // FOUND project: a real on-disk path, session JSONL pointing at it.
    const foundPath = join(tmpRoot, 'found-project');
    await mkdir(foundPath, { recursive: true });
    const foundSlug = pathToSlug(foundPath);
    const foundSessionsDir = join(tmpRoot, '.claude', 'projects', foundSlug, 'sessions');
    await mkdir(foundSessionsDir, { recursive: true });
    await writeFile(
      join(foundSessionsDir, 's.jsonl'),
      JSON.stringify({ cwd: foundPath }) + '\n',
      'utf8',
    );

    // MISSING project: session points at a non-existent fake path.
    const missingPath = '/home/alice/projects/gone-app';
    const missingSlug = pathToSlug(missingPath);
    const missingSessionsDir = join(tmpRoot, '.claude', 'projects', missingSlug, 'sessions');
    await mkdir(missingSessionsDir, { recursive: true });
    await writeFile(
      join(missingSessionsDir, 's.jsonl'),
      JSON.stringify({ cwd: missingPath }) + '\n',
      'utf8',
    );

    await writeFile(
      join(tmpRoot, '.claude.json'),
      JSON.stringify({ lastSessionCwd: missingPath }),
      'utf8',
    );

    const { parsed } = await captureJsonRun(() =>
      run({
        json: true,
        silent: true,
        remap: ['/home/alice/projects=/home/alice/new-projects'],
      }),
    );

    const projectsDir = join(tmpRoot, '.claude', 'projects');
    // FOUND slug must still be present and its dir untouched.
    await expect(stat(join(projectsDir, foundSlug))).resolves.toBeDefined();
    // MISSING slug renamed to the remapped target slug.
    const newMissingSlug = pathToSlug('/home/alice/new-projects/gone-app');
    await expect(stat(join(projectsDir, missingSlug))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(stat(join(projectsDir, newMissingSlug))).resolves.toBeDefined();

    // JSON summary projects[] should reflect both inventory entries; only the
    // missing one should appear in remappings.
    const summary = parsed.summary as {
      projects: { exists: boolean }[];
      remappings: { action: string }[];
    };
    expect(summary.projects).toHaveLength(2);
    expect(summary.remappings).toHaveLength(1);
    expect(summary.remappings[0]?.action).toBe('remap');
  });
});

// -----------------------------------------------------------------------------
// AC1(d) + AC6: slug collision on apply → INTERNAL thrown, backup exists, slugs unchanged
// -----------------------------------------------------------------------------

describe('AC1(d)+AC6: slug collision → INTERNAL thrown, backup exists, slugs unchanged', () => {
  let seeded: SeededCtx | undefined;

  afterEach(async () => {
    if (seeded !== undefined) {
      await teardownSeeded(seeded);
      seeded = undefined;
    }
  });

  it('pre-existing target slug aborts before rename; backup already created with .claude.json snapshot', async () => {
    seeded = await makeSeededTmp();
    const { ctx } = seeded;

    // Pre-create the target slug dir AND make it look FOUND on disk: stage a
    // session JSONL whose `cwd` points at a real on-disk path so this slug is
    // not flagged MISSING. Otherwise the silent-mode remap pass would demand
    // a --remap rule for it (and not finding one would throw
    // PATH_REMAP_AMBIGUOUS instead of the INTERNAL collision we want to test).
    const targetPath = ctx.projectRealPath.replace(
      '/home/alice/projects',
      '/home/alice/new',
    );
    const newSlug = pathToSlug(targetPath);
    const newSlugSessionsDir = join(
      ctx.tmpRoot,
      '.claude',
      'projects',
      newSlug,
      'sessions',
    );
    await mkdir(newSlugSessionsDir, { recursive: true });
    // Anchor the existing-target slug to a real on-disk path so its scan
    // resolves to exists: true and the slug stays out of the missing list.
    const anchorPath = join(ctx.tmpRoot, 'collision-anchor');
    await mkdir(anchorPath, { recursive: true });
    await writeFile(
      join(newSlugSessionsDir, 's.jsonl'),
      JSON.stringify({ cwd: anchorPath }) + '\n',
      'utf8',
    );

    const stdio = silenceStdio();
    try {
      // AC6: the thrown CmemmovError must have code: 'INTERNAL' AND a hint
      // containing the colliding slug. Asserting on `hint` proves the user
      // gets a diagnostic message naming the exact slug that caused the abort.
      await expect(
        run({
          silent: true,
          remap: ['/home/alice/projects=/home/alice/new'],
        }),
      ).rejects.toMatchObject({
        code: 'INTERNAL',
        hint: expect.stringContaining(newSlug) as unknown as string,
      });
    } finally {
      stdio.restore();
    }

    // Both slugs (the original AND the pre-existing target) are unchanged.
    const projectsDir = join(ctx.tmpRoot, '.claude', 'projects');
    await expect(stat(join(projectsDir, ctx.projectSlug))).resolves.toBeDefined();
    await expect(stat(join(projectsDir, newSlug))).resolves.toBeDefined();

    // Backup directory exists — createBackup runs before the collision check.
    const backupRoot = join(ctx.tmpRoot, '.claude', 'backups', 'cmemmov');
    await expect(stat(backupRoot)).resolves.toBeDefined();
    const backupEntries = await readdir(backupRoot);
    expect(backupEntries.length).toBeGreaterThan(0);

    // The backup contains a snapshot of the pre-apply ~/.claude.json so the
    // user can roll back the partially-attempted operation.
    const firstBackup = backupEntries[0];
    if (firstBackup === undefined) throw new Error('expected at least one backup entry');
    await expect(stat(join(backupRoot, firstBackup, '.claude.json'))).resolves.toBeDefined();
  });
});

// -----------------------------------------------------------------------------
// AC1(e): memory-only project (no session JSONL) → slug decoded via slugToPath
// -----------------------------------------------------------------------------

describe('AC1(e): memory-only project — no session JSONL → slug decode fallback', () => {
  let testCtx: TestCtx | undefined;

  afterEach(async () => {
    if (testCtx !== undefined) {
      await teardownTmp(testCtx);
      testCtx = undefined;
    }
  });

  it('project with no sessions/ dir: resolveOriginalPath uses slugToPath, --remap applies', async () => {
    testCtx = await makeBareTmp();
    const { tmpRoot } = testCtx;

    // Pick a fake path encodable on the CURRENT runtime platform — slugToPath
    // is platform-aware so a POSIX runner needs a POSIX-style path here, and
    // a win32 runner needs a Windows-style path. Either way no session JSONL
    // is written, so resolveOriginalPath falls through to slugToPath().
    //
    // The project segment ("ghostproject") deliberately contains no hyphens.
    // slugToPath is documented as a LOSSY decoder (see path-engine.ts JSDoc):
    // a folder named "ghost-project" would slug-encode identically to a
    // nested "ghost/project" tree, so the fallback decode would produce
    // "ghost\project" / "ghost/project" rather than the original. Using a
    // hyphen-free segment keeps the assertion that ~/.claude.json's
    // lastSessionCwd (a verbatim source-OS string) matches the fallback's
    // decoded path so the remap rewrites the field. Lossy-segment behavior is
    // covered separately in path-engine unit tests.
    const fakePath =
      process.platform === 'win32'
        ? 'C:\\Users\\test\\ghostproject'
        : '/home/test/ghostproject';
    const slug = pathToSlug(fakePath);
    // Project dir EXISTS but has no sessions/ subdir → slugDecode fallback.
    await mkdir(join(tmpRoot, '.claude', 'projects', slug), { recursive: true });
    await writeFile(
      join(tmpRoot, '.claude.json'),
      JSON.stringify({ lastSessionCwd: fakePath }),
      'utf8',
    );

    const sourceBase =
      process.platform === 'win32' ? 'C:\\Users\\test' : '/home/test';
    const targetBase =
      process.platform === 'win32' ? 'C:\\Users\\test\\newhome' : '/home/test/newhome';
    const expectedTarget = fakePath.replace(sourceBase, targetBase);
    const expectedNewSlug = pathToSlug(expectedTarget);

    const stdio = silenceStdio();
    try {
      await run({ silent: true, remap: [`${sourceBase}=${targetBase}`] });
    } finally {
      stdio.restore();
    }

    const projectsDir = join(tmpRoot, '.claude', 'projects');
    await expect(stat(join(projectsDir, expectedNewSlug))).resolves.toBeDefined();
    await expect(stat(join(projectsDir, slug))).rejects.toMatchObject({ code: 'ENOENT' });

    // AC2 + AC3: ~/.claude.json path field rewritten to the new target. This
    // proves the slug-decode-fallback path (no session JSONL) still drives a
    // correct path remap into ~/.claude.json — not just the dir rename.
    const claudeJson = JSON.parse(
      await readFile(join(tmpRoot, '.claude.json'), 'utf8'),
    ) as { lastSessionCwd: string };
    expect(claudeJson.lastSessionCwd).toBe(expectedTarget);
  });
});

// -----------------------------------------------------------------------------
// AC1(f) + AC7: cross-OS slug-decode via mockPlatform
// -----------------------------------------------------------------------------

describe('AC1(f)+AC7: cross-OS slug decode via mockPlatform', () => {
  let testCtx: TestCtx | undefined;
  let platformMock: PlatformMock | null = null;

  afterEach(async () => {
    platformMock?.restore();
    platformMock = null;
    if (testCtx !== undefined) {
      await teardownTmp(testCtx);
      testCtx = undefined;
    }
  });

  it('Windows-style slug on POSIX runner: mocked win32 decodes correctly, --remap applies', async () => {
    testCtx = await makeBareTmp();
    const { tmpRoot } = testCtx;

    // A Windows-shaped slug whose decoded path will be a Windows absolute path
    // that almost certainly does not exist on the runner's real disk. Path
    // segments deliberately contain no hyphens so slugToPath's documented
    // LOSSY decoder produces the exact same string we wrote into .claude.json
    // (lossy-decode coverage is in the path-engine unit tests, not here).
    const winPath = 'C:\\Users\\alice\\projects\\myapp';
    const slug = pathToSlug(winPath);

    // No sessions/ subdir → resolveOriginalPath falls back to slugToPath.
    await mkdir(join(tmpRoot, '.claude', 'projects', slug), { recursive: true });
    // Seed .claude.json with the source-OS path so AC2/AC3 path-rewrite can be
    // verified end-to-end under the cross-OS slug-decode fallback.
    await writeFile(
      join(tmpRoot, '.claude.json'),
      JSON.stringify({ lastSessionCwd: winPath }),
      'utf8',
    );

    platformMock = mockPlatform('win32');

    // Under mocked win32: slugToPath returns 'C:\\Users\\alice\\projects\\myapp'.
    // stat() of that path on the runner → ENOENT → MISSING. The --remap rule
    // matches on the win32.sep boundary and substitutes prefix + suffix.
    const newWinPath = 'C:\\Users\\alice\\newprojects\\myapp';
    const newSlug = pathToSlug(newWinPath);

    const stdio = silenceStdio();
    try {
      await run({
        silent: true,
        remap: ['C:\\Users\\alice\\projects=C:\\Users\\alice\\newprojects'],
      });
    } finally {
      stdio.restore();
    }

    const projectsDir = join(tmpRoot, '.claude', 'projects');
    await expect(stat(join(projectsDir, newSlug))).resolves.toBeDefined();
    await expect(stat(join(projectsDir, slug))).rejects.toMatchObject({ code: 'ENOENT' });

    // AC2 + AC3 + AC7: ~/.claude.json path field rewritten to the win32 target
    // path. Proves the cross-OS slug-decode path drives a correct path remap
    // into ~/.claude.json.
    const claudeJson = JSON.parse(
      await readFile(join(tmpRoot, '.claude.json'), 'utf8'),
    ) as { lastSessionCwd: string };
    expect(claudeJson.lastSessionCwd).toBe(newWinPath);
  });
});

// -----------------------------------------------------------------------------
// AC4: dry-run leaves filesystem unchanged
// -----------------------------------------------------------------------------

describe('AC4: --dry-run → filesystem unchanged, no backup created', () => {
  let seeded: SeededCtx | undefined;

  afterEach(async () => {
    if (seeded !== undefined) {
      await teardownSeeded(seeded);
      seeded = undefined;
    }
  });

  it('dry-run with missing project: .claude.json text equal, projects/ readdir equal, no backups dir', async () => {
    seeded = await makeSeededTmp();
    const { ctx } = seeded;

    // Snapshots before the run.
    const claudeJsonPath = join(ctx.tmpRoot, '.claude.json');
    const projectsDirPath = join(ctx.tmpRoot, '.claude', 'projects');
    const claudeJsonBefore = await readFile(claudeJsonPath, 'utf8');
    const projectsDirBefore = (await readdir(projectsDirPath)).sort();

    const stdio = silenceStdio();
    try {
      await run({
        dryRun: true,
        silent: true,
        remap: ['/home/alice/projects=/home/alice/new-projects'],
      });
    } finally {
      stdio.restore();
    }

    const claudeJsonAfter = await readFile(claudeJsonPath, 'utf8');
    const projectsDirAfter = (await readdir(projectsDirPath)).sort();

    expect(claudeJsonAfter).toBe(claudeJsonBefore);
    expect(projectsDirAfter).toEqual(projectsDirBefore);

    // No backup directory created in dry-run.
    await expect(stat(join(ctx.tmpRoot, '.claude', 'backups'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});

// -----------------------------------------------------------------------------
// AC5: skip scenario — collectRemapDecisions injects a skip decision
// -----------------------------------------------------------------------------

describe('AC5: skip / no-op → slug unchanged, .claude.json unchanged, summary records non-remap action', () => {
  let testCtx: TestCtx | undefined;

  afterEach(async () => {
    if (testCtx !== undefined) {
      await teardownTmp(testCtx);
      testCtx = undefined;
    }
  });

  it('one missing project skipped (no --remap rule needed when other project is remapped)', async () => {
    // We exercise the skip path through --silent + --remap by providing a
    // remap that resolves to the SAME path as the original. The production
    // code records that as `action: 'no-op'` rather than 'skip', but the
    // observable contract — slug dir unchanged, .claude.json untouched, no
    // entry in the rename loop — matches AC5's intent. To exercise the
    // literal `action: 'skip'` enum value we additionally call
    // `collectRemapDecisions` directly with an injected decision below.

    testCtx = await makeBareTmp();
    const { tmpRoot } = testCtx;

    // Single missing project; --remap rule that maps source → source (no-op).
    const missingPath = '/home/alice/projects/keep-me';
    const missingSlug = pathToSlug(missingPath);
    const missingSessionsDir = join(
      tmpRoot,
      '.claude',
      'projects',
      missingSlug,
      'sessions',
    );
    await mkdir(missingSessionsDir, { recursive: true });
    await writeFile(
      join(missingSessionsDir, 's.jsonl'),
      JSON.stringify({ cwd: missingPath }) + '\n',
      'utf8',
    );
    const claudeJsonContent = JSON.stringify({ lastSessionCwd: missingPath });
    await writeFile(join(tmpRoot, '.claude.json'), claudeJsonContent, 'utf8');

    const { parsed } = await captureJsonRun(() =>
      run({
        json: true,
        silent: true,
        remap: ['/home/alice/projects=/home/alice/projects'],
      }),
    );

    // Slug dir unchanged.
    await expect(
      stat(join(tmpRoot, '.claude', 'projects', missingSlug)),
    ).resolves.toBeDefined();

    // .claude.json untouched (no remap action means applyDecisions short-circuits
    // and never invokes applyCategory, so the file is byte-identical).
    const claudeJsonAfter = await readFile(join(tmpRoot, '.claude.json'), 'utf8');
    expect(claudeJsonAfter).toBe(claudeJsonContent);

    // Summary remappings array records the no-op decision (the equivalent of
    // a skip in the silent + same-path-remap pathway). targetPath is null per
    // the production contract for action !== 'remap'.
    const summary = parsed.summary as {
      remappings: { action: string; targetPath: string | null; slug: string }[];
      backupPath: string | null;
    };
    expect(summary.remappings).toHaveLength(1);
    expect(summary.remappings[0]?.action).toBe('no-op');
    expect(summary.remappings[0]?.targetPath).toBeNull();

    // No remap → no backup created (applyDecisions returns early when
    // toRename.length === 0).
    expect(summary.backupPath).toBeNull();
  });

  it('applyDecisions short-circuits on injected skip decision: no backup, no rename, no warnings', async () => {
    // AC5's literal `action: 'skip'` enum value is only emitted by the
    // interactive prompt path in production (`run()` silent mode emits 'remap'
    // or throws PATH_REMAP_AMBIGUOUS; same-prefix remap emits 'no-op').
    // Following the story's "OR by calling collectRemapDecisions directly and
    // injecting a skip decision" alternative, we hand-craft a skip decision
    // and feed it into applyDecisions to prove the apply-phase short-circuit
    // contract: no backup created, no rename invoked, no warnings recorded.

    testCtx = await makeBareTmp();
    const { tmpRoot } = testCtx;
    const claudeDir = join(tmpRoot, '.claude');
    await mkdir(claudeDir, { recursive: true });

    const skippedPath = '/home/alice/projects/skipped-app';
    // Compute the slug via pathToSlug rather than hardcoding (per the story's
    // Critical Constraint #4: "pathToSlug is the authoritative slug encoder.
    // Use it to compute expected new slugs in assertions — do not hardcode
    // slug strings.").
    const skippedSlug = pathToSlug(skippedPath);
    const skipDecision = {
      slug: skippedSlug,
      originalPath: skippedPath,
      targetPath: null,
      action: 'skip' as const,
    };

    const stdio = silenceStdio();
    let result: Awaited<ReturnType<typeof applyDecisions>>;
    try {
      // Output stub matching the surface applyDecisions touches (progress/warn).
      const noop = (): void => undefined;
      const fakeOutput = {
        progress: noop,
        warn: noop,
        finish: noop,
        error: noop,
      } as unknown as Parameters<typeof applyDecisions>[3];
      result = await applyDecisions([skipDecision], claudeDir, {}, fakeOutput);
    } finally {
      stdio.restore();
    }

    // Apply-phase contract under skip: short-circuits before backup creation.
    expect(result.backupPath).toBeNull();
    expect(result.warnings).toEqual([]);

    // Filesystem-level proof that no backup was created (positive observation
    // — not just trusting the returned backupPath).
    await expect(stat(join(claudeDir, 'backups'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
