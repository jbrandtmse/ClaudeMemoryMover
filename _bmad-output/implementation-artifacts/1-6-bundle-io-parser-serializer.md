# Story 1.6: Bundle I/O — Parser & Serializer

Status: review

## Story

As a developer working on cmemmov,
I want a `bundle-parser` (bytes → validated `Bundle`) and `bundle-serializer` (`Bundle` → bytes) that handle Zod validation, SHA256 integrity, format-version handshake, and auto-gzip uniformly,
so that every command reads and writes bundles through a single trusted boundary and corrupt or malformed input is caught at the edge.

## Acceptance Criteria

1. `parseBundle(bytes, opts?)` pipeline runs in order: gzip detection → gunzip if needed → `JSON.parse` → Zod validation → SHA256 integrity check → format-version handshake. Returns a typed `Bundle`.

2. Gzip detection uses byte inspection (`bytes[0] === 0x1f && bytes[1] === 0x8b`), not file extension.

3. When the embedded `integrity` checksum does not match the computed SHA256 of the canonical payload: throws `CmemmovError({ code: 'BUNDLE_CHECKSUM_MISMATCH', exitCode: 2 })` with a hint. When `opts.noIntegrityCheck === true`: emits a warning via the injected `warn` callback instead of throwing, and parsing continues.

4. When `bundle.version !== BUNDLE_FORMAT_VERSION`: emits a warning via the injected `warn` callback and parsing continues (never blocked).

5. `serializeBundle(bundle)` produces plain JSON bytes (indented, human-readable) when `bundle.sessions` is empty/absent AND the total serialized size is <5MB. Produces gzipped bytes otherwise.

