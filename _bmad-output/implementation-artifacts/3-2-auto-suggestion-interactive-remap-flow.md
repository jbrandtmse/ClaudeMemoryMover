# Story 3.2: Auto-Suggestion & Interactive Remap Flow

Status: in-progress

## Story

As a Claude Code user (Jordan),
I want `cmemmov fix-paths` to auto-suggest a new path for each missing project by searching for a directory with the same name under my home tree, and let me confirm, override, or skip per project (or supply a `--remap` flag for scripted runs),
So that I can fix ten broken projects in two minutes — accepting auto-suggestions for the obvious ones and overriding only the edge cases.

## Acceptance Criteria

**AC1 — `findMatchingDir` auto-suggestion**

**Given** scan results with N missing projects
**When** the remap phase runs
**Then** for each missing project, `path-engine.findMatchingDir(originalPath, candidatePaths)` is called where `candidatePaths` is the subset of `[join(homedir(), projectBasename), join(homedir(), 'dev', projectBasename), join(homedir(), 'work', projectBasename), join(homedir(), 'projects', projectBasename), join(homedir(), 'src', projectBasename)]` that exist on disk (FR22)

**AC2 — Interactive prompt with auto-suggestion**

**Given** a missing project with an auto-suggestion available
**When** presented to the user
**Then** the prompt shows the original path and suggestion, offering [Y]es accept / [O]verride with custom path / [S]kip; default is accept (Enter accepts)

**AC3 — Interactive prompt without auto-suggestion**

**Given** a missing project with no auto-suggestion (`findMatchingDir` returned null)
**When** presented
**Then** the prompt shows `<originalPath> → (no match found)` and asks the user to type a target path or [S]kip

**AC4 — Scripted mode with `--remap`**

**Given** `cmemmov fix-paths --silent --remap "/home/jordan/dev=/home/jordan/work"`
**When** the command runs
**Then** every missing project whose `decodedPath` starts with `/home/jordan/dev` is remapped via prefix substitution (longest-prefix match if multiple `--remap` specs)
**And** any missing project not covered by a `--remap` rule causes exit 2 with `CmemmovError({ code: 'PATH_REMAP_AMBIGUOUS', hint: '--remap rule needed for <originalPath>' })`

**AC5 — Silent without `--remap` → exit 2**

**Given** `cmemmov fix-paths --silent` without any `--remap` flag and missing projects exist
**When** the command runs
**Then** it exits 2 with `PATH_REMAP_AMBIGUOUS` listing the first unhandled project's `decodedPath` in the hint

**AC6 — No-op detection**

**Given** an auto-suggestion or `--remap` result that resolves to the same path as `decodedPath` (no-op)
**When** processed
**Then** the project is recorded with `action: 'no-op'` in the decisions list; no rename is proposed

**AC7 — `--dry-run` collects decisions without applying**

**Given** `--dry-run` set during the remap phase
**When** decisions are collected
**Then** `collectRemapDecisions` completes normally and returns the decisions array
**And** `run()` emits a dry-run notice and returns without applying any writes (apply phase is Story 3.3)

**AC8 — `--json` mode includes `remappings`**

**Given** `--json` mode with missing projects reaching the remap phase
**When** `out.finish` is called
**Then** the JSON output's `summary` field includes `remappings: RemapDecision[]` with `{ slug, originalPath, targetPath, action }` entries

**AC9 — Unit tests**

**Given** `src/commands/fix-paths.test.ts` (extended)
**When** the test suite runs
**Then** it covers at minimum:
- (a) missing project with a matching candidate on disk → auto-suggestion accepted → `action: 'remap'`
- (b) missing project with no candidate on disk → no-op path: prompt called with `suggestion: null`
- (c) scripted `--remap` match → `action: 'remap'`, correct prefix substitution
- (d) scripted `--remap` no match, `--silent` → `PATH_REMAP_AMBIGUOUS` thrown
- (e) `--silent` without `--remap`, missing projects → `PATH_REMAP_AMBIGUOUS` thrown
- (f) no-op: suggestion equals `originalPath` → `action: 'no-op'`
- (g) skip action from prompt → `action: 'skip'`, `targetPath: null`
- (h) `--json` with remap decisions → `summary.remappings` present in stdout JSON
- (i) existing AC4+AC9(d) test (one NOT FOUND project, `run({})`) MUST be updated: after Story 3.2, `run({})` calls `collectRemapDecisions` which triggers interactive prompts — the test must mock `promptRemapDecision` to prevent hanging; update the describe comment and add the mock

## Dev Notes

### Overview

Story 3.2 extends `fix-paths.ts` with a remap phase that runs after the scan phase (Story 3.1). The remap phase collects a `RemapDecision` per missing project, then returns. The apply phase (Story 3.3) will consume those decisions. In this story, after collecting decisions `run()` emits a summary and returns — no writes happen.

