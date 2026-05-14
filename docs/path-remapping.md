# Path remapping

Claude Code stores each project's history under `~/.claude/projects/<slug>/`, where `<slug>` is the project's absolute filesystem path with `:`, `\`, and `/` all replaced by `-`. That works on the original machine, but as soon as the project moves (renamed folder, reorganized home directory, different OS), the slug points at a path that no longer exists. `cmemmov` exists to put the right slug back in the right place.

This page covers the engine that does the work: how `cmemmov` decodes a slug into an absolute path, how it remaps a path across operating systems, and how it falls back when the slug encoding is ambiguous. Each section ends with a worked example drawn from one of the user journeys cmemmov was designed for.

For the slug encoding itself (one direction only — path → slug), see [docs/slug-algorithm.md](slug-algorithm.md). For where the engine lives in code, see [`src/core/path-engine.ts`](../src/core/path-engine.ts) and [`src/services/claude-reader.ts`](../src/services/claude-reader.ts).

---

## Same-OS resolution

When cmemmov reads a slug on the *same* machine that created it, the path engine has two sources of truth for the slug's original path:

1. **Session-JSONL `cwd` (authoritative).** The most-recently-modified `*.jsonl` file under the slug directory contains a JSON line at the top with the `cwd` field. That `cwd` is the *exact* path Claude Code used when the session started, with no encoding loss. `resolveOriginalPath` in [`src/services/claude-reader.ts`](../src/services/claude-reader.ts) reads the first non-empty JSON line and returns `{ path, source: 'sessionCwd' }`.
2. **Slug decode (fallback).** If no JSONL exists under the slug directory, the engine falls back to `slugToPath` in [`src/core/path-engine.ts`](../src/core/path-engine.ts), which inverts the encoding rule. The return shape is `{ path, source: 'slugDecode' }` when this branch fires.

The session-JSONL preference is critical because the slug encoding is **lossy** when a folder name contains `-` — see "Lossy-decode caveat" below.

---

## Cross-OS conversion via `suggestRemap`

When a bundle exported on one OS is imported on another, the absolute paths inside the bundle (`projects[].originalPath`, `claudeJson.lastSessionCwd`, permission rules, MCP server paths, etc.) need to be translated to the target OS's home-directory shape.

`suggestRemap(originalPath, targetPlatform, targetHomedir)` in [`src/core/path-engine.ts`](../src/core/path-engine.ts) implements this. It:

1. Matches `originalPath` against one of three home-directory regexes:
   - Windows: `^[A-Za-z]:\\Users\\[^\\]+\\(.+)$`
   - macOS: `^/Users/[^/]+/(.+)$`
   - Linux: `^/home/[^/]+/(.+)$`
2. Captures the path *relative to the source home* (e.g. `dev/myproject`).
3. Re-joins the relative portion under `targetHomedir`, normalizing separators to the target OS (`\` for `win32`, `/` for posix).

Returns `null` if no home-shape matches — paths outside a recognized home directory aren't auto-remappable and require a user-supplied `--remap` prefix.

When the user passes `--remap "<source>=<target>"` on the command line (one or more times), `remapByDecisions` in [`src/core/path-engine.ts`](../src/core/path-engine.ts) applies the longest-prefix match against a normalized set of decisions, again with separator normalization to the target OS.

---

## The role of `findMatchingDir`

When a user has reorganized their home directory — projects moved out of `~/old-projects/` into `~/work/`, repos cloned to a new parent, etc. — `suggestRemap` doesn't help because the *home-relative* path also changed. `findMatchingDir(originalPath, scanRoots)` in [`src/core/path-engine.ts`](../src/core/path-engine.ts) is the fallback.

It takes the *last segment* of the original path (handling both `/` and `\` separators in case the path came from a foreign OS) and returns the first candidate root in `scanRoots` whose last segment matches. `fix-paths` uses this when the slug's decoded path doesn't exist on disk and no `--remap` prefix covers it: it scans likely parent directories and offers the matching candidate as a suggested rename.

---

## The lossy-decode caveat

Claude Code encodes a path by replacing each of `:`, `\`, `/` with `-` (the rule is literally `path.replace(/[:\\/]/g, '-')` in Claude Code's source — see [docs/slug-algorithm.md](slug-algorithm.md)). The encoding is **one-way**:

- A path *without* `-` in any folder name decodes losslessly.
- A path *with* `-` in a folder name produces a slug that's structurally ambiguous: the decoder can't tell which `-` was originally a separator and which was originally a literal hyphen.

Example:
- `/home/alex/dev/my-project` → slug `-home-alex-dev-my-project`
- `/home/alex/dev/my/project` → slug `-home-alex-dev-my-project` (identical!)

The engine handles this by preferring session-JSONL `cwd` (authoritative) over slug decoding (structural). When no JSONL exists and the slug is ambiguous, `fix-paths` surfaces both candidate decodings in an interactive prompt and asks the user to confirm; in `--silent` mode it fails with a structured error.

`slugToPath` in [`src/core/path-engine.ts`](../src/core/path-engine.ts) intentionally returns *one* of the candidates without flagging the ambiguity — its docstring marks it advisory and calls out that callers with access to `originalPath` or session `cwd` MUST prefer those. The function only returns `null` when the slug is structurally invalid for the source platform (e.g., a `linux` slug that doesn't start with `-`), not when it's hyphen-ambiguous.

---

## Priority of session `cwd` as authoritative source

The full resolution order in `resolveOriginalPath` ([`src/services/claude-reader.ts`](../src/services/claude-reader.ts)):

1. List `*.jsonl` files in the slug directory; sort by `mtime` descending.
2. For the most-recent JSONL, read the first non-empty line and `JSON.parse` it. If the parsed object has a `cwd` string field, return `{ path: cwd, source: 'sessionCwd' }`.
3. If no JSONL exists, or no JSONL line has a `cwd` field, fall back to `slugToPath(slug, process.platform)`. Return `{ path: decoded, source: 'slugDecode' }` if the decode succeeds.
4. If the decode also fails (structurally invalid slug for the host platform), return `{ path: slug, source: null }` — i.e., the slug itself, with a `null` source so the caller can detect the unresolved case.

If reading the JSONL fails with `EBUSY` or `EPERM` (because Claude Code is still running), the function throws a `CmemmovError` with `code: 'INTERNAL'` and `hint: 'close Claude Code and retry'`. This is the same error surface as `readSessionFile` and is the primary user-visible reason to quit Claude Code before running cmemmov on a write path.

---

## Worked example — Alex's journey (same-OS, lossless)

**State on disk.** Alex is on macOS. He has one Claude Code project at `/Users/alex/dev/myproject`. He runs `cmemmov export` on machine A, then `cmemmov import` on machine B (also macOS, same username).

**The slug.** `pathToSlug('/Users/alex/dev/myproject')` → `-Users-alex-dev-myproject`.

**What cmemmov does internally on export.**

1. `readClaudeSurface` walks `~/.claude/projects/` and lists every subdirectory.
2. For the `-Users-alex-dev-myproject` slug, `resolveOriginalPath` runs:
   - Finds one JSONL under the slug dir (Alex has at least one Claude Code session).
   - Reads its first line, parses `cwd: "/Users/alex/dev/myproject"`.
   - Returns `{ path: '/Users/alex/dev/myproject', source: 'sessionCwd' }`.
3. The bundle's `projects[0].originalPath` is set to that authoritative value.

**What cmemmov does on import (target also macOS).**

1. Reads the bundle. `sourcePlatform` and the current platform are both `darwin` — `isCrossPlatformMigration` returns `false`.
2. For each project, the engine derives the *target* slug from `originalPath`: `pathToSlug('/Users/alex/dev/myproject')` → `-Users-alex-dev-myproject` (identical, because the path is identical).
3. The slug directory is created (or overwritten) under the target `~/.claude/projects/`.

**End state.** The new machine has `~/.claude/projects/-Users-alex-dev-myproject/` with the same contents. The slug round-trips losslessly because no folder name contains `-`.

---

## Worked example — Maya's journey (cross-OS, macOS → Windows)

**State on disk.** Maya has a working setup on macOS with project `/Users/maya/dev/repo`. She buys a Windows laptop and runs `cmemmov import maya-export.cmemmov --remap "/Users/maya=/C:/Users/maya"` on it.

**The bundle's contents.** Exported from macOS:
- `sourcePlatform: "darwin"`
- `sourceHomedir: "/Users/maya"`
- `projects[0].slug: "-Users-maya-dev-repo"`
- `projects[0].originalPath: "/Users/maya/dev/repo"`
- `claudeJson.lastSessionCwd: "/Users/maya/dev/repo"`
- `global.settings.permissions: ["Read(/Users/maya/dev/repo)"]`

**What cmemmov does internally on import.**

1. Parse the bundle; verify integrity checksum.
2. Detect cross-OS migration: `isCrossPlatformMigration('darwin', 'win32')` → `true`.
3. Apply the user's `--remap` spec. `remapByDecisions('/Users/maya/dev/repo', [{ originalPath: '/Users/maya', targetPath: 'C:\\Users\\maya' }])`:
   - Matches the prefix `/Users/maya`.
   - Slices the suffix `/dev/repo`.
   - Detects the target uses Windows separators; normalizes the suffix.
   - Returns `C:\Users\maya\dev\repo`.
4. Compute the target slug: `pathToSlug('C:\\Users\\maya\\dev\\repo')` → `C--Users-maya-dev-repo` (note the leading `C-` from the encoded `C:` and the `--` from the encoded `:\` pair).
5. Write the project's contents to `C:\Users\maya\.claude\projects\C--Users-maya-dev-repo\`.
6. Patch `.claude.json::lastSessionCwd` to `C:\Users\maya\dev\repo`.
7. Patch `global.settings.permissions` entries that match the remap prefix: `Read(/Users/maya/dev/repo)` → `Read(C:\Users\maya\dev\repo)`.
8. Create a timestamped backup of the pre-existing `~/.claude/` before writing.

**End state.** Maya's Windows machine has a fully-migrated Claude Code setup with the new project slug under `C:\Users\maya\.claude\projects\`, all path references re-rooted under `C:\Users\maya\`, and a backup at `~/.claude/backups/cmemmov-backup-<timestamp>/` she can roll back to with `cmemmov rollback`.

For interactive (no-flag) cross-OS imports, cmemmov detects the platform mismatch automatically and walks Maya through a guided per-project remap prompt, suggesting `C:\Users\maya\...` via `suggestRemap` if the path matches a known home shape.

---

## Worked example — Jordan's journey (same-OS, projects moved)

**State on disk.** Jordan reorganized his home directory: everything under `~/old-projects/` is now under `~/new-projects/`. He didn't move the corresponding Claude Code slug directories — they still encode the old paths. When he opens a project, Claude Code happily creates a *fresh* slug for the new path, leaving the old slug orphaned with all its session history.

**What `cmemmov fix-paths` does internally.**

1. Read `~/.claude/projects/`. For each slug, run `resolveOriginalPath`.
2. For `-home-jordan-old-projects-foo`:
   - JSONL exists, but its `cwd` is `/home/jordan/old-projects/foo` (the original path at session-creation time).
   - The decoded path doesn't exist on disk (`/home/jordan/old-projects/foo` is gone).
3. Mark the project as `MISSING`. Report it to Jordan.
4. Jordan passes `--remap "/home/jordan/old-projects=/home/jordan/new-projects"` (or accepts the auto-suggestion from `findMatchingDir`, which spots `~/new-projects/foo` as a candidate by matching the last segment `foo`).
5. `remapByDecisions` returns `/home/jordan/new-projects/foo`.
6. Compute new slug: `-home-jordan-new-projects-foo`.
7. Rename the slug directory: `~/.claude/projects/-home-jordan-old-projects-foo` → `~/.claude/projects/-home-jordan-new-projects-foo`. Patch `.claude.json::lastSessionCwd` if it referenced the old path. Back up `.claude/` first.

**End state.** Jordan's session history is now associated with the new project location. Claude Code, on its next start, finds the slug for the directory it's running in and resumes normally.

---

## Worked example — Hyphenated-path case (ambiguous slug)

**State on disk.** Alex has a project at `~/dev/fhir-bridge`. Claude Code encoded it as `-Users-alex-dev-fhir-bridge`.

**The ambiguity.** Decoding that slug naively yields *two* candidates:

- `/Users/alex/dev/fhir-bridge` (the actual path, with a literal `-` in the folder name)
- `/Users/alex/dev/fhir/bridge` (a *different* path, where `/` and `-` both encoded to `-`)

`slugToPath('-Users-alex-dev-fhir-bridge', 'darwin')` returns `/Users/alex/dev/fhir/bridge` (it greedy-splits on every `-`). Without context, the engine has no way to know that's wrong.

**How the resolver handles it.** `resolveOriginalPath`:

1. Finds at least one JSONL under the slug directory.
2. Reads the first line's `cwd: "/Users/alex/dev/fhir-bridge"`.
3. Returns `{ path: '/Users/alex/dev/fhir-bridge', source: 'sessionCwd' }`.

The session `cwd` is authoritative — even though `slugToPath` would have returned the wrong answer, the engine never consults it because the JSONL is present.

**The degenerate case — no JSONL.** If Alex deleted his session history (no JSONLs left in the slug dir), `resolveOriginalPath` falls back to `slugToPath` and returns `/Users/alex/dev/fhir/bridge`. `fix-paths` then runs the same `MISSING` check above; if `/Users/alex/dev/fhir-bridge` exists on disk, `findMatchingDir` will spot it as a candidate (last segment `fhir-bridge` matches the slug's last `-bridge` tail). The interactive flow surfaces both candidates and asks Alex to confirm; in `--silent` mode, it fails with a structured error rather than guess.

This is the practical reason cmemmov treats session JSONLs as authoritative and slug decoding as a last-resort fallback: in the hyphenated-path case, the decoder's output is *structurally valid but semantically wrong*, and only out-of-band context (the JSONL's `cwd`, or an existence check against the filesystem) can disambiguate.

---

## References

- Path engine source: [`src/core/path-engine.ts`](../src/core/path-engine.ts)
- Session-cwd-first logic: [`src/services/claude-reader.ts`](../src/services/claude-reader.ts) (`resolveOriginalPath`)
- Slug encoding spec: [docs/slug-algorithm.md](slug-algorithm.md)
- Top-level command docs: [`../README.md`](../README.md)
