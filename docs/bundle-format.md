# Bundle format

A `cmemmov` bundle is a `.cmemmov` file containing a JSON document conforming to the schema in [`src/core/bundle-schema.ts`](../src/core/bundle-schema.ts). This page documents the on-disk shape, the `team-baseline` profile produced by [`cmemmov share`](../README.md#share--export-a-sanitized-team-bundle), and the redaction record (`wasRedacted`) that tells consumers what was stripped.

The schema is declared with [Zod](https://zod.dev/) (`BundleSchema`, exported from `bundle-schema.ts`) and is the single source of truth. **This doc reflects the schema; if the schema changes, update this doc.**

- **Format version:** `1.1.0` (exported as `BUNDLE_FORMAT_VERSION` from `bundle-schema.ts`)
- **Encoding:** UTF-8 JSON
- **Optional gzip:** detected by leading magic bytes `\x1f\x8b`. Some emitters compress; the parser handles both forms transparently.

---

## Top-level fields

| Field | Required | Type | Purpose |
| --- | --- | --- | --- |
| `version` | yes | `string` | Bundle format version. Currently `"1.1.0"`. Distinct from the cmemmov package version. |
| `exportedAt` | yes | ISO 8601 datetime string | When the bundle was produced. |
| `sourcePlatform` | yes | `"win32" \| "darwin" \| "linux"` | The platform that produced the bundle. Drives slug decoding, separator normalization, and home-dir prefix matching. |
| `sourceHomedir` | yes | `string` | The source machine's home directory (e.g. `/Users/alex` or `C:\Users\alex`). Used by `strip-personal` to anchor home-dir permission and MCP-server stripping. |
| `claudeVersion` | yes | `string` | The version of Claude Code that wrote the source data. Informational. |
| `profile` | no | `"team-baseline"` | Present only on bundles produced by `cmemmov share`. Absent on regular `export` bundles. |
| `hasCredentials` | yes | `boolean` | Whether the bundle includes credentials. Always `false` for share bundles. |
| `warning` | no | `string` | Free-form warning text emitted alongside the bundle (e.g. surfaced when `--include-credentials` was passed on export). |
| `integrity` | no | `string` | SHA-256 of the canonicalized bundle content (computed and verified by the serializer/parser). |
| `wasRedacted` | no | object — see below | Record of what was stripped during sanitization. Present only when at least one strip occurred. |
| `projects` | yes | `Project[]` | Per-project entries — see below. May be empty. |
| `global` | yes | `Global` | Global section — see below. May be empty (all fields optional). |
| `credentials` | no | `Credentials` | Credentials payload. **Never present** in share bundles. Present only when `--include-credentials` was passed on a regular export. |

The schema is `z.object({...}).strict()` — unknown top-level fields cause parse failure.

---

## `projects[]` — per-project entries

Each entry in `projects` describes one slug under `~/.claude/projects/`.

| Field | Required | Type | Purpose |
| --- | --- | --- | --- |
| `slug` | yes | `string` | Claude Code's directory name for this project (e.g. `-Users-alex-dev-myproject`). |
| `originalPath` | yes | `string` | The absolute path the slug encoded on the source machine (resolved from session `cwd` when available, else by slug decode). |
| `settings` | no | `unknown` | Contents of `projects/<slug>/settings.json`, parsed. |
| `memories` | no | `{ filename, content }[]` | Markdown memory files under `projects/<slug>/memory/`. |
| `claudeMd` | no | `string` | Contents of `projects/<slug>/CLAUDE.md`. |
| `sessions` | no | `{ filename, lines }[]` | Session JSONL transcripts. Each `lines` entry is one JSONL record. **Stripped unconditionally by `share`.** |

The schema is strict — unknown per-project fields cause parse failure.

---

## `global` — global section

Mirrors the layout of `~/.claude/` itself.

| Field | Type | Purpose |
| --- | --- | --- |
| `settings` | `unknown` | Contents of `~/.claude/settings.json`. May contain `permissions` (a list of rule strings) and `mcpServers` (an object keyed by server name). |
| `claudeJson` | `unknown` | Contents of `~/.claude.json`. Filtered against `CLAUDE_JSON_TEAM_ALLOWLIST` (see below) for share bundles. |
| `memories` | `{ filename, content }[]` | Markdown memory files under `~/.claude/memory/`. |
| `claudeMd` | `string` | Contents of `~/.claude/CLAUDE.md`. |
| `customCommands` | `{ filename, content }[]` | Files under `~/.claude/commands/`. |
| `teams` | `unknown` | Team configurations under `~/.claude/teams/<team>/config.json`. |
| `plugins` | `unknown` | Plugin configurations from `~/.claude/plugins.json` or `~/.claude/plugins/<name>/config.json`. |
| `mcpConfig` | `unknown` | The standalone MCP config (pulled from `settings.mcpServers` when present). |

All `global` fields are optional. The schema is strict.

---

## `credentials` (optional)

Present only when `--include-credentials` was passed on `export`. **Never present** in share bundles — the share command hardcodes `includeCredentials: false` (NFR6) and `applySanitization('strip-personal')` would replace the content with `null` anyway as defense-in-depth.

| Field | Type | Purpose |
| --- | --- | --- |
| `content` | `unknown` | Raw credentials payload (typically the parsed contents of `~/.claude/.credentials.json`). |
| `wasRedacted` | `boolean` | `true` if a profile pass replaced `content` with `null`. |

---

## `wasRedacted` — the redaction record

When `cmemmov share` (or any other caller of `applySanitization('strip-personal')`) strips data, it records what was removed in a top-level `wasRedacted` object so the recipient can see what was excluded without having to diff the source.

```ts
interface WasRedacted {
  credentials?: boolean;                  // true when credential content was nulled
  personalMemoryFiles?: string[];         // e.g. ['global/personal_notes.md', '-Users-alex-dev-foo/todo.md']
  homeDirPermissionRules?: string[];      // e.g. ['Read(/Users/alex/secrets.txt)']
  localMcpServers?: string[];             // e.g. ['claudeJson:my-local-server']
  claudeJsonFields?: string[];            // e.g. ['email', 'machineId', 'lastSessionCwd']
}
```

`wasRedacted` only appears in the bundle when at least one of its sub-records is populated.

---

## The `strip-personal` profile (used by `cmemmov share`)

The `strip-personal` profile is declared in [`src/core/sanitization-rules.ts`](../src/core/sanitization-rules.ts). It produces a `team-baseline` bundle by applying these per-category decisions:

| Category | Decision | Effect |
| --- | --- | --- |
| Credentials | `strip` | Replaced with `{ content: null, wasRedacted: true }` if present. NFR6: invariant under any caller-supplied override. |
| Global memory | `partial` | Files matching `PERSONAL_FILENAME_PATTERNS` or carrying `personal: true` in YAML frontmatter are dropped; the rest are kept. |
| Project memory | `partial` | Same rules as global memory, applied per-project. |
| Global settings | `partial` | `permissions` rules that name an absolute path under `sourceHomedir` are removed. Other rules pass through. `settings.mcpServers` entries pointing at home-dir commands are removed. |
| Project settings | `partial` | `permissions` rules under `sourceHomedir` are removed. |
| `.claude.json` (`claudeJson`) | `partial` | Filtered against `CLAUDE_JSON_TEAM_ALLOWLIST`. Everything not on the allowlist is stripped. Inner `mcpServers` are processed for local-path stripping before the allowlist filter. |
| MCP config | `partial` | Servers whose `command` or `path` points under `sourceHomedir` are removed. Network endpoints (`http://`, `smb://`, `\\server`) pass through. |
| Session history | `strip` | Every project's `sessions` array is dropped unconditionally. |
| CLAUDE.md | `preserve` | Kept verbatim. |
| Custom commands | `preserve` | Kept verbatim. |
| Teams | `preserve` | Kept verbatim. |
| Plugins | `preserve` | Kept verbatim. |

The full profile table — including the `redact-credentials` profile used by regular `export --include-credentials` runs — is `SANITIZATION_PROFILES` in [`src/core/sanitization-rules.ts`](../src/core/sanitization-rules.ts).

### What the user sees on disk

A share bundle on disk:

- Has `profile: "team-baseline"` at the top level.
- Has `hasCredentials: false`.
- Has no `credentials` field.
- Has `projects[].sessions` absent on every entry.
- Has a `wasRedacted` record when anything was stripped (typical).

---

## `PERSONAL_FILENAME_PATTERNS`

The stock filename patterns the `strip-personal` profile excludes from memory directories. The canonical declaration lives at [`src/core/sanitization-rules.ts`](../src/core/sanitization-rules.ts) — exported as `PERSONAL_FILENAME_PATTERNS` and re-exported from [`src/commands/share-patterns.ts`](../src/commands/share-patterns.ts) via `defaultPersonalPatterns()` for the share command's pattern composition.

The current stock list (case-insensitive):

| Pattern | Matches |
| --- | --- |
| `/^personal/i` | `personal.md`, `personal_notes.md`, `Personal Stuff.md` |
| `/^private/i` | `private.md`, `private_keys.md` |
| `/^me_/i` | `me_todo.md`, `me_2026.md` |
| `/^todo/i` | `todo.md`, `todo-2026.md`, `TODO_LIST.md` |

A memory file is also dropped if its YAML frontmatter contains `personal: true`:

```markdown
---
personal: true
---

This file is excluded regardless of filename.
```

### Customizing the patterns

`cmemmov share` accepts two repeatable flags that mutate this list at call time:

- `--include-pattern <glob>` — adds a glob to the stock list. Globs are converted to regexes via [`globToPersonalPattern`](../src/commands/share-patterns.ts) (`*` → `.*`, anchored at start, case-insensitive). Example: `--include-pattern "scratch*"` excludes `scratch.md`, `scratchpad.md`, etc.
- `--exclude-pattern <glob>` — removes a glob from the stock list. The glob is compared against each stock regex's source; a stock pattern is dropped when an exclude regex's source starts with the stock source. Example: `--exclude-pattern "todo*"` removes the `/^todo/i` pattern from the stock list so `todo.md` is kept.

The composition logic is [`composePatterns`](../src/commands/share-patterns.ts).

---

## `CLAUDE_JSON_TEAM_ALLOWLIST`

The inverse of `PERSONAL_FILENAME_PATTERNS` — an explicit allowlist of `.claude.json` fields that are preserved in a share bundle. Everything not on this list is stripped. The canonical declaration is `CLAUDE_JSON_TEAM_ALLOWLIST` in [`src/core/sanitization-rules.ts`](../src/core/sanitization-rules.ts).

| Field | Why it's safe to share |
| --- | --- |
| `theme` | UI preference — no PII. |
| `editorMode` | UI preference — no PII. |
| `verbose` | UI preference — no PII. |
| `experiments` | Feature flags — useful for team alignment. |

Common denied fields (stripped on every share): `email`, `name`, `machineId`, `lastSessionCwd`, `currentProject`, `recentProjects`, `mcpServers`, `projects`, `githubRepoPaths`.

The stripped field names are recorded in `wasRedacted.claudeJsonFields`.

---

## Worked example — minimal bundle

A regular `cmemmov export --categories claudeMd --all-projects` against a single project with no global memory:

```json
{
  "version": "1.1.0",
  "exportedAt": "2026-05-14T12:34:56.000Z",
  "sourcePlatform": "linux",
  "sourceHomedir": "/home/alex",
  "claudeVersion": "1.5.0",
  "hasCredentials": false,
  "integrity": "9f2e...c1",
  "projects": [
    {
      "slug": "-home-alex-dev-myapp",
      "originalPath": "/home/alex/dev/myapp",
      "claudeMd": "# MyApp\n\nProject memory..."
    }
  ],
  "global": {}
}
```

Notes:

- `profile` is absent — this is not a share bundle.
- `credentials` is absent — `--include-credentials` was not passed.
- `wasRedacted` is absent — no stripping occurred.
- `projects[0].sessions` and `.memories` and `.settings` are absent — only `claudeMd` was selected.

---

## Worked example — full share bundle with redactions

A `cmemmov share --categories teams,customCommands,claudeMd,globalSettings,mcpConfig,plugins` run with personal memory files and home-dir permission rules in the source:

```json
{
  "version": "1.1.0",
  "exportedAt": "2026-05-14T13:00:00.000Z",
  "sourcePlatform": "darwin",
  "sourceHomedir": "/Users/alex",
  "claudeVersion": "1.5.0",
  "profile": "team-baseline",
  "hasCredentials": false,
  "integrity": "ab1d...4f",
  "wasRedacted": {
    "credentials": true,
    "personalMemoryFiles": [
      "global/personal_notes.md",
      "-Users-alex-dev-myapp/todo.md"
    ],
    "homeDirPermissionRules": [
      "Read(/Users/alex/secrets.txt)"
    ],
    "localMcpServers": [
      "claudeJson:my-local-py-server"
    ],
    "claudeJsonFields": [
      "email",
      "machineId",
      "lastSessionCwd",
      "recentProjects"
    ]
  },
  "projects": [
    {
      "slug": "-Users-alex-dev-myapp",
      "originalPath": "/Users/alex/dev/myapp",
      "claudeMd": "# MyApp\n..."
    }
  ],
  "global": {
    "settings": {
      "permissions": [
        "Read(https://api.example.com)"
      ]
    },
    "claudeMd": "# Global memory\n...",
    "customCommands": [
      { "filename": "deploy.md", "content": "..." }
    ],
    "teams": {
      "platform-team": { "members": ["alex", "maya"] }
    },
    "plugins": {
      "prettier-mcp": { "enabled": true }
    },
    "claudeJson": {
      "theme": "dark",
      "editorMode": "vim"
    }
  }
}
```

Notes on the redactions above:

- `wasRedacted.credentials = true` because a credentials file existed in the source — the share command nulled the content as defense-in-depth (NFR6).
- `wasRedacted.personalMemoryFiles` is scope-prefixed: `global/` for `~/.claude/memory/` files, `<slug>/` for per-project memories.
- `wasRedacted.homeDirPermissionRules` contains the full rule string, including the function form (`Read(...)`), and is scope-prefixed when stripping from a project's settings.
- `wasRedacted.localMcpServers` is scope-prefixed: `claudeJson:<name>` when the server lived under `~/.claude.json::mcpServers`; bare `<name>` when it lived in `settings.mcpServers` or the standalone `mcpConfig`.
- `wasRedacted.claudeJsonFields` lists every `.claude.json` key that was dropped because it wasn't on `CLAUDE_JSON_TEAM_ALLOWLIST`.

---

## References

- Schema source: [`src/core/bundle-schema.ts`](../src/core/bundle-schema.ts)
- Profile + strip logic: [`src/core/sanitization-rules.ts`](../src/core/sanitization-rules.ts)
- Share command and pattern composition: [`src/commands/share.ts`](../src/commands/share.ts), [`src/commands/share-patterns.ts`](../src/commands/share-patterns.ts)
- Bundle serializer/parser (integrity, gzip detection): [`src/services/bundle-serializer.ts`](../src/services/bundle-serializer.ts), [`src/services/bundle-parser.ts`](../src/services/bundle-parser.ts)
- High-level overview of the share workflow: [`../README.md`](../README.md#share--export-a-sanitized-team-bundle)