### Files to Modify

| File | Change |
|------|--------|
| `src/commands/fix-paths.ts` | Add `RemapDecision` type, extend `FixPathsOpts`, export `collectRemapDecisions`, update `run()` |
| `src/ui/prompts.ts` | Add `promptRemapDecision` function |
| `src/cli.ts` | Add `--remap` flag to `fixPathsCmd`, add `remap?: string[]` to `FixPathsCLIOpts` |
| `src/commands/fix-paths.test.ts` | Add new describe blocks; update existing AC4+AC9(d) test |

**Do NOT touch** `src/core/path-engine.ts` or `src/core/error.ts` — both already have everything needed.

---

### `src/commands/fix-paths.ts` Changes

#### 1. Extend `FixPathsOpts`

```typescript
export interface FixPathsOpts {
  silent?: boolean;
  json?: boolean;
  dryRun?: boolean;
  remap?: string[];   // ADD THIS
}
```

#### 2. Add `RemapDecision` type

```typescript
export interface RemapDecision {
  slug: string;
  originalPath: string;
  targetPath: string | null;  // null when action is 'skip'
  action: 'remap' | 'skip' | 'no-op';
}
```

Export this — it is used by Story 3.3 and tests.

#### 3. Add new imports

```typescript
import { stat } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { findMatchingDir } from '../core/path-engine.js';
import { CmemmovError } from '../core/error.js';
import { promptRemapDecision } from '../ui/prompts.js';
```

`stat` is already imported by the scan phase. Check before adding duplicate imports.

#### 4. Implement `collectRemapDecisions`

Export this function so tests can call it directly.

```typescript
export async function collectRemapDecisions(
  missing: ProjectInventoryEntry[],
  opts: FixPathsOpts,
): Promise<RemapDecision[]> {
  const silent = opts.silent === true;

  // Parse --remap specs once up front
  const remapSpecs = (opts.remap ?? []).map((spec) => {
    const eqIdx = spec.indexOf('=');
    if (eqIdx < 1) {
      throw new CmemmovError({
        code: 'INTERNAL',
        hint: `Invalid --remap format: "${spec}". Use "source-prefix=target-prefix"`,
      });
    }
    return { lhs: spec.slice(0, eqIdx), rhs: spec.slice(eqIdx + 1) };
  });

  const decisions: RemapDecision[] = [];

  for (const entry of missing) {
    const { slug, decodedPath } = entry;

    // Build candidates by joining common parent dirs with the project basename
    const projectName = basename(decodedPath);
    const home = homedir();
    const parentRoots = [
      home,
      join(home, 'dev'),
      join(home, 'work'),
      join(home, 'projects'),
      join(home, 'src'),
    ];
    const candidatePaths: string[] = [];
    for (const root of parentRoots) {
      const candidate = join(root, projectName);
      try {
        await stat(candidate);
        candidatePaths.push(candidate);
      } catch {
        // ENOENT → not a candidate
      }
    }
    const suggestion = findMatchingDir(decodedPath, candidatePaths);

    if (silent) {
      // Scripted mode: apply --remap prefix substitution
      // Use longest-prefix match (same logic as remapByDecisions in path-engine)
      let match: { lhs: string; rhs: string } | null = null;
      for (const spec of remapSpecs) {
        if (
          decodedPath === spec.lhs ||
          decodedPath.startsWith(spec.lhs + '/') ||
          decodedPath.startsWith(spec.lhs + '\\')
        ) {
          if (match === null || spec.lhs.length > match.lhs.length) {
            match = spec;
          }
        }
      }
      if (match === null) {
        throw new CmemmovError({
          code: 'PATH_REMAP_AMBIGUOUS',
          hint: `--remap rule needed for ${decodedPath}`,
        });
      }
      const suffix = decodedPath.slice(match.lhs.length);
      const targetPath = match.rhs + suffix;
      const action = targetPath === decodedPath ? 'no-op' : 'remap';
      decisions.push({ slug, originalPath: decodedPath, targetPath: action === 'no-op' ? null : targetPath, action });
    } else {
      // Interactive mode
      const result = await promptRemapDecision({
        slug,
        originalPath: decodedPath,
        suggestion,
      });
      if (result.action === 'skip') {
        decisions.push({ slug, originalPath: decodedPath, targetPath: null, action: 'skip' });
      } else {
        const targetPath = result.path;
        const action = targetPath === decodedPath ? 'no-op' : 'remap';
        decisions.push({
          slug,
          originalPath: decodedPath,
          targetPath: action === 'no-op' ? null : targetPath,
          action,
        });
      }
    }
  }

  return decisions;
}
```

