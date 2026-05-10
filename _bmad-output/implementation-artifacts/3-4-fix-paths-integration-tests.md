# Story 3.4: fix-paths Integration Tests

Status: review

## Story

As a cmemmov maintainer,
I want an integration test suite covering `fix-paths`' scan, remap, and apply phases against realistic fixture trees including edge cases (no projects need fixing, slug collisions, cross-OS slug encoding, lossy slug decode),
So that the standalone path-repair workflow (Jordan's journey) is regression-protected end-to-end and the PRD success criterion "10 projects remapped in two minutes" is mechanically verified.

## Acceptance Criteria

**AC1 — Test file exists with full scenario coverage**

**Given** `tests/integration/fix-paths.test.ts`
**When** I list its test cases
**Then** it covers at minimum:
- (a) clean tree with all projects FOUND → early exit, "No projects need fixing."
- (b) tree with missing projects → scripted `--remap` applies, directories renamed, `.claude.json` updated
- (c) mixed tree (some FOUND, some NOT FOUND) → only missing projects are remapped
- (d) slug collision on apply → `INTERNAL` thrown, backup exists, slugs unchanged
- (e) memory-only project (no session JSONL) → slug decoded via `slugToPath`, remap applied
- (f) cross-OS slug-decode scenario → foreign-platform slug decoded correctly via platform mock

**AC2 — Each test uses the fixture helpers and asserts the full output contract**

**Given** each test case
**When** it runs
**Then** the test builds a fixture `~/.claude/` tree via `seedClaudeTree()` (or manual `mkdtemp`/`writeFile`), sets `process.env.CLAUDE_CONFIG_DIR`, calls `run()` with appropriate opts, and asserts:
- `~/.claude/projects/` directory contents post-apply (correct slugs present/absent)
- `~/.claude.json` path field values post-apply
- Exit-code-equivalent (command resolves normally, or rejects with expected CmemmovError code)
- JSON output structure (via `--json` mode, parsed from captured stdout)

**AC3 — Successful rename verification**

**Given** a scenario triggering a successful rename
**When** assertions run
**Then** `~/.claude/projects/<newSlug>/` exists; `~/.claude/projects/<oldSlug>/` does NOT exist; the `.claude.json` `lastSessionCwd`, `currentProject`, and `recentProjects[].path` fields contain the new target path

**AC4 — Dry-run leaves filesystem unchanged**

**Given** `run({ dryRun: true, silent: true, remap: [...] })` with missing projects
**When** it runs
**Then** a directory snapshot taken before the call is byte-for-byte equal to a snapshot taken after; backup is NOT created (no backup dir under `~/.claude/backups/`)

**AC5 — Skip scenario**

**Given** a scripted remap where one decision has `action: 'skip'` (achieved by not providing a `--remap` rule for a project in `--silent` mode — OR by calling `collectRemapDecisions` directly and injecting a skip decision)
**When** the test runs
**Then** the skipped project's slug dir is unchanged; `.claude.json` entries for that project are unchanged; the JSON summary `remappings` array records it with `action: 'skip'`

**AC6 — Slug collision scenario**

**Given** the slug-collision test
**When** apply runs
**Then** the test asserts the thrown `CmemmovError` has `code: 'INTERNAL'` and a `hint` containing the colliding slug; the backup directory EXISTS (backup was created before collision was detected) and contains the pre-apply `.claude.json` snapshot; both slugs are present and unchanged in `~/.claude/projects/`

**AC7 — Cross-OS consistency**

**Given** a foreign-platform slug (e.g. `C--Users--alice--projects--my-app`) in `~/.claude/projects/`, no session JSONL, and `mockPlatform('win32')`
**When** `run()` scans
**Then** `slugToPath('C--Users--alice--projects--my-app', 'win32')` returns `C:\Users\alice\projects\my-app`; that path does not exist on disk; the project is `MISSING`; a `--remap` rule applied via `--silent` correctly remaps and renames the slug dir

## Dev Notes

### Overview

Create `tests/integration/fix-paths.test.ts` — a new file. No production code changes. All six AC scenarios are covered by tests that call `run()` directly (bypassing the shell) with controlled env vars and `seedClaudeTree()` fixtures.

**Important pattern:** Use `--silent --remap "src=tgt"` for all scenarios that need a remap applied. This exercises the scripted path end-to-end without needing to mock clack prompts. The interactive prompt path is already unit-tested in `src/commands/fix-paths.test.ts`.

### Files to Create / Modify

| File | Change |
|------|--------|
| `tests/integration/fix-paths.test.ts` | New — all integration tests |

**Do NOT modify** any production source files. This story is tests-only.

---

### Helper APIs (already exist — do not rewrite)

**`seedClaudeTree(opts: SeedOpts): Promise<TempClaudeDir>`** — from `tests/integration/helpers/temp-claude-dir.ts`

Creates a full fixture `~/.claude/` tree under a real tmpdir. Returns:
```typescript
{
  homeDir: string;          // fake source-OS home (e.g. "/home/alice")
  claudeDir: string;        // fake source-OS .claude path (never on real disk)
  claudeJsonPath: string;   // fake .claude.json path (never on real disk)
  projectRealPath: string;  // fake source-OS project path (e.g. "/home/alice/projects/my-app")
  projectSlug: string;      // slug derived via pathToSlug(projectRealPath)
  tmpRoot: string;          // real on-disk tmpdir root — set CLAUDE_CONFIG_DIR = join(tmpRoot, '.claude')
}
```

Calling with `sourcePlatform: 'linux'` seeds a Linux-style tree (session JSONL has `cwd: "/home/alice/projects/my-app"`). The actual project directory at that path is NOT created, so `stat()` returns ENOENT → `exists: false` → MISSING.

**`mockPlatform(platform: NodeJS.Platform): PlatformMock`** — from `tests/integration/helpers/platform-mock.ts`

Overrides `process.platform` for the duration of a test. Call `mock.restore()` in `afterEach`.

**Cleanup pattern:** Always `await rm(tmpRoot, { recursive: true, force: true })` in `afterEach`.

**CLAUDE_CONFIG_DIR pattern:**
```typescript
const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;
beforeEach(() => {
  process.env.CLAUDE_CONFIG_DIR = join(ctx.tmpRoot, '.claude');
});
afterEach(async () => {
  if (originalConfigDir !== undefined) {
    process.env.CLAUDE_CONFIG_DIR = originalConfigDir;
  } else {
    delete process.env.CLAUDE_CONFIG_DIR;
  }
  await rm(ctx.tmpRoot, { recursive: true, force: true });
});
```

---

### Capturing stdout for JSON assertions

`run()` writes to `process.stdout` directly via `Output`. To capture:
```typescript
const chunks: string[] = [];
const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
  chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
  return true;
});
await run({ json: true, silent: true, remap: [...] });
spy.mockRestore();
const lastLine = chunks.join('').split('\n').filter((l) => l.trim().length > 0).pop() ?? '';
const parsed = JSON.parse(lastLine) as { success: boolean; summary: { ... } };
```

Mirror the same pattern used in `src/commands/fix-paths.test.ts`.

---

### Slug computation helper

```typescript
import { pathToSlug } from '../../../src/core/path-engine.js';
const newSlug = pathToSlug('/home/alice/new-projects/my-app');
// → '-home-alice-new-projects-my-app'
```

Use this to compute the expected new slug dir name without hardcoding it.

---

### Test-by-Test Guidance

#### AC1(a) — Clean tree: all FOUND → early exit

```typescript
describe('AC1(a): all projects FOUND → early exit, no remap', () => {
  it('emits "No projects need fixing." and creates no backup', async () => {
    // seedClaudeTree gives a slug whose projectRealPath doesn't exist.
    // For this test, ALSO create a directory at projectRealPath so stat succeeds.
    const ctx = await seedClaudeTree({ sourcePlatform: 'linux', sourceUser: 'alice', targetUser: 'alice' });
    process.env.CLAUDE_CONFIG_DIR = join(ctx.tmpRoot, '.claude');

    // Make the decoded path exist so project is FOUND
    await mkdir(join(ctx.tmpRoot, 'projects', 'my-app'), { recursive: true });
    // But the session JSONL points to ctx.projectRealPath (/home/alice/projects/my-app)
    // We need stat(ctx.projectRealPath) to succeed.
    // On real OS, we can't create /home/alice/projects/my-app.
    // Alternative: create a project with a slug that decodes to a path that exists.
    // Simplest: create the project slug directory but use resolveOriginalPath to point to tmpRoot.
    // ...
  });
});
```

**Better approach for AC1(a):** Skip `seedClaudeTree` (which always creates a MISSING project). Instead, manually create a minimal fixture where the JSONL `cwd` points to an on-disk path you control:

```typescript
describe('AC1(a): all projects FOUND → early exit', () => {
  let tmpRoot: string;
  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'cmemmov-test-'));
    process.env.CLAUDE_CONFIG_DIR = join(tmpRoot, '.claude');
  });
  afterEach(async () => {
    delete process.env.CLAUDE_CONFIG_DIR;
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('no remap phase when all slugs are FOUND', async () => {
    // Create a real project directory
    const projectPath = join(tmpRoot, 'my-project');
    await mkdir(projectPath, { recursive: true });

    // Create slug pointing to projectPath via session JSONL
    const slug = pathToSlug(projectPath);
    const sessionsDir = join(tmpRoot, '.claude', 'projects', slug, 'sessions');
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(
      join(sessionsDir, 'session.jsonl'),
      JSON.stringify({ type: 'message', cwd: projectPath }) + '\n',
      'utf8',
    );
    await writeFile(join(tmpRoot, '.claude.json'), JSON.stringify({}), 'utf8');

    const stdoutChunks: string[] = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
      stdoutChunks.push(typeof c === 'string' ? c : Buffer.from(c).toString('utf8'));
      return true;
    });

    await run({ json: true });
    spy.mockRestore();

    const lastLine = stdoutChunks.join('').split('\n').filter((l) => l.length > 0).pop() ?? '';
    const parsed = JSON.parse(lastLine) as { success: boolean; summary: { text: string } };
    expect(parsed.success).toBe(true);
    expect(parsed.summary.text).toBe('No projects need fixing.');

    // Verify no backup directory was created
    const backupsDir = join(tmpRoot, '.claude', 'backups');
    await expect(stat(backupsDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
```

#### AC1(b) — Missing projects → scripted remap applies

```typescript
describe('AC1(b): missing projects → scripted --remap applies', () => {
  let ctx: Awaited<ReturnType<typeof seedClaudeTree>>;
  beforeEach(async () => {
    ctx = await seedClaudeTree({ sourcePlatform: 'linux', sourceUser: 'alice', targetUser: 'alice' });
    process.env.CLAUDE_CONFIG_DIR = join(ctx.tmpRoot, '.claude');
  });
  afterEach(async () => {
    delete process.env.CLAUDE_CONFIG_DIR;
    await rm(ctx.tmpRoot, { recursive: true, force: true });
  });

  it('renames slug dir and updates .claude.json', async () => {
    // ctx.projectRealPath = '/home/alice/projects/my-app' (doesn't exist → MISSING)
    // Remap: /home/alice/projects → /home/alice/new-projects
    const oldSlug = ctx.projectSlug;
    const targetPath = ctx.projectRealPath.replace('/home/alice/projects', '/home/alice/new-projects');
    const newSlug = pathToSlug(targetPath);

    const stdoutChunks: string[] = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
      stdoutChunks.push(typeof c === 'string' ? c : Buffer.from(c).toString('utf8'));
      return true;
    });

    await run({
      json: true,
      silent: true,
      remap: ['/home/alice/projects=/home/alice/new-projects'],
    });
    spy.mockRestore();

    // AC3: new slug exists, old slug does not
    const projectsDir = join(ctx.tmpRoot, '.claude', 'projects');
    await expect(stat(join(projectsDir, newSlug))).resolves.toBeDefined();
    await expect(stat(join(projectsDir, oldSlug))).rejects.toMatchObject({ code: 'ENOENT' });

    // AC3: .claude.json has updated paths
    const claudeJson = JSON.parse(
      await readFile(join(ctx.tmpRoot, '.claude.json'), 'utf8'),
    ) as { lastSessionCwd: string; currentProject: string };
    expect(claudeJson.lastSessionCwd).toBe(targetPath);
    expect(claudeJson.currentProject).toBe(targetPath);

    // JSON output
    const lastLine = stdoutChunks.join('').split('\n').filter((l) => l.length > 0).pop() ?? '';
    const parsed = JSON.parse(lastLine) as {
      success: boolean;
      summary: { text: string; remappings: { action: string; targetPath: string }[] };
    };
    expect(parsed.success).toBe(true);
    expect(parsed.summary.remappings[0]?.action).toBe('remap');
    expect(parsed.summary.remappings[0]?.targetPath).toBe(targetPath);

    // Backup was created
    const backupsDir = join(ctx.tmpRoot, '.claude', 'backups');
    await expect(stat(backupsDir)).resolves.toBeDefined();
  });
});
```

#### AC1(c) — Mixed tree (some FOUND, some NOT FOUND)

Create two projects: one with a real path on disk (FOUND), one without (MISSING). Assert only the missing one is remapped.

```typescript
describe('AC1(c): mixed tree — only missing projects are remapped', () => {
  it('found project unchanged; missing project renamed', async () => {
    const tmpRoot = await mkdtemp(join(tmpdir(), 'cmemmov-test-'));
    process.env.CLAUDE_CONFIG_DIR = join(tmpRoot, '.claude');

    // FOUND project: real path exists on disk
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

    // MISSING project: session points to non-existent path
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

    await run({
      silent: true,
      remap: ['/home/alice/projects=/home/alice/new-projects'],
    });

    const projectsDir = join(tmpRoot, '.claude', 'projects');
    // FOUND slug unchanged
    await expect(stat(join(projectsDir, foundSlug))).resolves.toBeDefined();
    // MISSING slug renamed
    const newMissingSlug = pathToSlug('/home/alice/new-projects/gone-app');
    await expect(stat(join(projectsDir, missingSlug))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(join(projectsDir, newMissingSlug))).resolves.toBeDefined();

    delete process.env.CLAUDE_CONFIG_DIR;
    await rm(tmpRoot, { recursive: true, force: true });
  });
});
```

#### AC1(d) + AC6 — Slug collision

```typescript
describe('AC1(d)+AC6: slug collision → INTERNAL thrown, backup exists, slugs unchanged', () => {
  it('pre-existing target slug causes INTERNAL; backup was created; old slug intact', async () => {
    const ctx = await seedClaudeTree({ sourcePlatform: 'linux', sourceUser: 'alice', targetUser: 'alice' });
    process.env.CLAUDE_CONFIG_DIR = join(ctx.tmpRoot, '.claude');

    // Create the TARGET slug dir so it already exists (collision)
    const targetPath = ctx.projectRealPath.replace('/home/alice/projects', '/home/alice/new');
    const newSlug = pathToSlug(targetPath);
    await mkdir(join(ctx.tmpRoot, '.claude', 'projects', newSlug), { recursive: true });

    await expect(
      run({
        silent: true,
        remap: ['/home/alice/projects=/home/alice/new'],
      }),
    ).rejects.toMatchObject({ code: 'INTERNAL' });

    // Old slug still exists
    await expect(
      stat(join(ctx.tmpRoot, '.claude', 'projects', ctx.projectSlug)),
    ).resolves.toBeDefined();

    // Backup was created (before collision detection per AC3)
    const backupsDir = join(ctx.tmpRoot, '.claude', 'backups');
    await expect(stat(backupsDir)).resolves.toBeDefined();
    // Backup contains pre-apply .claude.json
    const backupEntries = await readdir(join(backupsDir, 'cmemmov'));
    expect(backupEntries.length).toBeGreaterThan(0);

    delete process.env.CLAUDE_CONFIG_DIR;
    await rm(ctx.tmpRoot, { recursive: true, force: true });
  });
});
```

#### AC1(e) — Memory-only project (no session JSONL, slug decode)

```typescript
describe('AC1(e): memory-only project — slug decode fallback (current platform)', () => {
  it('project with no sessions dir: decodes via slugToPath, remaps correctly', async () => {
    const tmpRoot = await mkdtemp(join(tmpdir(), 'cmemmov-test-'));
    process.env.CLAUDE_CONFIG_DIR = join(tmpRoot, '.claude');

    // Create a slug that is decodable on the CURRENT platform (no JSONL)
    // On POSIX: slug starts with '-', decodes to an absolute path that doesn't exist
    const fakePath =
      process.platform === 'win32'
        ? 'C:\\Users\\test\\ghost-project'
        : '/home/test/ghost-project';
    const slug = pathToSlug(fakePath);
    // Create project dir WITHOUT sessions/ subdir
    await mkdir(join(tmpRoot, '.claude', 'projects', slug), { recursive: true });
    await writeFile(
      join(tmpRoot, '.claude.json'),
      JSON.stringify({ lastSessionCwd: fakePath }),
      'utf8',
    );

    const targetBase = process.platform === 'win32' ? 'C:\\Users\\test\\new-home' : '/home/test/new-home';
    const sourceBase = process.platform === 'win32' ? 'C:\\Users\\test' : '/home/test';
    const remapSpec = `${sourceBase}=${targetBase}`;
    const expectedTarget = fakePath.replace(sourceBase, targetBase);
    const expectedNewSlug = pathToSlug(expectedTarget);

    await run({ silent: true, remap: [remapSpec] });

    const projectsDir = join(tmpRoot, '.claude', 'projects');
    await expect(stat(join(projectsDir, expectedNewSlug))).resolves.toBeDefined();
    await expect(stat(join(projectsDir, slug))).rejects.toMatchObject({ code: 'ENOENT' });

    delete process.env.CLAUDE_CONFIG_DIR;
    await rm(tmpRoot, { recursive: true, force: true });
  });
});
```

#### AC1(f) + AC7 — Cross-OS slug decode via platform mock

```typescript
describe('AC1(f)+AC7: cross-OS slug decode via mockPlatform', () => {
  let platformMock: ReturnType<typeof mockPlatform> | null = null;

  afterEach(() => {
    platformMock?.restore();
    platformMock = null;
  });

  it('Windows slug decoded correctly when platform mocked to win32 (no session JSONL)', async () => {
    // Create a slug that looks like a Windows path on POSIX
    const winPath = 'C:\\Users\\alice\\projects\\my-app';
    const slug = pathToSlug(winPath); // → 'C--Users--alice--projects--my-app'

    const tmpRoot = await mkdtemp(join(tmpdir(), 'cmemmov-test-'));
    process.env.CLAUDE_CONFIG_DIR = join(tmpRoot, '.claude');

    // Create the project dir WITHOUT session JSONL (so resolveOriginalPath uses slugToPath)
    await mkdir(join(tmpRoot, '.claude', 'projects', slug), { recursive: true });
    await writeFile(join(tmpRoot, '.claude.json'), JSON.stringify({}), 'utf8');

    platformMock = mockPlatform('win32');

    // With win32 platform: slugToPath('C--Users--alice--projects--my-app', 'win32')
    // returns 'C:\Users\alice\projects\my-app'
    // stat('C:\Users\alice\projects\my-app') → ENOENT → MISSING
    // --remap applies correctly
    const newWinPath = 'C:\\Users\\alice\\new-projects\\my-app';
    const newSlug = pathToSlug(newWinPath);

    await run({
      silent: true,
      remap: ['C:\\Users\\alice\\projects=C:\\Users\\alice\\new-projects'],
    });

    const projectsDir = join(tmpRoot, '.claude', 'projects');
    await expect(stat(join(projectsDir, newSlug))).resolves.toBeDefined();
    await expect(stat(join(projectsDir, slug))).rejects.toMatchObject({ code: 'ENOENT' });

    delete process.env.CLAUDE_CONFIG_DIR;
    await rm(tmpRoot, { recursive: true, force: true });
  });
});
```

#### AC4 — Dry-run leaves filesystem unchanged

```typescript
describe('AC4: dry-run → filesystem unchanged', () => {
  it('no slug rename, no backup, same .claude.json after dry-run', async () => {
    const ctx = await seedClaudeTree({ sourcePlatform: 'linux', sourceUser: 'alice', targetUser: 'alice' });
    process.env.CLAUDE_CONFIG_DIR = join(ctx.tmpRoot, '.claude');

    // Snapshot before
    const claudeJsonBefore = await readFile(join(ctx.tmpRoot, '.claude.json'), 'utf8');
    const projectsDirBefore = await readdir(join(ctx.tmpRoot, '.claude', 'projects'));

    await run({
      dryRun: true,
      silent: true,
      remap: ['/home/alice/projects=/home/alice/new-projects'],
    });

    // Snapshot after
    const claudeJsonAfter = await readFile(join(ctx.tmpRoot, '.claude.json'), 'utf8');
    const projectsDirAfter = await readdir(join(ctx.tmpRoot, '.claude', 'projects'));

    expect(claudeJsonAfter).toBe(claudeJsonBefore);
    expect(projectsDirAfter).toEqual(projectsDirBefore);

    // No backup created
    await expect(
      stat(join(ctx.tmpRoot, '.claude', 'backups')),
    ).rejects.toMatchObject({ code: 'ENOENT' });

    delete process.env.CLAUDE_CONFIG_DIR;
    await rm(ctx.tmpRoot, { recursive: true, force: true });
  });
});
```

---

### Imports for the test file

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, stat, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToSlug } from '../../../src/core/path-engine.js';
import { run } from '../../../src/commands/fix-paths.js';
import { seedClaudeTree } from './helpers/temp-claude-dir.js';
import { mockPlatform } from './helpers/platform-mock.js';
```

**No vi.mock() calls** — these are integration tests that exercise real production code. Do not mock `backup-service`, `write-gate`, `claude-writer`, or `prompts` here.

---

### Critical Constraints

1. **No mocks in integration tests.** These tests touch real tmpdir filesystems. The only exception is `vi.spyOn(process.stdout, 'write')` for JSON output capture, and `mockPlatform()` for cross-OS slug decode tests.

2. **`process.env.CLAUDE_CONFIG_DIR` must be cleaned up** in every `afterEach`. Leaking it causes subsequent tests to point at a tmpdir that was already deleted.

3. **`seedClaudeTree` always creates a MISSING project.** The seeded session JSONL has `cwd = fakeSrcPath` (e.g. `/home/alice/projects/my-app`) which never exists on the real disk. You don't need to do anything extra to make the project missing.

4. **`pathToSlug` is the authoritative slug encoder.** Use it to compute expected new slugs in assertions — do not hardcode slug strings.

5. **`--silent --remap` requires the remap spec to match** the project's `decodedPath`. For `seedClaudeTree` with `sourcePlatform: 'linux'`, the `decodedPath` is `/home/alice/projects/my-app`. The `--remap` spec must use this exact prefix.

6. **Backup path is non-deterministic.** Don't assert the exact path — just assert the backup directory exists under `~/.claude/backups/cmemmov/`.

7. **No `snapshotTree` helper yet.** For AC4 (dry-run unchanged), compare `.claude.json` text equality and `readdir` output. This is sufficient.

8. **Integration tests may be slow.** Expect 3-8 seconds total. Do not add artificial timeouts — let vitest's default handle it.

---

### Running the Tests

```bash
# Run only integration tests
npx vitest run tests/integration/fix-paths.test.ts

