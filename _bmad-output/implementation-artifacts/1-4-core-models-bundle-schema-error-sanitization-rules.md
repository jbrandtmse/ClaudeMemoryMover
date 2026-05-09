# Story 1.4: Core Models — Bundle Schema, Error, Sanitization Rules

Status: review

## Story

As a developer working on cmemmov,
I want pure-module definitions for the bundle schema (Zod), the single error type (`CmemmovError`), and the redact-credentials sanitization profile,
so that the parsing boundary, error model, and security profile are defined once and consumed consistently by every command and service.

## Acceptance Criteria

1. `core/bundle-schema.ts` exports a Zod schema (`BundleSchema`) that validates a valid fixture bundle without error. All TypeScript types are derived via `z.infer<typeof BundleSchema>` — no manually-typed parallel interfaces.

2. `BundleSchema` uses `.strict()` mode so that parsing a bundle with a missing required field, a field of the wrong type, or an extra unrecognized field throws a `ZodError` whose `.issues` reference the failing field path.

3. `core/error.ts` exports:
   - `ErrorCode` union type containing exactly these 12 codes: `BUNDLE_INVALID_SCHEMA`, `BUNDLE_CHECKSUM_MISMATCH`, `BUNDLE_VERSION_MISMATCH`, `PATH_REMAP_AMBIGUOUS`, `PATH_NOT_FOUND`, `BACKUP_FAILED`, `ROLLBACK_NOT_AVAILABLE`, `IMPORT_PARTIAL`, `EXPORT_NOTHING_SELECTED`, `SHARE_INVALID_SOURCE`, `FIXPATHS_NO_PROJECTS`, `INTERNAL`
   - `CmemmovError` class extending `Error` with readonly fields `code`, `file?`, `operation?`, `hint?`, `cause?`, and a derived `exitCode: 1 | 2` per the exit code mapping table in Dev Notes

4. `new CmemmovError({ code: 'BACKUP_FAILED', file: '/path', operation: 'backup', hint: 'check write permissions', cause: originalError })` produces an instance where all fields are accessible as readonly properties and `exitCode === 2`.

5. `core/sanitization-rules.ts` exports an `applySanitization(bundle: Bundle, profile: 'redact-credentials'): Bundle` function. When applied to a bundle whose `credentials` field is present, it removes the credential content and sets `credentials.wasRedacted = true`. All other bundle fields pass through unchanged.

6. `core/sanitization-rules.ts` does NOT define a `strip-personal` profile — that is deferred to Story 4.1. The type of the `profile` parameter is the literal `'redact-credentials'` only (not a union).

7. No `core/*.ts` file imports from `node:fs`, `node:os`, or `node:process`. The only Node built-in allowed in `core/` is `node:path` (and it is not needed by these three modules — they use only Zod and native JavaScript).

## Tasks / Subtasks

- [x] Task 1: Create `src/core/bundle-schema.ts` (ACs: 1, 2, 7)
  - [x] Define Zod sub-schemas: `MemoryFileSchema`, `SessionFileSchema`, `ProjectSchema`, `GlobalSchema`
  - [x] Define top-level `BundleSchema` using `.strict()` — see Dev Notes for the full shape
  - [x] Export `BundleSchema` and derived type `Bundle = z.infer<typeof BundleSchema>`
  - [x] Export `ProjectSchema` and derived type `Project = z.infer<typeof ProjectSchema>` (needed by services)
  - [x] Export `BUNDLE_FORMAT_VERSION = '1.0.0'` constant (used by parser and serializer in Story 1.6)
  - [x] Verify: zero `import` from `node:*` — only `import { z } from 'zod'`
  - [x] ESM `.js` extension: `import { z } from 'zod'` (no extension needed for npm packages)

- [x] Task 2: Create `src/core/bundle-schema.test.ts` (ACs: 1, 2)
  - [x] Test: `BundleSchema.parse(validFixture)` succeeds and result matches fixture shape
  - [x] Test: missing required field throws `ZodError` with `.issues[0].path` referencing the missing field
  - [x] Test: wrong type throws `ZodError`
  - [x] Test: extra unrecognized field throws `ZodError` (strict mode enforcement)
  - [x] Load fixtures from `tests/fixtures/bundles/` — see Dev Notes for fixture file content

- [x] Task 3: Create `src/core/error.ts` (ACs: 3, 4, 7)
  - [x] Export `ErrorCode` type — exactly 12 codes, see Dev Notes
  - [x] Export `CmemmovError` class — see Dev Notes for constructor and `exitCode` mapping
  - [x] Verify: `instanceof CmemmovError` works, `instanceof Error` works
  - [x] Verify: `exitCode` is derived in the constructor, not passed in (caller specifies `code`, mapping determines `exitCode`)