**Critical design note on no-op:** when `targetPath === decodedPath`, set `action: 'no-op'` and `targetPath: null`. The AC says no-op is "recorded in summary.skipped" — for the JSON output `targetPath: null` with `action: 'no-op'` is the canonical representation.

**Critical design note on separator matching:** When checking `decodedPath.startsWith(spec.lhs + '/')` or `+ '\\'`, do NOT hardcode `'/'` or `'\\'` as string literals — the `no-hardcoded-separator` ESLint rule will flag them. Use `posix.sep` and `win32.sep` from `node:path`:

```typescript
import { posix, win32, join, basename } from 'node:path';
// ...
  decodedPath.startsWith(spec.lhs + posix.sep) ||
  decodedPath.startsWith(spec.lhs + win32.sep)
```

#### 5. Update `run()` — remove the intermediate `out.finish` call and add the remap phase

The current `run()` calls `out.finish` at the `missing.length > 0` branch (the summary "N project(s) need path repair."). After Story 3.2, `run()` must NOT call `out.finish` there — instead it continues to collect decisions and emits `out.finish` with richer data at the end.

Replace the tail of `run()` (everything after `const missing = ...`) with:

```typescript
  if (entries.length === 0 || missing.length === 0) {
    if (opts.json === true) {
      out.finish('No projects need fixing.', true, { projects: entries });
    } else {
      out.finish('No projects need fixing.');
    }
    return;
  }

  // Remap phase
  const decisions = await collectRemapDecisions(missing, opts);

  for (const d of decisions) {
    if (d.action === 'remap') {
      out.progress(`Remap: ${d.originalPath} → ${d.targetPath ?? ''}`);
    } else if (d.action === 'no-op') {
      out.progress(`No-op: ${d.originalPath} (path unchanged)`);
    } else {
      out.progress(`Skipped: ${d.originalPath}`);
    }
  }

  if (opts.dryRun === true) {
    out.progress('[dry-run] No changes applied.');
  }

  const remapCount = decisions.filter((d) => d.action === 'remap').length;
  const summary = `${String(remapCount)} project(s) will be renamed.`;
  if (opts.json === true) {
    out.finish(summary, true, { projects: entries, remappings: decisions });
  } else {
    out.finish(summary);
  }
  // Story 3.3 will add the apply phase here (rename dirs + update .claude.json)
```

**Note:** The summary message changes from "need path repair" to "will be renamed" because decisions have been collected — more accurate post-remap-phase.

---

### `src/ui/prompts.ts` Changes

Add a new exported function `promptRemapDecision`. This is the fix-paths-specific variant of `confirmProjectPath` — same structure, different wording.

```typescript
export interface RemapDecisionResult {
  action: 'accept' | 'override' | 'skip';
  path: string;
}

export async function promptRemapDecision(opts: {
  slug: string;
  originalPath: string;
  suggestion: string | null;
}): Promise<RemapDecisionResult> {
  type Action = 'accept' | 'override' | 'skip';
  const options: { value: Action; label: string; hint?: string }[] = [];

  if (opts.suggestion !== null) {
    options.push({
      value: 'accept',
      label: `Use ${opts.suggestion}`,
      hint: 'auto-detected match',
    });
  }
  options.push({ value: 'override', label: 'Enter custom path', hint: 'type a new path' });
  options.push({ value: 'skip', label: 'Skip', hint: 'leave as-is, do not rename' });

  const message =
    opts.suggestion !== null
      ? `Project "${opts.slug}" not found at ${opts.originalPath}. Suggested → ${opts.suggestion}:`
      : `Project "${opts.slug}" not found at ${opts.originalPath} (no match found):`;

  const action = await select<Action>({ message, options });
  bailOnCancel<Action>(action);

  if (action === 'skip') return { action: 'skip', path: opts.originalPath };
  if (action === 'accept' && opts.suggestion !== null) {
    return { action: 'accept', path: opts.suggestion };
  }

  const customPath = await text({
    message: `Enter new path for project ${opts.slug}:`,
    placeholder: opts.suggestion ?? opts.originalPath,
    validate: (v) => (v === undefined || v.trim().length === 0 ? 'Path cannot be empty' : undefined),
  });
  bailOnCancel<string>(customPath);
  return { action: 'override', path: customPath.trim() };
}
```

Note: `bailOnCancel` and `select`/`text` are already imported in `prompts.ts`. Just add the new function — do not add new imports.

`RemapDecisionResult` has the same shape as the existing `ProjectPathResult` — you may alias it or define it separately. Defining separately (`RemapDecisionResult`) keeps them independent for future divergence.

---

### `src/cli.ts` Changes

#### 1. Add `remap?: string[]` to `FixPathsCLIOpts`

