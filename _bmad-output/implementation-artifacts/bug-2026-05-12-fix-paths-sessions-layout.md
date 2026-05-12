# Bug Report — `fix-paths` misreads hyphenated project paths; root cause is wrong session-files layout assumption

- **Reporter:** Joshua Brandt (alpha tester, dogfooding)
- **Date:** 2026-05-12
- **Severity:** HIGH — blocks the primary `fix-paths` use case for any project whose folder name contains a hyphen (i.e. essentially every Git repo)
- **Affected commands:** `fix-paths` (primary), `export --include-sessions` (silent data loss)
- **Affected files:**
  - [src/services/claude-reader.ts:224](../../src/services/claude-reader.ts#L224) — `readProject`
  - [src/services/claude-reader.ts:287](../../src/services/claude-reader.ts#L287) — `resolveOriginalPath`
- **Build tested:** `main` @ 2a0e0b1 (Story 3.4 / fix-paths integration tests landed); `npm run build` produces working binary
- **Status:** Open

---

## TL;DR

`resolveOriginalPath` is designed to prefer the authoritative `cwd` value from a project's most recent session JSONL over the documented-lossy `slugToPath` decoder. But it looks for those JSONLs under `<slug>/sessions/<*.jsonl>`, while Claude Code actually writes them directly under `<slug>/<*.jsonl>`. So the `sessionCwd` branch never fires in real installs, every slug falls through to `slugToPath`, and any folder name containing `-` is silently mangled.

Knock-on: the same wrong path is used in `readProject` for export, so `export --include-sessions` silently produces bundles with zero sessions on a real Claude install.

---

## Reproduction

Pre-condition: a Claude install where projects with hyphens in their folder name have been used (any normal repo). I reproduced with three projects I'd just moved into a parent dir:

```
mv ~/fhir-bridge ~/cen-fhir-cortex/
mv ~/query-parameter-registry ~/cen-fhir-cortex/
mv ~/repository-registry ~/cen-fhir-cortex/
```

Then:

```sh
node dist/cmemmov.js fix-paths --dry-run \
  --remap "/Users/jbrandt/fhir-bridge=/Users/jbrandt/cen-fhir-cortex/fhir-bridge" \
  --remap "/Users/jbrandt/query-parameter-registry=/Users/jbrandt/cen-fhir-cortex/query-parameter-registry" \
  --remap "/Users/jbrandt/repository-registry=/Users/jbrandt/cen-fhir-cortex/repository-registry" \
  --silent
```

### Observed

```
Scanned -Users-jbrandt-fhir-bridge:               /Users/jbrandt/fhir/bridge                [NOT FOUND]
Scanned -Users-jbrandt-query-parameter-registry:  /Users/jbrandt/query/parameter/registry   [NOT FOUND]
Scanned -Users-jbrandt-repository-registry:       /Users/jbrandt/repository/registry        [NOT FOUND]
Scanned -Users-jbrandt-cen-fhir-cortex:           /Users/jbrandt/cen/fhir/cortex            [NOT FOUND]
...
[PATH_REMAP_AMBIGUOUS]
  hint: --remap rule needed for /Applications/Visual/Studio/Code/app/Contents/Resources/app/bin
```

Exit code 2. No remap applied to any project, because the decoded paths don't match either the user's `--remap` source prefixes or the actual filesystem. The whole run aborts on an unrelated unfixable slug (`-Applications-Visual-Studio-Code-app-Contents-Resources-app-bin` — a Claude-launched slug for VS Code's bundled `bin/` dir; spaces in the original were also lost to the decoder).

### Expected

Each of the three moved projects should resolve to its **real** original path via the session JSONL `cwd`:

```
-Users-jbrandt-fhir-bridge               -> /Users/jbrandt/fhir-bridge               [MISSING] -> /Users/jbrandt/cen-fhir-cortex/fhir-bridge
-Users-jbrandt-query-parameter-registry  -> /Users/jbrandt/query-parameter-registry  [MISSING] -> /Users/jbrandt/cen-fhir-cortex/query-parameter-registry
-Users-jbrandt-repository-registry       -> /Users/jbrandt/repository-registry       [MISSING] -> /Users/jbrandt/cen-fhir-cortex/repository-registry
```

…and the user's three `--remap` rules should apply cleanly.

---

## Evidence

### 1. Claude Code stores JSONL session files directly under `<slug>/`, not under `<slug>/sessions/`

```sh
$ ls ~/.claude/projects/-Users-jbrandt-fhir-bridge/
209bd894-7041-44a0-8a5a-1eac06c6c341.jsonl
3e13e938-e7e4-47fc-b9be-ad70c8a685df/
3e13e938-e7e4-47fc-b9be-ad70c8a685df.jsonl
43e218e8-171b-462a-85e3-2be002b03b40/
43e218e8-171b-462a-85e3-2be002b03b40.jsonl
...
memory/

$ ls -d ~/.claude/projects/*/sessions/
(no matches)
```

No `sessions/` subdirectory exists for any of the ~20 projects in this install.

### 2. The JSONL files contain the correct authoritative `cwd`

```sh
$ node -e 'const l = require("fs").readFileSync("/Users/jbrandt/.claude/projects/-Users-jbrandt-fhir-bridge/3e13e938-e7e4-47fc-b9be-ad70c8a685df.jsonl","utf8").split("\n").find(x=>x.includes("\"cwd\"")); console.log(JSON.parse(l).cwd)'
/Users/jbrandt/fhir-bridge
```

So the data needed to bypass the lossy decoder is present and reachable — the reader just doesn't open the right directory.

### 3. The decoder itself documents that it's lossy and instructs callers to prefer session `cwd`

[src/core/path-engine.ts:7-19](../../src/core/path-engine.ts#L7-L19):

> ADVISORY — LOSSY DECODE: a folder name containing `-` is indistinguishable from the path separator in the slug. `/home/my-project` and `/home/my/project` both encode to `-home-my-project`. Callers with access to `bundle.originalPath` or session `cwd` MUST prefer those sources over this function.

`resolveOriginalPath` is the caller that's supposed to honor that contract. It tries:

```ts
// src/services/claude-reader.ts:287
const sessionsDir = join(claudeDir, 'projects', slug, 'sessions');
const sessionFiles = await safeReadDir(sessionsDir);
```

`safeReadDir` swallows `ENOENT` and returns `[]`, so the JSONL branch quietly never enters. Control falls to:

```ts
// src/services/claude-reader.ts:339
const decoded = slugToPath(slug, process.platform);
```

…and the lossy decode is returned with `source: 'slugDecode'`.

### 4. Tests don't catch this because fixtures put JSONLs under `<slug>/sessions/`

The existing tests pass because they construct fixture data matching the code's assumption, not the on-disk reality. There's no integration test that exercises a fixture mirroring an actual Claude install layout, so the divergence is invisible to CI.

---

## Root Cause

A wrong assumption about Claude Code's on-disk layout was baked into `claude-reader.ts` and into the test fixtures, masking the mistake:

| Location | Assumed | Actual |
| --- | --- | --- |
| `claude-reader.ts:224` (`readProject`) | `<slug>/sessions/*.jsonl` | `<slug>/*.jsonl` |
| `claude-reader.ts:287` (`resolveOriginalPath`) | `<slug>/sessions/*.jsonl` | `<slug>/*.jsonl` |
| `claude-writer.ts:705` and writer tests | `<slug>/sessions/*.jsonl` | likely also wrong; needs audit |

The technical research doc at [_bmad-output/planning-artifacts/research/technical-claude-code-migration-research-2026-05-08.md](../planning-artifacts/research/technical-claude-code-migration-research-2026-05-08.md) should be checked — if it documents `<slug>/sessions/` that's the upstream source of the error; if it documents flat `<slug>/` then the implementation drifted.

---

## Proposed Fixes

### Fix 1 — Read session JSONLs from `<slug>/` directly (REQUIRED, scope: claude-reader.ts)

In both `readProject` and `resolveOriginalPath`, scan `projectDir` (the slug dir) for files ending in `.jsonl` and treat each as a session file. Drop the `sessions/` subdirectory join. Exclude subdirectories — the slug dir also contains a `<uuid>/` subdir (sidecar for compacted history?) and a `memory/` subdir, neither of which contain `.jsonl` to be enumerated as sessions.

Once `resolveOriginalPath` actually opens the JSONLs, the `sessionCwd` branch fires for every project that has any history, the lossy `slugToPath` becomes a last-resort fallback (consistent with its own docstring), and the `fix-paths` flow works correctly for hyphenated folders.

### Fix 2 — Mirror the layout change in the writer (REQUIRED, scope: claude-writer.ts)

`claude-writer.ts:705` and its tests use the same wrong path. If the reader is corrected to read flat-layout sessions but the writer still emits a `sessions/` subdir, an `export → import` round trip will silently drop sessions. Audit and align.

### Fix 3 — `fix-paths` should not abort the whole run because one slug is undecodable (RECOMMENDED, scope: fix-paths command)

The `PATH_REMAP_AMBIGUOUS` exit on an unrelated VS Code slug aborted my run even for the three slugs I had explicit `--remap` rules for. Suggested behavior: surface the unresolvable slug as a per-project warning (`SKIPPED — ambiguous original path; supply --remap or rename manually`) and proceed with the rest. Reserve the hard-abort for "no rules matched any project."

After Fix 1 lands this becomes much rarer — most "ambiguous" cases were actually fine and the tool just couldn't see the truth in the JSONL — but it's still a real UX failure for genuinely-undecodable cases (e.g., the VS Code slug, which has lost both `/` and ` ` to the encoder).

### Fix 4 — Add a real-layout integration fixture (RECOMMENDED, scope: tests)

Add an integration test fixture that mirrors the real Claude layout: flat JSONLs under `<slug>/`, a `<uuid>/` sidecar dir, a `memory/` dir. Hyphenated folder names in the test set (e.g., `fhir-bridge`, `cen-test-framework`). Run `fix-paths --dry-run` against it with one `--remap` and assert the resolved paths come from `cwd`, not the lossy decoder. This is the test that would have caught the bug pre-release.

---

## Suggested Test Plan

1. Unit test for `resolveOriginalPath`: given a fixture slug dir with one flat `<uuid>.jsonl` whose first line has `"cwd": "/Users/x/with-hyphens"`, the function returns `{ path: "/Users/x/with-hyphens", source: "sessionCwd" }` even though `slugToPath` would return `/Users/x/with/hyphens`.
2. Unit test for `resolveOriginalPath` fallback: empty slug dir (no JSONL) → falls through to `slugToPath`, source `slugDecode`. Verifies the fallback still works when sessions are absent.
3. Integration test for `fix-paths`: real-layout fixture with three moved projects + one undecodable extra slug; `--remap` for the three; expect all three remapped, the extra one warned-and-skipped, exit 0.
4. Round-trip test for `export → import` with `--include-sessions`: assert session count preserved (currently silently zero on the export side).

---

## Workaround until fixed

For users hit by this on the three-projects-moved scenario, the manual fix is:

```sh
cd ~/.claude/projects
mv -Users-jbrandt-fhir-bridge -Users-jbrandt-cen-fhir-cortex-fhir-bridge
mv -Users-jbrandt-query-parameter-registry -Users-jbrandt-cen-fhir-cortex-query-parameter-registry
mv -Users-jbrandt-repository-registry -Users-jbrandt-cen-fhir-cortex-repository-registry
```

Then patch the matching `projects` keys in `~/.claude.json` if any exist (in my install they don't — these projects had no `.claude.json` entry, only the slug-dirs). `lastSessionCwd` isn't relevant here since the slug encodes the path Claude Code uses to find the directory.

---

## Related

- README claims `fix-paths` is "Complete and tested" ([README.md:289](../../README.md#L289)) and Epic 3 is marked Complete ([README.md:305](../../README.md#L305)) — this report shows the integration tests covered the spec but not the real on-disk layout.
- The same hyphen-decode pitfall is foreshadowed in the path-engine docstring; the gap is between that docstring's recommendation and the caller actually following it.