- [x] Task 4: Create `src/core/error.test.ts` (AC: 3, 4)
  - [x] Test each constructor option (code, file, operation, hint, cause)
  - [x] Test exitCode mapping: at least one code from the exitCode-1 set and two from the exitCode-2 set
  - [x] Test: `instance instanceof CmemmovError` and `instance instanceof Error` both true
  - [x] Test: `instance.message` is set meaningfully (e.g., contains the error code)

- [x] Task 5: Create `src/core/sanitization-rules.ts` (ACs: 5, 6, 7)
  - [x] Import `Bundle` type from `./bundle-schema.js` — ESM `.js` extension required
  - [x] Export `applySanitization(bundle: Bundle, profile: 'redact-credentials'): Bundle`
  - [x] When `bundle.credentials` is defined: return a shallow copy with `credentials: { wasRedacted: true }` (content removed)
  - [x] When `bundle.credentials` is undefined: return the bundle unchanged
  - [x] Do NOT define `strip-personal` profile or a broader union type for `profile`

- [x] Task 6: Create `src/core/sanitization-rules.test.ts` (ACs: 5, 6)
  - [x] Test: bundle with credentials → after sanitization, content absent, `wasRedacted === true`
  - [x] Test: bundle without credentials → returned bundle is structurally identical
  - [x] Test: other bundle fields (projects, global, etc.) are unchanged after sanitization

- [x] Task 7: Create fixture JSON files (supports ACs: 1, 2)
  - [x] `tests/fixtures/bundles/valid-minimal.json` — minimal valid bundle (see Dev Notes for content)
  - [x] `tests/fixtures/bundles/invalid-missing-field.json` — bundle missing `version` field
  - [x] `tests/fixtures/bundles/invalid-wrong-type.json` — bundle where `hasCredentials` is a string instead of boolean
  - [x] `tests/fixtures/bundles/invalid-extra-field.json` — bundle with all valid fields plus one extra field
  - [x] `tests/fixtures/bundles/with-credentials.json` — valid bundle with `credentials` field populated

- [x] Task 8: Final validation (AC: 7)
  - [x] `npm run check` exits 0
  - [x] Grep `node:fs|node:os|node:process` in `src/core/bundle-schema.ts`, `src/core/error.ts`, `src/core/sanitization-rules.ts` — zero matches

## Dev Notes

### Bundle schema shape

The bundle is the primary data interchange format for `cmemmov`. Version `'1.0.0'` of the format:

```typescript
import { z } from 'zod';

export const BUNDLE_FORMAT_VERSION = '1.0.0';

const MemoryFileSchema = z.object({
  filename: z.string(),  // e.g. "MEMORY.md" or "topic-file.md"
  content: z.string(),
}).strict();

const SessionFileSchema = z.object({
  filename: z.string(),  // UUID.jsonl
  lines: z.array(z.string()),  // raw JSONL lines
}).strict();

const ProjectSchema = z.object({
  slug: z.string(),           // e.g. "C--git-ClaudeMemoryMover" or "-home-user-myapp"
  originalPath: z.string(),   // absolute path on source machine (FR27)
  settings: z.unknown().optional(),    // settings.json content, if exported
  memories: z.array(MemoryFileSchema).optional(),
  sessions: z.array(SessionFileSchema).optional(),
}).strict();

const GlobalSchema = z.object({
  settings: z.unknown().optional(),    // ~/.claude/settings.json content
  claudeJson: z.unknown().optional(),  // ~/.claude.json content (adjacent to ~/.claude/)
  memories: z.array(MemoryFileSchema).optional(),
}).strict();

const CredentialsSchema = z.object({
  content: z.unknown(),          // .credentials.json content, or null if redacted
  wasRedacted: z.boolean(),      // true when redact-credentials sanitization was applied
}).strict();

export const BundleSchema = z.object({
  version: z.string(),           // bundle format version, e.g. "1.0.0"
  exportedAt: z.string().datetime(),  // ISO 8601 — z.string().datetime() validates format
  sourcePlatform: z.enum(['win32', 'darwin', 'linux']),
  claudeVersion: z.string(),     // Claude Code version fingerprint (FR28) e.g. "2.1.133"
  hasCredentials: z.boolean(),   // true when credentials section is present and unredacted
  integrity: z.string().optional(),  // SHA256 hex string — absent in Story 1.4 (added in 1.6)
  projects: z.array(ProjectSchema),
  global: GlobalSchema,
  credentials: CredentialsSchema.optional(),
}).strict();

export type Bundle = z.infer<typeof BundleSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type Global = z.infer<typeof GlobalSchema>;
```