The `FixPathsCLIOpts` interface at the top of `cli.ts` currently just re-exports the type from `fix-paths.ts` via `import type`. Since `FixPathsOpts` (from fix-paths.ts) now has `remap?: string[]`, the CLI opts interface will pick it up automatically IF the import is `import type { FixPathsOpts as FixPathsCLIOpts }`.

Check `cli.ts` line 6:
```typescript
import type { FixPathsOpts as FixPathsCLIOpts } from './commands/fix-paths.js';
```

Since `FixPathsCLIOpts` is just an alias for `FixPathsOpts`, and `FixPathsOpts` will have `remap?: string[]`, the type is already correct. No interface change needed in `cli.ts`.

#### 2. Add `--remap` to `fixPathsCmd`

The `parseRemap` function already exists in `cli.ts` (used by `importCmd`). Reuse it directly.

Find `fixPathsCmd` (currently around line 105-110):

```typescript
  const fixPathsCmd = program
    .command('fix-paths')
    .description('Re-associate project slugs with new repository locations');
```

Add the `--remap` option:

```typescript
  const fixPathsCmd = program
    .command('fix-paths')
    .description('Re-associate project slugs with new repository locations')
    .option(
      '--remap <spec>',
      'remap prefix: "source-prefix=target-prefix" (repeatable)',
      parseRemap,
      [] as string[],
    );
```

No other changes needed in `cli.ts` — `fixPathsCmd.optsWithGlobals<FixPathsCLIOpts>()` already passes opts to `run(opts)`.

---

### `src/commands/fix-paths.test.ts` Changes

#### Critical: Update existing `AC4+AC9(d)` test

After Story 3.2's changes, calling `run({})` with missing projects will invoke `promptRemapDecision` interactively. This will hang in tests unless mocked. You MUST add a top-level mock for `prompts.ts` before the import of `run`.

Add near the top of the file (after the existing `vi.mock` calls but before `import { run, ... }`):

```typescript
const mockPromptRemapDecision = vi.hoisted(() => vi.fn<Parameters<typeof promptRemapDecision>, ReturnType<typeof promptRemapDecision>>());

vi.mock('../ui/prompts.js', () => ({
  promptRemapDecision: mockPromptRemapDecision,
}));
```

Then add to `resetState()`:
```typescript
  mockPromptRemapDecision.mockReset();
```

In the existing `AC4+AC9(d)` describe, set the mock to return `skip` (reasonable default, keeps test intent):
```typescript
  beforeEach(() => {
    mockPromptRemapDecision.mockResolvedValue({ action: 'skip', path: '/home/jordan/moved-app' });
  });
```

Update the describe comment from "Story 3.1 stops here; remap phase deferred" to reflect Story 3.2 behavior (prompt is called, returns skip, command exits 0).

Similarly update `AC9(g)` mixed-tree test to set the mock.

#### Also mock `node:os` for `homedir()`

Add a top-level mock so `homedir()` returns the test POSIX home dir:

```typescript
vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return { ...actual, homedir: vi.fn(() => '/home/jordan') };
});
```

#### New describe blocks for Story 3.2

Add the following new describe groups (in `fix-paths.test.ts`, after the existing blocks):

**AC1(a) — auto-suggestion accepted:**
```typescript
describe('AC1(a): missing project with candidate on disk → auto-suggestion, accepted', () => {
  it('collectRemapDecisions returns remap decision with targetPath', async () => {
    const slug = '-home-jordan-moved-app';
    const decoded = '/home/jordan/moved-app';
    // Candidate: /home/jordan/dev/moved-app exists
    state.statPaths.set('/home/jordan/dev/moved-app', existingFileStat());
    mockPromptRemapDecision.mockResolvedValue({ action: 'accept', path: '/home/jordan/dev/moved-app' });

    const missing: ProjectInventoryEntry[] = [{ slug, decodedPath: decoded, exists: false, source: 'sessionCwd' }];
    const decisions = await collectRemapDecisions(missing, {});

    expect(mockPromptRemapDecision).toHaveBeenCalledWith(
      expect.objectContaining({ slug, originalPath: decoded, suggestion: '/home/jordan/dev/moved-app' })
    );
    expect(decisions).toEqual([{
      slug,
      originalPath: decoded,
      targetPath: '/home/jordan/dev/moved-app',
      action: 'remap',
    }]);
  });
});
```

**AC1(b) — no candidate on disk → prompt with null suggestion:**
```typescript
describe('AC1(b): no candidate on disk → prompt called with suggestion: null', () => {
  it('suggestion is null when no candidate path exists', async () => {
    const slug = '-home-jordan-ghost-app';
    const decoded = '/home/jordan/ghost-app';
    // No stat entries → all candidates ENOENT
    mockPromptRemapDecision.mockResolvedValue({ action: 'skip', path: decoded });

    const missing: ProjectInventoryEntry[] = [{ slug, decodedPath: decoded, exists: false, source: 'sessionCwd' }];
    await collectRemapDecisions(missing, {});

    expect(mockPromptRemapDecision).toHaveBeenCalledWith(
      expect.objectContaining({ suggestion: null })
    );
  });
});
```