# Or via the standard test command
npm test -- fix-paths

# Full suite regression check
npm test
```

---

### Story 3.0 (deferred — 3-0 in review) Note

Story 3.0 is still in `review` status. Its implementation is not a blocker for Story 3.4. Story 3.4 integration tests do not depend on any 3.0 changes.

## Tasks / Subtasks

- [x] AC1(a) — clean tree → all projects FOUND → early exit, "No projects need fixing." (no backup)
- [x] AC1(b)+AC2+AC3 — missing project + scripted `--remap` → slug renamed, `.claude.json` path fields rewritten, JSON summary records remap action
- [x] AC1(c) — mixed FOUND/MISSING tree → only the MISSING slug is renamed; FOUND slug is untouched
- [x] AC1(d)+AC6 — slug collision on apply → `CmemmovError(INTERNAL)`; backup directory exists with `.claude.json` snapshot; both slugs unchanged
- [x] AC1(e) — memory-only project (no session JSONL) → `slugToPath` fallback path proves the remap still applies
- [x] AC1(f)+AC7 — Windows-shaped slug under `mockPlatform('win32')` → cross-OS decode succeeds and `--remap` applies
- [x] AC4 — `--dry-run` with missing projects → `.claude.json` text identical, `projects/` `readdir` identical, no `backups/` directory
- [x] AC5 — silent same-prefix `--remap` → no-op recorded in JSON summary; slug + `.claude.json` byte-identical; direct `applyDecisions([skip])` call short-circuits with no backup, no rename, no warnings (covers the explicit `action: 'skip'` enum value per AC5's "OR by calling collectRemapDecisions directly and injecting a skip decision")

## Dev Agent Record

### Implementation Plan

- New file `tests/integration/fix-paths.test.ts` — eight `describe` blocks, one per AC scenario.
- Two fixture-builder helpers:
  - `makeBareTmp()` — creates a fresh `mkdtemp` and points `CLAUDE_CONFIG_DIR` at `<tmp>/.claude`. Used by tests that need explicit slug + JSONL control (AC1(a), AC1(c), AC1(e), AC1(f), AC5).
  - `makeSeededTmp()` — wraps `seedClaudeTree({ sourcePlatform: 'linux', ... })` so the seed's standard MISSING-project layout drives AC1(b), AC1(d)+AC6, and AC4.
- One stdout helper `captureJsonRun()` mirroring the spy pattern in `src/commands/fix-paths.test.ts` to parse the `Output.finish` JSON line.
- One stdio silencer `silenceStdio()` for cases that exercise the non-JSON path so progress lines don't pollute the test reporter.

### Completion Notes

- All eight ACs pass. Total runtime for the new file: ~320 ms (well under the 3–8 s estimate in the story).
- One bug-in-spec fixed during implementation: the story's AC1(d)+AC6 example pre-creates the target slug dir but does nothing else. On a real run that pre-existing slug also enters the inventory, gets resolved as MISSING (no `sessions/` → falls back to `slugToPath` → returns a non-on-disk path), and the silent-mode pass demands a `--remap` rule for it — throwing `PATH_REMAP_AMBIGUOUS` instead of the `INTERNAL` collision the test expects. Fix: in the integration test, anchor the pre-existing target slug to a real on-disk path via a `sessions/` JSONL whose `cwd` points at `<tmpRoot>/collision-anchor`. Now the colliding slug is FOUND, stays out of the missing list, and the original missing project's `targetPath` correctly trips the on-disk-collision branch in `applyDecisions`.
- AC5 explicit-skip coverage: `run()` only emits `action: 'skip'` through the interactive prompt path, which integration tests don't drive. Following the story's "OR by calling `collectRemapDecisions` directly and injecting a skip decision" guidance, the second AC5 test calls `applyDecisions` directly with a hand-crafted `{ action: 'skip', targetPath: null }` decision and asserts the short-circuit contract (no backup, no rename, no warnings).
- No production source files were modified — this story is tests-only as the story body specified.

### File List

- `tests/integration/fix-paths.test.ts` (new)

### Debug Log

- First run of the AC1(d)+AC6 test failed mentally during planning with `PATH_REMAP_AMBIGUOUS` instead of `INTERNAL` — see Completion Notes for the fix that landed in the integration test before the first vitest run.
- All 469 tests across 30 files pass (`npm run check`); lint, typecheck, and full vitest pass clean.

## Change Log

| Date       | Change                                                                                      | Author  |
|------------|---------------------------------------------------------------------------------------------|---------|
| 2026-05-09 | Created `tests/integration/fix-paths.test.ts` covering AC1(a)–(f), AC2–AC7. Story → review. | dev-3-4 |