**Why `.strict()` everywhere?** The AC requires extra unrecognized fields to throw. Zod's default strips unknowns; `.strict()` throws `ZodError` instead. Every sub-schema also uses `.strict()` for consistency. **Note:** this means future bundle format additions will require adding the new field to the schema first. The bundle parser in Story 1.6 handles the `BUNDLE_VERSION_MISMATCH` warning path.

[Source: architecture.md — §"Bundle JSON Conventions"; epics.md — Story 1.4 ACs]

### Error module

```typescript
export type ErrorCode =
  | 'BUNDLE_INVALID_SCHEMA'
  | 'BUNDLE_CHECKSUM_MISMATCH'
  | 'BUNDLE_VERSION_MISMATCH'
  | 'PATH_REMAP_AMBIGUOUS'
  | 'PATH_NOT_FOUND'
  | 'BACKUP_FAILED'
  | 'ROLLBACK_NOT_AVAILABLE'
  | 'IMPORT_PARTIAL'
  | 'EXPORT_NOTHING_SELECTED'
  | 'SHARE_INVALID_SOURCE'
  | 'FIXPATHS_NO_PROJECTS'
  | 'INTERNAL';

// Exit code 1 = partial success (something happened, but not fully)
// Exit code 2 = fatal (nothing written; cannot proceed)
const EXIT_CODE_MAP: Record<ErrorCode, 1 | 2> = {
  BUNDLE_INVALID_SCHEMA: 2,
  BUNDLE_CHECKSUM_MISMATCH: 2,
  BUNDLE_VERSION_MISMATCH: 2,
  PATH_REMAP_AMBIGUOUS: 2,
  PATH_NOT_FOUND: 2,
  BACKUP_FAILED: 2,
  ROLLBACK_NOT_AVAILABLE: 2,
  IMPORT_PARTIAL: 1,
  EXPORT_NOTHING_SELECTED: 1,
  SHARE_INVALID_SOURCE: 2,
  FIXPATHS_NO_PROJECTS: 1,
  INTERNAL: 2,
};

export interface CmemmovErrorOptions {
  code: ErrorCode;
  file?: string;
  operation?: string;
  hint?: string;
  cause?: unknown;
}

export class CmemmovError extends Error {
  readonly code: ErrorCode;
  readonly file?: string;
  readonly operation?: string;
  readonly hint?: string;
  readonly exitCode: 1 | 2;
  override readonly cause?: unknown;

  constructor(options: CmemmovErrorOptions) {
    super(`[${options.code}]${options.operation ? ` during ${options.operation}` : ''}${options.file ? ` on ${options.file}` : ''}${options.hint ? ` — ${options.hint}` : ''}`);
    this.name = 'CmemmovError';
    this.code = options.code;
    this.file = options.file;
    this.operation = options.operation;
    this.hint = options.hint;
    this.cause = options.cause;
    this.exitCode = EXIT_CODE_MAP[options.code];
  }
}
```

**Exit code rationale:**
- `exitCode: 1` (partial success) — operation ran but output is incomplete: `IMPORT_PARTIAL`, `EXPORT_NOTHING_SELECTED`, `FIXPATHS_NO_PROJECTS`
- `exitCode: 2` (fatal) — operation could not complete, nothing was written: all other 9 codes

**`override readonly cause`:** The ES2022 `Error` base class already has a `cause` property; using `override` satisfies the strict TypeScript ruleset. Without `override`, `@typescript-eslint/class-literal-property-style` or similar rules may warn.

[Source: architecture.md — §"Error & Output Architecture", §"Exit code taxonomy"; epics.md — Story 1.4 ACs]

### Sanitization rules

```typescript
import type { Bundle } from './bundle-schema.js';

// Strip credential content; mark wasRedacted for audit trail.
// strip-personal is deferred to Story 4.1.
export function applySanitization(bundle: Bundle, profile: 'redact-credentials'): Bundle {
  if (profile === 'redact-credentials') {
    if (!bundle.credentials) return bundle;
    return {
      ...bundle,
      credentials: { content: null, wasRedacted: true },
    };
  }
  // TypeScript exhaustiveness: profile is 'redact-credentials' only, this is unreachable.
  const _exhaustive: never = profile;
  return _exhaustive;
}
```