6. `serializeBundle` computes SHA256 over the canonical payload (the bundle's compact `JSON.stringify` without the `integrity` field) and embeds it as `bundle.integrity` in the output.

7. `parseBundle(serializeBundle(bundle))` round-trips to a deep-equal `Bundle`.

8. `vitest.config.ts` is updated to enforce **100% line coverage** on `src/services/bundle-parser.ts`. Running `npm run test -- --coverage` with any uncovered line fails.

9. `no-raw-json-parse` ESLint rule (from Story 1.2) already bans `JSON.parse` outside `bundle-parser.ts` — this AC is passively satisfied as long as bundle-parser.ts is the only file calling `JSON.parse`.

## Tasks / Subtasks

- [x] Task 1: Create `src/services/bundle-parser.ts` (ACs: 1, 2, 3, 4)
  - [x] Export `interface ParseBundleOpts { noIntegrityCheck?: boolean; warn?: (msg: string) => void }`
  - [x] Export `function parseBundle(bytes: Buffer, opts?: ParseBundleOpts): Bundle`
  - [x] Gzip detection: `bytes[0] === 0x1f && bytes[1] === 0x8b` → `gunzipSync(bytes)`
  - [x] `JSON.parse` the UTF-8 string (only call to `JSON.parse` in all of `src/`) → catches `SyntaxError` → rethrows as `CmemmovError({ code: 'BUNDLE_INVALID_SCHEMA', hint: 'bundle JSON is malformed' })`
  - [x] Zod `BundleSchema.parse()` → catches `ZodError` → rethrows as `CmemmovError({ code: 'BUNDLE_INVALID_SCHEMA' })`
  - [x] Integrity check: compute canonical → compare → throw or warn per `noIntegrityCheck`
  - [x] Version check: compare `bundle.version` to `BUNDLE_FORMAT_VERSION` → warn if different
  - [x] Inject `warn` callback (default no-op); do NOT import `ui/output.ts` (forbidden cross-layer)

- [x] Task 2: Create `src/services/bundle-parser.test.ts` (ACs: 1–4, 8)
  - [x] Load pre-built fixture files from `tests/fixtures/bundles/`
  - [x] Test each pipeline step in isolation (gzip detection, JSON error, Zod error, checksum mismatch, version mismatch)
  - [x] Verify 100% line coverage before updating vitest.config.ts

- [x] Task 3: Create `src/services/bundle-serializer.ts` (ACs: 5, 6, 7)
  - [x] Export `function serializeBundle(bundle: Bundle): Buffer`
  - [x] Compute canonical: `JSON.stringify(bundleWithoutIntegrity)` (compact, no spacing)
  - [x] Compute checksum: `createHash('sha256').update(canonical, 'utf8').digest('hex')`
  - [x] Produce final bundle object with `integrity` set
  - [x] Serialize to `JSON.stringify(finalBundle, null, 2)` (indented human-readable)
  - [x] If sessions present OR size ≥5MB: `gzipSync(Buffer.from(json, 'utf8'))`
  - [x] Return `Buffer`

- [x] Task 4: Create `src/services/bundle-serializer.test.ts` (ACs: 5, 6, 7)
  - [x] Test plain-JSON output for small no-session bundle
  - [x] Test gzipped output for bundle with sessions (check first two bytes for magic)
  - [x] Test gzipped output for bundle ≥5MB
  - [x] Test round-trip: `parseBundle(serializeBundle(bundle))` deep-equals input bundle

- [x] Task 5: Create fixture bundle files (supports ACs: 1–4)
  - [x] `tests/fixtures/bundles/valid-linux.cmemmov` — plain JSON with valid integrity checksum
  - [x] `tests/fixtures/bundles/valid-windows.cmemmov` — win32 platform bundle with valid checksum
  - [x] `tests/fixtures/bundles/corrupted-checksum.cmemmov` — valid JSON but `integrity` field is wrong
  - [x] `tests/fixtures/bundles/older-bundle-version.cmemmov` — valid JSON with `version: '0.9.0'`
  - [x] **Generate these using a small Node.js script or inline within the test setup** — see Dev Notes for the exact canonical fixture content

- [x] Task 6: Update `vitest.config.ts` to add 100% line threshold for bundle-parser.ts (AC: 8)
  - [x] READ current vitest.config.ts (already has `src/core/path-engine.ts` threshold)
  - [x] Add `'src/services/bundle-parser.ts': { lines: 100 }` entry
  - [x] Run `npm run test -- --coverage` to confirm threshold passes

- [x] Task 7: Final validation
  - [x] `npm run check` exits 0
  - [x] Verify `JSON.parse` grep: only appears in `src/services/bundle-parser.ts`

## Dev Notes

### Parse pipeline

```typescript
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { BundleSchema, BUNDLE_FORMAT_VERSION, type Bundle } from '../core/bundle-schema.js';
import { CmemmovError } from '../core/error.js';
import { ZodError } from 'zod';

export interface ParseBundleOpts {
  noIntegrityCheck?: boolean;
  warn?: (msg: string) => void;
}

export function parseBundle(bytes: Buffer, opts?: ParseBundleOpts): Bundle {
  const warn = opts?.warn ?? (() => undefined);

  // Step 1: Gzip detection and decompression
  const buf = (bytes[0] === 0x1f && bytes[1] === 0x8b) ? gunzipSync(bytes) : bytes;

  // Step 2: JSON.parse — the ONLY JSON.parse call allowed in src/ (no-raw-json-parse rule)
  let raw: unknown;
  try {
    raw = JSON.parse(buf.toString('utf8'));
  } catch (cause) {
    throw new CmemmovError({ code: 'BUNDLE_INVALID_SCHEMA', hint: 'bundle JSON is malformed', cause });
  }

  // Step 3: Zod validation
  let bundle: Bundle;
  try {
    bundle = BundleSchema.parse(raw);
  } catch (cause) {
    if (cause instanceof ZodError) {
      throw new CmemmovError({
        code: 'BUNDLE_INVALID_SCHEMA',
        hint: `schema validation failed: ${cause.issues[0]?.message ?? 'unknown'}`,
        cause,
      });
    }
    throw cause;
  }

  // Step 4: Integrity check
  if (bundle.integrity !== undefined) {
    const canonical = computeCanonical(bundle);
    const computed = createHash('sha256').update(canonical, 'utf8').digest('hex');
    if (computed !== bundle.integrity) {
      if (opts?.noIntegrityCheck) {
        warn('Bundle checksum mismatch — proceeding because --no-integrity-check was specified.');
      } else {
        throw new CmemmovError({
          code: 'BUNDLE_CHECKSUM_MISMATCH',
          hint: 'Bundle may be corrupted. Use --no-integrity-check to skip.',
        });
      }
    }
  }

  // Step 5: Format version handshake
  if (bundle.version !== BUNDLE_FORMAT_VERSION) {
    warn(`Bundle format version '${bundle.version}' differs from expected '${BUNDLE_FORMAT_VERSION}'.`);
  }

  return bundle;
}

// Canonical form: compact JSON without the integrity field
function computeCanonical(bundle: Bundle): string {
  const { integrity: _omit, ...rest } = bundle;
  return JSON.stringify(rest);
}
```

[Source: epics.md — Story 1.6 ACs; architecture.md — §"Bundle Architecture"]

### Serialize pipeline

```typescript
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import type { Bundle } from '../core/bundle-schema.js';

const FIVE_MB = 5 * 1024 * 1024;

export function serializeBundle(bundle: Bundle): Buffer {
  const hasSessions = bundle.projects.some(p => (p.sessions?.length ?? 0) > 0);

  // Canonical form (compact, no integrity field) for checksum
  const { integrity: _omit, ...bundleWithoutIntegrity } = bundle;
  const canonical = JSON.stringify(bundleWithoutIntegrity);
  const checksum = createHash('sha256').update(canonical, 'utf8').digest('hex');

  const finalBundle: Bundle = { ...bundle, integrity: checksum };
  const json = JSON.stringify(finalBundle, null, 2);
  const jsonBytes = Buffer.from(json, 'utf8');

  if (hasSessions || jsonBytes.length >= FIVE_MB) {
    return gzipSync(jsonBytes);
  }
  return jsonBytes;
}
```

**Canonical consistency note:** Both `parseBundle` and `serializeBundle` compute the canonical form as `JSON.stringify(bundleWithoutIntegrity)` (compact, no spacing, no integrity field). The key ordering in this string is determined by V8's property iteration order on the Zod-validated object — which follows schema-definition order. This is consistent as long as both sides go through Zod parsing. The fixture generation script below establishes real checksums by running the serializer.

### Canonical form and Zod key order

Zod `parse()` returns an object with keys in the order they appear in the schema definition (V8/Node.js guarantee: string properties are iterated in insertion order). `BundleSchema` defines keys in this order: `version`, `exportedAt`, `sourcePlatform`, `claudeVersion`, `hasCredentials`, `integrity`, `projects`, `global`, `credentials`. After removing `integrity`, the canonical form always has: `version`, `exportedAt`, `sourcePlatform`, `claudeVersion`, `hasCredentials`, `projects`, `global`, (optionally `credentials`).

### Fixture generation

Instead of hand-coding checksums, generate fixture files using a small inline script or `beforeAll` in the test. Recommended approach: use the `serializeBundle` function itself to generate the `valid-*.cmemmov` fixtures in a test helper, then write them as static files for reproducibility.

For the **corrupted-checksum fixture**: take a valid bundle JSON, parse it to get the Zod-validated object, then stringify it with `integrity: 'deadbeef...'` (wrong value).

For the **older-bundle-version fixture**: same as valid, but set `version: '0.9.0'` (outside `BUNDLE_FORMAT_VERSION`). The checksum must still be valid for this fixture (so it tests the version-mismatch warning without triggering checksum-mismatch).

Concrete approach — in `bundle-parser.test.ts`, use a `beforeAll` that calls `serializeBundle` to build the `valid-linux.cmemmov` and `valid-windows.cmemmov` bytes in-memory, then load static `.cmemmov` files only for the error-case fixtures (corrupted and older-version), which can be crafted as literal JSON strings in test helpers.

### `gzipSync` flag: `no-raw-json-parse` interaction

`bundle-serializer.ts` calls `JSON.stringify` (not `JSON.parse`) — the rule only bans `JSON.parse`. Serializer is not restricted.

`bundle-parser.ts` IS `src/services/bundle-parser.ts` — the `no-raw-json-parse` rule uses a path-suffix check (`!filename.endsWith('src/services/bundle-parser.ts')`). This file is the sole permitted caller. Verified by the Story 1.2 rule implementation.

### Output cross-layer: why `warn` callback

`bundle-parser.ts` is in `services/`. `Output` is in `ui/`. The architecture forbids `services → ui` imports. The `warn` callback is injected by the caller (command layer or CLI shell) so the service stays pure. Default is `() => undefined` (no-op). Tests pass a `vi.fn()` to assert warning calls.

[Source: architecture.md — §"Architectural Boundaries"]

### vitest.config.ts current state (after Story 1.3)

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      thresholds: {
        'src/core/path-engine.ts': {
          lines: 100,
          branches: 100,
        },
      },
    },
  },
});
```

Add `'src/services/bundle-parser.ts': { lines: 100 }` inside `thresholds`. No branches 100% requirement — only lines (as architecture spec states "100% line coverage on the bundle schema parser").

### `no-restricted-imports` rule interaction

`bundle-parser.ts` imports from `node:zlib` and `node:crypto`. These are NOT in the banned list (only `writeFile`/`rename`/`unlink`/`copyFile`/`rmdir`/`rm` are banned). No conflict.

### What exists in `src/services/` at start of Story 1.6

After Story 1.5:
- `src/services/write-gate.ts` ✓
- `src/services/write-gate.test.ts` ✓
- `src/services/backup-service.ts` ✓
- `src/services/backup-service.test.ts` ✓

Story 1.6 adds:
- `src/services/bundle-parser.ts` (NEW)
- `src/services/bundle-parser.test.ts` (NEW)
- `src/services/bundle-serializer.ts` (NEW)
- `src/services/bundle-serializer.test.ts` (NEW)
- `tests/fixtures/bundles/*.cmemmov` — several new fixture files

**Existing `tests/fixtures/bundles/` files from Story 1.4** (valid-minimal.json, invalid-*.json, with-credentials.json) — do NOT modify these. Add new `.cmemmov` files alongside them.

### Project Structure Notes

Files being created (NEW):
- `src/services/bundle-parser.ts`
- `src/services/bundle-parser.test.ts`
- `src/services/bundle-serializer.ts`
- `src/services/bundle-serializer.test.ts`
- `tests/fixtures/bundles/valid-linux.cmemmov`
- `tests/fixtures/bundles/valid-windows.cmemmov`
- `tests/fixtures/bundles/corrupted-checksum.cmemmov`
- `tests/fixtures/bundles/older-bundle-version.cmemmov`

Files being modified (UPDATE):
- `vitest.config.ts` — add bundle-parser.ts 100% lines threshold
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — update story 1-6 status

### References

- [Source: epics.md — Story 1.6 Acceptance Criteria, lines 481–527]
- [Source: architecture.md — §"Bundle Architecture" (SHA256, gzip, Zod), lines 245–267]
- [Source: architecture.md — §"Test Coverage targets", lines 359–364]
- [Source: architecture.md — §"Architectural Boundaries", lines 637–643]
- [Source: Story 1.4 — `BundleSchema`, `BUNDLE_FORMAT_VERSION`, `CmemmovError`]
- [Source: Story 1.2 — `no-raw-json-parse` rule (fires on JSON.parse outside bundle-parser.ts)]
- [Source: Story 1.3 — vitest.config.ts per-file threshold syntax]
- [Source: Story 1.5 — `warn` callback injection pattern]

## Dev Agent Record

### Agent Model Used

claude-opus-4-7 (executed as `dev-1-6` agent)

### Debug Log References

- `npm run check` (lint + typecheck + test) exits 0 — 121/121 tests pass.
- `npm run test -- --coverage` confirms `src/services/bundle-parser.ts` Lines = 100% with the configured threshold; v8 reports the file at 100% Stmts/Lines/Funcs (one uncovered branch is the defensive `cause instanceof ZodError` true→false path, which the lines threshold does not require).
- Grep across `src/`: `JSON.parse` appears ONLY in `src/services/bundle-parser.ts:19`.

### Completion Notes List

- `parseBundle` implements the 5-step pipeline exactly as specified: gzip-magic-byte detection → `gunzipSync` (when needed) → `JSON.parse` → `BundleSchema.parse` → SHA256 integrity verification → format-version handshake. SyntaxError and ZodError are wrapped in `CmemmovError({ code: 'BUNDLE_INVALID_SCHEMA' })`; integrity mismatch throws `CmemmovError({ code: 'BUNDLE_CHECKSUM_MISMATCH' })` unless `opts.noIntegrityCheck === true`, in which case it emits a warning instead. Version mismatch always emits a warning and never blocks parsing.
- `serializeBundle` computes the canonical SHA256 over a copy of the bundle with the `integrity` field stripped, embeds the checksum on the output, and gzips the result whenever any project has a non-empty `sessions` array OR the indented JSON is ≥5MB. Plain (non-gzipped) human-readable JSON is produced otherwise.
- The `_omit` rest-destructure pattern from the spec snippets was replaced with `{ ...bundle }` + `delete (rest as { integrity?: string }).integrity` to avoid `@typescript-eslint/no-unused-vars` errors. Iteration order is preserved (V8 maintains insertion order under `delete`), so the canonical SHA256 result is identical to the rest-destructure approach. Verified by the round-trip tests.
- The four `.cmemmov` fixtures were produced by a temporary Node.js script (`tests/fixtures/bundles/_generate-fixtures.mjs`) which was deleted after generation — the fixtures are now static, reproducible files. The `corrupted-checksum.cmemmov` fixture uses a 64-hex-character all-`deadbeef` integrity string so it parses through Zod cleanly but fails the SHA256 verification step.
- The `warn` callback uses dependency injection from the caller (default no-op `(): undefined => undefined`). `bundle-parser.ts` does NOT import `ui/output.ts`, satisfying the services → ui forbidden-import rule.
- Defensive `throw cause` branch (where `BundleSchema.parse` throws something other than ZodError) is exercised by a `vi.spyOn(BundleSchema, 'parse')` test that mocks a generic `Error` once.

### File List

NEW:

- `src/services/bundle-parser.ts`
- `src/services/bundle-parser.test.ts`
- `src/services/bundle-serializer.ts`
- `src/services/bundle-serializer.test.ts`
- `tests/fixtures/bundles/valid-linux.cmemmov`
- `tests/fixtures/bundles/valid-windows.cmemmov`
- `tests/fixtures/bundles/corrupted-checksum.cmemmov`
- `tests/fixtures/bundles/older-bundle-version.cmemmov`

MODIFIED:

- `vitest.config.ts` — added `'src/services/bundle-parser.ts': { lines: 100 }` entry to `coverage.thresholds`.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — story 1-6 status: `ready-for-dev` → `in-progress` → `review`.
- `_bmad-output/implementation-artifacts/1-6-bundle-io-parser-serializer.md` — Status, Tasks/Subtasks checkboxes, Dev Agent Record, File List, Change Log.

### Change Log

- 2026-05-09 — Story 1.6 implemented: bundle-parser, bundle-serializer, four `.cmemmov` fixtures, vitest 100% line threshold for `bundle-parser.ts`. All ACs satisfied, `npm run check` exits 0.
- 2026-05-09 — Code review (BMAD): MEDIUM finding resolved — `gunzipSync` exception was unwrapped, leaking raw zlib errors past the `CmemmovError` boundary. Wrapped the call in try/catch and rethrow as `CmemmovError({ code: 'BUNDLE_INVALID_SCHEMA', hint: 'gzip decompression failed' })`. Added regression test (`bundle-parser.test.ts`: "wraps a truncated/corrupt gzip stream as BUNDLE_INVALID_SCHEMA"). Tests 121 → 122; `bundle-parser.ts` lines coverage remains 100%. Six LOW findings logged to `_bmad-output/implementation-artifacts/deferred-work.md` under "Deferred from: code review of story-1.6 (2026-05-09)".