**AC4(c) — scripted --remap match:**
```typescript
describe('AC4(c): scripted --remap prefix substitution', () => {
  it('prefix match → remap action with substituted targetPath', async () => {
    const slug = '-home-jordan-old-dev-myapp';
    const decoded = '/home/jordan/old-dev/myapp';
    const missing: ProjectInventoryEntry[] = [{ slug, decodedPath: decoded, exists: false, source: 'sessionCwd' }];

    const decisions = await collectRemapDecisions(missing, {
      silent: true,
      remap: ['/home/jordan/old-dev=/home/jordan/new-dev'],
    });

    expect(decisions).toEqual([{
      slug,
      originalPath: decoded,
      targetPath: '/home/jordan/new-dev/myapp',
      action: 'remap',
    }]);
    expect(mockPromptRemapDecision).not.toHaveBeenCalled();
  });
});
```

**AC4(d) — scripted --remap no match → PATH_REMAP_AMBIGUOUS:**
```typescript
describe('AC4(d)+AC5: --silent + no matching --remap → PATH_REMAP_AMBIGUOUS', () => {
  it('throws PATH_REMAP_AMBIGUOUS when no spec matches', async () => {
    const decoded = '/home/jordan/unknown-app';
    const missing: ProjectInventoryEntry[] = [{
      slug: '-home-jordan-unknown-app',
      decodedPath: decoded,
      exists: false,
      source: 'sessionCwd',
    }];

    await expect(
      collectRemapDecisions(missing, { silent: true, remap: ['/other/prefix=/somewhere'] })
    ).rejects.toMatchObject({ code: 'PATH_REMAP_AMBIGUOUS' });
  });

  it('throws PATH_REMAP_AMBIGUOUS when no --remap flag at all', async () => {
    const decoded = '/home/jordan/unknown-app';
    const missing: ProjectInventoryEntry[] = [{
      slug: '-home-jordan-unknown-app',
      decodedPath: decoded,
      exists: false,
      source: 'sessionCwd',
    }];

    await expect(
      collectRemapDecisions(missing, { silent: true })
    ).rejects.toMatchObject({ code: 'PATH_REMAP_AMBIGUOUS' });
  });
});
```

**AC6(f) — no-op detection:**
```typescript
describe('AC6(f): no-op — suggestion equals originalPath', () => {
  it('action: no-op when targetPath would be the same as originalPath', async () => {
    const slug = '-home-jordan-myapp';
    const decoded = '/home/jordan/myapp';
    // Candidate /home/jordan/myapp exists (same as originalPath!) → suggestion = decoded
    state.statPaths.set('/home/jordan/myapp', existingFileStat());
    mockPromptRemapDecision.mockResolvedValue({ action: 'accept', path: decoded });

    const missing: ProjectInventoryEntry[] = [{ slug, decodedPath: decoded, exists: false, source: 'sessionCwd' }];
    const decisions = await collectRemapDecisions(missing, {});

    expect(decisions[0]?.action).toBe('no-op');
    expect(decisions[0]?.targetPath).toBeNull();
  });
});
```

**AC1(g) — skip action:**
```typescript
describe('AC1(g): skip from prompt → action: skip, targetPath: null', () => {
  it('skip decision recorded correctly', async () => {
    const slug = '-home-jordan-gone-app';
    const decoded = '/home/jordan/gone-app';
    mockPromptRemapDecision.mockResolvedValue({ action: 'skip', path: decoded });

    const missing: ProjectInventoryEntry[] = [{ slug, decodedPath: decoded, exists: false, source: 'sessionCwd' }];
    const decisions = await collectRemapDecisions(missing, {});

    expect(decisions).toEqual([{
      slug,
      originalPath: decoded,
      targetPath: null,
      action: 'skip',
    }]);
  });
});
```