**Why `content: null` instead of omitting `content`?** The `CredentialsSchema` marks `content` as `z.unknown()` (required). Setting it to `null` satisfies the schema while clearly signalling redaction. The `wasRedacted: true` flag is the auditable marker.

[Source: architecture.md — §"Sanitization profiles"; epics.md — Story 1.4 ACs]

### Fixture files

**`tests/fixtures/bundles/valid-minimal.json`:**
```json
{
  "version": "1.0.0",
  "exportedAt": "2026-05-09T12:00:00.000Z",
  "sourcePlatform": "linux",
  "claudeVersion": "2.1.133",
  "hasCredentials": false,
  "projects": [
    {
      "slug": "-home-user-myapp",
      "originalPath": "/home/user/myapp",
      "memories": [
        { "filename": "MEMORY.md", "content": "# Memory Index\n" }
      ]
    }
  ],
  "global": {
    "settings": { "model": "sonnet" }
  }
}
```

**`tests/fixtures/bundles/invalid-missing-field.json`** — omit `version`:
```json
{
  "exportedAt": "2026-05-09T12:00:00.000Z",
  "sourcePlatform": "linux",
  "claudeVersion": "2.1.133",
  "hasCredentials": false,
  "projects": [],
  "global": {}
}
```

**`tests/fixtures/bundles/invalid-wrong-type.json`** — `hasCredentials` is a string:
```json
{
  "version": "1.0.0",
  "exportedAt": "2026-05-09T12:00:00.000Z",
  "sourcePlatform": "linux",
  "claudeVersion": "2.1.133",
  "hasCredentials": "no",
  "projects": [],
  "global": {}
}
```

**`tests/fixtures/bundles/invalid-extra-field.json`** — extra `unknownField`:
```json
{
  "version": "1.0.0",
  "exportedAt": "2026-05-09T12:00:00.000Z",
  "sourcePlatform": "linux",
  "claudeVersion": "2.1.133",
  "hasCredentials": false,
  "projects": [],
  "global": {},
  "unknownField": true
}
```

**`tests/fixtures/bundles/with-credentials.json`** — bundle with credentials:
```json
{
  "version": "1.0.0",
  "exportedAt": "2026-05-09T12:00:00.000Z",
  "sourcePlatform": "linux",
  "claudeVersion": "2.1.133",
  "hasCredentials": true,
  "projects": [],
  "global": {},
  "credentials": {
    "content": { "oauthToken": "secret-token-value" },
    "wasRedacted": false
  }
}
```

### `no-raw-json-parse` rule interaction

The `no-raw-json-parse` rule fires on `JSON.parse()` calls outside `src/services/bundle-parser.ts`. Story 1.4 test files use `JSON.parse` only if reading fixture files via `fs.readFileSync` + `JSON.parse`. To avoid the rule firing in test files (which live in `src/core/*.test.ts` and match `src/**/*.ts`):

**Preferred approach**: Use `import` with JSON import attribute (same as Story 1.3 used for `slug-edge-cases.json`):
```typescript
import validFixture from '../../tests/fixtures/bundles/valid-minimal.json' with { type: 'json' };
```

This requires `resolveJsonModule: true` in `tsconfig.json` — already added in Story 1.3. No changes to `tsconfig.json` needed.

**Do NOT** use `fs.readFileSync` + `JSON.parse` in test files — the ESLint rule will block it.

### ESM import discipline

All intra-`src/` imports must use `.js` extension:
```typescript
import type { Bundle } from './bundle-schema.js';   // CORRECT
import type { Bundle } from './bundle-schema';        // WRONG — breaks at runtime
```

npm package imports (`zod`) do not need extensions.

[Source: architecture.md — §"Module Imports"]

### What exists in `src/core/` at start of Story 1.4

After Story 1.3:
- `src/core/path-engine.ts` ✓
- `src/core/path-engine.test.ts` ✓
- `src/core/path-engine.types.ts` ✓

Story 1.4 adds:
- `src/core/bundle-schema.ts` (NEW)
- `src/core/bundle-schema.test.ts` (NEW)
- `src/core/error.ts` (NEW)
- `src/core/error.test.ts` (NEW)
- `src/core/sanitization-rules.ts` (NEW)
- `src/core/sanitization-rules.test.ts` (NEW)
- `tests/fixtures/bundles/` (NEW — 5 files)

**No existing files need modification** (except if fixture imports trigger a test, `tsconfig.json` already has `resolveJsonModule: true` from Story 1.3 — do not re-add it).

### Deferred / not in scope

