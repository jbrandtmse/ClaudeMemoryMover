# Slug algorithm

Claude Code encodes each project's absolute filesystem path into a single-segment directory name (a "slug") so it can store per-project session history and settings under `~/.claude/projects/<slug>/`. This page documents the encoding rule, the cases where it round-trips losslessly, the cases where it doesn't, and how `cmemmov` falls back when the decoder can't recover the original.

For how the engine uses these results — same-OS resolution, cross-OS remap, the `findMatchingDir` scan — see [docs/path-remapping.md](path-remapping.md).

---

## Encoding

The encoding rule is literally:

```ts
path.replace(/[:\\/]/g, '-');
```

Every occurrence of `:`, `\`, or `/` is replaced with `-`. Nothing else is escaped, normalized, or trimmed.

`cmemmov` exposes this as `pathToSlug` in [`src/core/path-engine.ts`](../src/core/path-engine.ts):

```ts
export function pathToSlug(absolutePath: string): string {
  return absolutePath.replace(/[:\\/]/g, '-');
}
```

### Examples (POSIX)

| Path | Slug |
| --- | --- |
| `/Users/alex/dev/proj` | `-Users-alex-dev-proj` |
| `/home/maya/work/api` | `-home-maya-work-api` |
| `/tmp/foo` | `-tmp-foo` |

The leading `/` becomes a leading `-`, then every `/` separator becomes `-`.

### Examples (Windows)

| Path | Slug |
| --- | --- |
| `C:\Users\alex\dev\proj` | `C--Users-alex-dev-proj` |
| `D:\repos\app` | `D--repos-app` |

The drive letter is preserved as-is, the `:` and `\` after it both become `-` (producing the leading `<letter>--` pattern), and each subsequent `\` becomes `-`. Forward slashes inside a Windows path (`C:/Users/...`) encode the same way.

---

## Lossless cases

A slug round-trips losslessly when **no folder name in the original path contains `-`**.

In that case, the slug's `-` characters are exactly the encoded separators, and the decoder can split unambiguously:

- `/Users/alex/dev/proj` ↔ `-Users-alex-dev-proj` ✓
- `C:\Users\maya\src` ↔ `C--Users-maya-src` ✓

Both directions are exact. This is the common case for cleanly-named project trees.

---

## The lossy case

A slug is **structurally ambiguous** when at least one folder name in the original path contains `-`.

Both of these distinct paths encode to the same slug:

| Original path | Slug |
| --- | --- |
| `/Users/alex/dev/fhir-bridge` | `-Users-alex-dev-fhir-bridge` |
| `/Users/alex/dev/fhir/bridge` | `-Users-alex-dev-fhir-bridge` |

The decoder has no way to tell, from the slug alone, whether a given `-` was originally a path separator or a literal hyphen. The encoding loses information that can't be recovered without out-of-band context.

### Why this isn't fixed at the encoder

The encoding rule is Claude Code's, not `cmemmov`'s — we can't change it. `cmemmov` is a downstream consumer that has to work with whatever slugs Claude Code produces. Even if Claude Code switched to an unambiguous encoding tomorrow, every existing user's slug directories would still be in the legacy format.

---

## Decoding (advisory only)

`slugToPath` in [`src/core/path-engine.ts`](../src/core/path-engine.ts) inverts the encoding rule by greedy-splitting on every `-`. Its docstring carries an explicit advisory:

> **ADVISORY — LOSSY DECODE:** a folder name containing `-` is indistinguishable from the path separator in the slug. […] Callers with access to `bundle.originalPath` or session `cwd` MUST prefer those sources over this function.

The return shape:

- `string` — the decoded path. **May be the wrong path** for hyphenated folder names.
- `null` — the slug is structurally invalid for the source platform (e.g., a `darwin`/`linux` slug that doesn't start with `-`, or a `win32` slug that doesn't match `^[A-Za-z]--`). `null` does NOT signal hyphen-ambiguity; that ambiguity is undetectable from the slug alone.

Use `slugToPath` only as a last-resort fallback.

---

## Fallback strategy

`cmemmov` has three sources for "what does this slug really mean?", in priority order. The full implementation is `resolveOriginalPath` in [`src/services/claude-reader.ts`](../src/services/claude-reader.ts).

### 1. Session `cwd` from JSONL (authoritative)

When the slug directory contains at least one `*.jsonl` file, the first non-empty JSON line of the **most recently modified** JSONL carries a `cwd` string field with the exact path Claude Code used at session start. This is authoritative — no encoding loss, no ambiguity.

`resolveOriginalPath` returns `{ path: cwd, source: 'sessionCwd' }` in this branch.

### 2. Slug decode (structural fallback)

When no JSONL exists under the slug directory — e.g., the user just created the project but hasn't started a Claude Code session in it yet, or they deleted their session history — `cmemmov` falls back to `slugToPath`. In the lossless case (no `-` in any folder name) this is exact; in the lossy case it returns one of several structurally valid candidates.

`resolveOriginalPath` returns `{ path: decoded, source: 'slugDecode' }` in this branch.

### 3. User confirmation (`fix-paths` interactive flow)

When `slugToPath` returns a path that doesn't exist on disk, `fix-paths` runs `findMatchingDir` against likely parent directories to find a candidate by last-segment match, then presents the candidates to the user via an interactive prompt:

```
The slug '-Users-alex-dev-fhir-bridge' decoded to '/Users/alex/dev/fhir/bridge', which doesn't exist.
Found a possible match: /Users/alex/dev/fhir-bridge