**AC8(h) — --json with remappings:**
```typescript
describe('AC8(h): --json mode includes summary.remappings', () => {
  it('stdout JSON has remappings array from decisions', async () => {
    const slug = '-home-jordan-moved-app';
    const decoded = '/home/jordan/moved-app';
    state.readdirDirent.set(PROJECTS_DIR, [dir(slug)]);
    state.resolveBySlug.set(slug, { path: decoded, source: 'sessionCwd' });
    // No stat for decoded → exists: false
    // Candidate /home/jordan/dev/moved-app exists
    state.statPaths.set('/home/jordan/dev/moved-app', existingFileStat());
    mockPromptRemapDecision.mockResolvedValue({ action: 'accept', path: '/home/jordan/dev/moved-app' });

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await run({ json: true });

    const stdoutText = stdoutSpy.mock.calls
      .map((c) => (typeof c[0] === 'string' ? c[0] : Buffer.from(c[0]).toString('utf8')))
      .join('');
    const lastLine = stdoutText.split('\n').filter((l) => l.length > 0).pop() ?? '';
    const parsed = JSON.parse(lastLine) as {
      success: boolean;
      summary: { text: string; projects: unknown[]; remappings: unknown[] };
    };

    expect(parsed.success).toBe(true);
    expect(Array.isArray(parsed.summary.remappings)).toBe(true);
    expect(parsed.summary.remappings).toHaveLength(1);
    expect((parsed.summary.remappings[0] as { action: string }).action).toBe('remap');

    stdoutSpy.mockRestore();
  });
});
```

---

### ESLint Rules to Observe

| Rule | What to avoid | Correct alternative |
|------|--------------|---------------------|
| `no-hardcoded-separator` | `'/'`, `'\\'` as string literals in path operations | Use `posix.sep`, `win32.sep`, or `join()` |
| `no-process-env-home` | `process.env.HOME` | `homedir()` from `node:os` |
| `cmemmov/no-raw-json-parse` | `JSON.parse(...)` calls outside of `claude-reader.ts` | Not applicable here (no JSON parsing in fix-paths) |

Run `npm run lint` before committing to catch violations early.

---

### Key Constraints

1. **`findMatchingDir` is pure — you must pre-build and pre-filter candidates.** The function does not touch the filesystem. Call `stat` on each candidate and only include existing paths in the `candidatePaths` array you pass to it.

2. **`collectRemapDecisions` must be exported** (tests call it directly).

3. **Do not touch `path-engine.ts` or `error.ts`** — `PATH_REMAP_AMBIGUOUS` (exit 2) and `findMatchingDir` are already there.

4. **The existing AC4+AC9(d) and AC9(g) tests will fail** after this story's changes to `run()` unless you add the `prompts.ts` mock. Do this first before running the test suite, or the test output will be noisy.

5. **`promptRemapDecision` does not take a `silent` flag** — silence is handled by `collectRemapDecisions` before the prompt is ever called (scripted path returns early, interactive path calls the prompt). This keeps the prompt function simple.

6. **No-op `targetPath` is `null`, not the original path** — even though the path would be the same, `targetPath: null` is the canonical representation for non-remap decisions (consistent with `skip`).

7. **`--remap` without `--silent` in interactive mode**: The `--remap` specs are currently only consulted in silent mode. In interactive mode, `findMatchingDir`-based suggestion takes precedence (the user sees the prompt). This is intentional per the AC — `--remap` is a scripted-mode flag. Do not apply `--remap` substitution in interactive mode.

8. **`basename` from `node:path`** is safe here because `decodedPath` is always in the current OS's native path format (from `sessionCwd` recorded on this machine, or `slugToPath(slug, process.platform)`). Cross-OS path handling is not required in `fix-paths`.

---

### Testing the Story Manually

```bash
# Build
npm run build

# Dry-run scan (needs some missing .claude/projects/ entries to test fully)
node dist/cli.js fix-paths --dry-run

# Scripted mode
node dist/cli.js fix-paths --silent --remap "/old/path=/new/path"

# JSON mode
node dist/cli.js fix-paths --json

# Run unit tests
npm test -- fix-paths
```

---

### Story 3.3 Dependencies (what to leave for the next story)

After `collectRemapDecisions` returns in `run()`, Story 3.3 will add:
```typescript
if (!opts.dryRun) {
  await applyDecisions(decisions, claudeDir);
}
```

Do NOT implement `applyDecisions` in this story. Just return after emitting the decision summary.

---

## Tasks/Subtasks

- [x] Task 1 (AC2, AC3): Add `promptRemapDecision` to `src/ui/prompts.ts`
  - [x] Define and export `RemapDecisionResult` interface
  - [x] Implement `promptRemapDecision` (accept/override/skip select; text fallback for override)
  - [x] No silent branch — silence is handled in caller