- `strip-personal` sanitization profile — Story 4.1
- `CredentialsSchema` `content` type narrowing beyond `z.unknown()` — Story 4.1
- Per-file 100% coverage thresholds for these modules — not required by ACs; 80% project-wide minimum applies
- Any bundle parsing (JSON.parse, Zod validation invocation) — Story 1.6 (`bundle-parser.ts`)

### Project Structure Notes

Files being created (NEW):
- `src/core/bundle-schema.ts`
- `src/core/bundle-schema.test.ts`
- `src/core/error.ts`
- `src/core/error.test.ts`
- `src/core/sanitization-rules.ts`
- `src/core/sanitization-rules.test.ts`
- `tests/fixtures/bundles/valid-minimal.json`
- `tests/fixtures/bundles/invalid-missing-field.json`
- `tests/fixtures/bundles/invalid-wrong-type.json`
- `tests/fixtures/bundles/invalid-extra-field.json`
- `tests/fixtures/bundles/with-credentials.json`

Files being modified (UPDATE):
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — update story 1-4 status

No other existing files need modification.

### References

- [Source: epics.md — Story 1.4 Acceptance Criteria, lines 395–430]
- [Source: architecture.md — §"Key Module Specs" (`core/error.ts`), lines 704–722]
- [Source: architecture.md — §"Bundle Architecture", lines 245–267]
- [Source: architecture.md — §"Bundle JSON Conventions", lines 417–424]
- [Source: architecture.md — §"Error & Output Architecture", lines 269–291]
- [Source: architecture.md — §"Sanitization profiles", line 96]
- [Source: architecture.md — §"Module Organization Principles" (pure modules), lines 460–465]
- [Source: research/technical-claude-code-migration-research-2026-05-08.md — §1.3, §1.4, §1.5, §1.6]
- [Source: Story 1.3 — `resolveJsonModule: true` already in tsconfig.json]
- [Source: Story 1.2 — `no-raw-json-parse` fires in `src/**/*.ts` outside bundle-parser.ts]

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

- Initial `npm run check` failed with `@typescript-eslint/no-unnecessary-condition` on the `if (profile === 'redact-credentials')` and a subsequent `switch (profile)` in `sanitization-rules.ts` — the lint rule correctly flags branching on a single-literal type. Resolved by replacing the branch with `void profile;` followed by an unconditional redaction body. The `profile` parameter is preserved by name and type per AC 5.
- Adapted `CmemmovError` constructor to satisfy `exactOptionalPropertyTypes: true`: optional fields (`file`, `operation`, `hint`) are conditionally assigned only when defined, and `cause` is forwarded into the `Error` base class via the standard ES2022 `{ cause }` options object instead of a manual `override readonly cause` field. The base `Error.cause` is still accessible on the instance (verified by tests) and the explicit `override` field shown in the spec snippet was unnecessary in this configuration.

### Completion Notes List

- All 8 tasks complete; all 7 acceptance criteria satisfied.
- Bundle schema, error type, and sanitization rule are pure (no `node:fs|os|process` imports — verified by grep and confirmed by `cmemmov/no-process-env-home` lint rule).
- 34 new tests added (9 bundle-schema + 20 error + 5 sanitization). Full project suite: 70 tests passing across 9 files.
- `npm run check` (lint + typecheck + tests) exits 0.
- All 5 bundle JSON fixture files created in `tests/fixtures/bundles/`.

### File List

**New files:**

- `src/core/bundle-schema.ts`
- `src/core/bundle-schema.test.ts`
- `src/core/error.ts`
- `src/core/error.test.ts`
- `src/core/sanitization-rules.ts`
- `src/core/sanitization-rules.test.ts`
- `tests/fixtures/bundles/valid-minimal.json`
- `tests/fixtures/bundles/invalid-missing-field.json`
- `tests/fixtures/bundles/invalid-wrong-type.json`
- `tests/fixtures/bundles/invalid-extra-field.json`
- `tests/fixtures/bundles/with-credentials.json`

**Modified files:**

- `_bmad-output/implementation-artifacts/sprint-status.yaml` (story 1-4 status: ready-for-dev → in-progress → review)
- `_bmad-output/implementation-artifacts/1-4-core-models-bundle-schema-error-sanitization-rules.md` (this file)

## Change Log

| Date       | Author  | Change                                                                                                                                                                                          |
|------------|---------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 2026-05-09 | dev-1-4 | Story 1.4 implemented — bundle schema (Zod, strict), `CmemmovError` (12 codes, exit code mapping), redact-credentials sanitization, plus tests and fixtures. All ACs met; `npm run check` green. |