Use this path? [Y/n]
```

In `--silent` mode (no TTY for prompts), the same case fails with a structured error so a scripted run doesn't silently pick the wrong candidate.

---

## Edge cases worth knowing

- **Backslashes inside POSIX paths.** Unix permits `\` as a literal character in a filename. `pathToSlug` will replace it with `-` along with the real separators. A path like `/home/alex/weird\name` becomes `-home-alex-weird-name` — indistinguishable from `/home/alex/weird/name`. In practice no one names files this way; the engine's decoder assumes POSIX paths use only `/` as a separator.
- **Drive letters with non-ASCII.** Windows allows any letter `A`–`Z` (case-insensitive) as a drive. `slugToPath` accepts `[A-Za-z]` for the leading drive letter and rejects anything else as structurally invalid.
- **UNC paths (`\\server\share\...`).** Not supported. Claude Code's encoding would produce `--server-share-...`, which `slugToPath` rejects on Windows (drive-letter regex doesn't match) and on POSIX (it would mis-decode as `/server/share/...`). Out of scope; `cmemmov` doesn't attempt to round-trip UNC-rooted projects.
- **Trailing slashes.** Claude Code doesn't put a trailing separator in the path it slugifies. `pathToSlug('/foo/')` would produce `-foo-` (trailing `-`), which `slugToPath` would decode as `/foo/`. The asymmetry exists but doesn't bite in practice — Claude Code uses `process.cwd()` style paths, which don't have trailing separators.

---

## Where this lives in code

| Concern | File | Symbol |
| --- | --- | --- |
| Encoding (path → slug) | [`src/core/path-engine.ts`](../src/core/path-engine.ts) | `pathToSlug` |
| Decoding (slug → path, advisory) | [`src/core/path-engine.ts`](../src/core/path-engine.ts) | `slugToPath` |
| Session-`cwd`-first resolution | [`src/services/claude-reader.ts`](../src/services/claude-reader.ts) | `resolveOriginalPath` |
| Candidate scan for missing paths | [`src/core/path-engine.ts`](../src/core/path-engine.ts) | `findMatchingDir` |

For the higher-level walk-throughs (Alex/Maya/Jordan/hyphenated journeys), see [docs/path-remapping.md](path-remapping.md).