- [x] Task 2 (AC1, AC4, AC5, AC6, AC7): Extend `src/commands/fix-paths.ts`
  - [x] Add optional `remap?: string[]` to `FixPathsOpts`
  - [x] Define and export `RemapDecision` interface
  - [x] Implement and export `collectRemapDecisions(missing, opts, claudeDir)`
  - [x] Build candidate paths from common parent dirs (home, dev, work, projects, src) + project basename, filter via `stat`
  - [x] Silent path: parse `--remap` specs, longest-prefix match using `posix.sep`/`win32.sep`, throw `PATH_REMAP_AMBIGUOUS` on miss
  - [x] Interactive path: call `findMatchingDir` for suggestion, then `promptRemapDecision`
  - [x] No-op detection: `targetPath === decodedPath` → `{ action: 'no-op', targetPath: null }`
  - [x] Update `run()` to call `collectRemapDecisions`, emit per-decision progress, dry-run notice, summary including decisions
  - [x] Use `dirname(claudeDir)` for home derivation (lint rule reserves `os.homedir()` for `claude-locator.ts`)
- [x] Task 3 (AC4): Add `--remap` flag to `fixPathsCmd` in `src/cli.ts` (reuse existing `parseRemap`)
- [x] Task 4 (AC9): Update `src/commands/fix-paths.test.ts`
  - [x] Mock `../ui/prompts.js` with hoisted `mockPromptRemapDecision`
  - [x] Reset mock in `resetState()`
  - [x] Update existing AC4+AC9(d) test: mock `promptRemapDecision` to return `skip`, update describe comment
  - [x] Update existing AC9(g) mixed-tree test: mock `promptRemapDecision`
  - [x] Add AC1(a): suggestion accepted → `action: 'remap'`
  - [x] Add AC1(b): no candidate on disk → `suggestion: null` passed to prompt
  - [x] Add AC4(c): scripted `--remap` prefix substitution (with longest-prefix-wins variant)
  - [x] Add AC4(d)+AC5: `PATH_REMAP_AMBIGUOUS` thrown for unmatched silent
  - [x] Add AC6(f): no-op when suggestion equals originalPath (interactive + silent variants)
  - [x] Add AC1(g): skip → `action: 'skip', targetPath: null`
  - [x] Add AC8(h): `--json` includes `summary.remappings`
  - [x] Update existing AC6+AC9(h) `--json with missing projects` test (summary text changed)
  - [x] Add AC7 dry-run: missing project → dry-run notice on stderr, summary on stdout, no throw
- [x] Task 5: Run `npm run lint`, `npm run typecheck`, and `npm test`; fix any failures

## Dev Agent Record

### Implementation Plan

- Use `dirname(claudeDir)` instead of `os.homedir()` to honor the project ESLint rule (`no-restricted-imports`) — same pattern as `gatherSuggestion` in `import.ts`. The story doc's example shows `homedir()`, but the lint rule reserves that import for `claude-locator.ts`.
- Plumb `claudeDir` through to `collectRemapDecisions` so it can derive home. Function signature becomes `(missing, opts, claudeDir)`.
- Reuse `parseRemap` from `cli.ts` for the new `--remap` option.
- For separator matching in prefix substitution, import `posix`, `win32` (story doc note 1) and use `posix.sep`, `win32.sep`.
- Test mocking: hoist `mockPromptRemapDecision`, replace the `../ui/prompts.js` import target. Skip the `node:os` mock — since we use `dirname(claudeDir)` which derives from the already-mocked `locateClaude`, no `os` mock is needed (claudeDir = `/home/jordan/.claude` → home = `/home/jordan`).

### Debug Log

- Initial run of `npm test -- fix-paths` had 1 failure in AC1(a): the test set `state.statPaths` keys with forward-slash literals, but on Windows `path.join` produces backslash-separated paths. The mocked `stat` lookup missed because the production code constructed candidate paths via `join(home, 'dev', name)` (OS-native separators), while the test keys were forward-slash literals.
  - Fix: introduced `HOME = join('/home', 'jordan')` constant and rewrote AC1(a), AC6(f), AC7-dry-run, and AC8(h) to use `join(HOME, ...)` for both stat keys and assertion paths. After this change all 22 fix-paths tests pass.
- Initial typecheck failed on `vi.fn<[unknown], Promise<RemapDecisionResult>>()` — Vitest 2's `vi.fn<T>` takes a single function-type argument, not an args+return tuple. Switched to `vi.fn<(opts: …) => Promise<RemapDecisionResult>>()`.

### Completion Notes

- All 9 ACs satisfied. AC9 sub-cases (a)–(i) are covered by 9 dedicated describe blocks plus updates to two existing tests.
- **Design deviation from story doc**: the story's example code imported `homedir` from `node:os` directly. The project's ESLint `no-restricted-imports` rule (eslint.config.js:55-65) reserves `os.homedir()` for `services/claude-locator.ts`. I followed the established alternative used by `commands/import.ts` (lines 105-111): derive `home = dirname(claudeDir)`, threading `claudeDir` into `collectRemapDecisions` as a third parameter. The function signature is therefore `collectRemapDecisions(missing, opts, claudeDir)` rather than the doc's `(missing, opts)`.
- **Test mock approach**: mocked `../ui/prompts.js` at the top of the test file via `vi.mock` + `vi.hoisted`. The story doc also recommended mocking `node:os` for `homedir()`, but that was unnecessary because we use `dirname(claudeDir)` and `claudeDir` is already controlled by the existing `claude-locator` mock.
- **Cross-OS test alignment**: candidate paths are constructed in production via `join(home, ...)`, which uses OS-native separators. Tests register `state.statPaths` keys with `join(HOME, ...)` so the mock lookup matches. `findMatchingDir` itself is OS-tolerant (it considers both `posix.sep` and `win32.sep`), so suggestion selection works across separator styles.
- `--remap` longest-prefix-wins logic mirrors `path-engine.remapByDecisions` semantics — same separator boundary check using `posix.sep` and `win32.sep` to satisfy `cmemmov/no-hardcoded-separator`.
- Validations: `npm run lint` passes with `--max-warnings=0`. `npm run typecheck` passes. Full suite: 450 passed, 2 skipped, 0 failed.

## File List

Modified:

- `src/commands/fix-paths.ts` — added `RemapDecision` type, extended `FixPathsOpts.remap`, added `collectRemapDecisions`, `parseRemapSpecs`, `matchRemapSpec`, `buildSuggestion` helpers; rewrote `run()` tail to invoke remap phase and emit decisions
- `src/ui/prompts.ts` — added `RemapDecisionResult` interface and `promptRemapDecision` function
- `src/cli.ts` — added `--remap` option to `fixPathsCmd` (reuses existing `parseRemap`)
- `src/commands/fix-paths.test.ts` — added `mockPromptRemapDecision` hoisted mock; reset hook; updated existing AC4+AC9(d), AC9(g), and AC6+AC9(h) tests to mock the prompt and assert on the new summary text; added 9 new describe blocks for Story 3.2 ACs

Story file (tracking only):

- `_bmad-output/implementation-artifacts/3-2-auto-suggestion-interactive-remap-flow.md` — added Tasks/Subtasks, Dev Agent Record, File List, Change Log, Status sections; checked off all task boxes; status set to review
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — story 3-2 status updated ready-for-dev → in-progress → review

## Change Log

- 2026-05-09 — Story 3.2 implemented: auto-suggestion via `findMatchingDir`, interactive `promptRemapDecision`, scripted `--remap` with longest-prefix substitution, no-op detection, `PATH_REMAP_AMBIGUOUS` for unhandled silent missing projects, `summary.remappings` in `--json` output, `[dry-run]` notice when applicable. 450 tests passing across the suite.

### Review Findings

- [x] [Review][Patch] `parseRemapSpecs` validation runs even in interactive mode where `--remap` is ignored, so a malformed `--remap` flag aborts an interactive run with `INTERNAL` despite never being consulted [src/commands/fix-paths.ts:134] — fixed: parseRemapSpecs now invoked only inside the silent branch.
- [x] [Review][Patch] `buildSuggestion` accepts non-directory paths as candidates because the post-`stat` filter does not check `isDirectory()`. A regular file at `~/dev/<projectName>` would be proposed as a remap target [src/commands/fix-paths.ts:118] — fixed: stat result now filtered via `s.isDirectory()`.
- [x] [Review][Patch] `parseRemapSpecs` accepts a spec with empty rhs (`foo=`) producing a target like `''` + suffix; `eqIdx < 1` blocks `=foo` but not `foo=` [src/commands/fix-paths.ts:77] — fixed: also reject empty rhs.
- [x] [Review][Patch] Test mock typed inline as `(opts: { slug, originalPath, suggestion }) => Promise<RemapDecisionResult>` — won't fail to compile if production signature changes [src/commands/fix-paths.test.ts:32] — fixed: typed via `typeof promptRemapDecision`.
- [x] [Review][Patch] When the user passes `--remap` interactively, the flag is silently ignored with no warning — confusing UX [src/commands/fix-paths.ts:160] — fixed: emit a one-time warn when interactive mode receives `--remap` flags.
- [x] [Review][Patch] AC1(b) test asserts the prompt-call args but never asserts what `decisions[0]` actually became [src/commands/fix-paths.test.ts:466] — fixed: added `expect(decisions[0]?.action).toBe('skip')`.
- [x] [Review][Patch] No win32-shaped decodedPath coverage for `matchRemapSpec` separator-boundary handling [src/commands/fix-paths.test.ts] — fixed: added a win32-style decodedPath silent-remap test.
- [x] [Review][Defer] `dirname(claudeDir)` derives the wrong "home" tree when `CLAUDE_CONFIG_DIR` is non-default — pre-existing pattern shared with `commands/import.ts::gatherSuggestion` [src/commands/fix-paths.ts:106] — deferred, see deferred-work.md.

## Status

review
