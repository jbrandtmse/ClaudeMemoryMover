# Story 5.0: Epic 4 Deferred Cleanup

Status: review

## Story

As a cmemmov developer,
I want the Epic 4 code-review LOWs picked up and the pipeline-recovery procedure codified as a durable runbook,
so that Epic 5's distribution stories (binary builds, release pipeline, docs) start from a clean baseline and the team has a written playbook for the next pipeline interruption.

## Triage Table (Epic 4 Retro → Story 5.0)

| # | Item | Source | Decision | Rationale |
|---|------|---------|----------|-----------|
| A1 | Power-outage recovery runbook → `_bmad-output/implementation-artifacts/runbook-pipeline-recovery.md` | Epic 4 retro Action Item #1 (HIGH) | **Include** | HIGH-priority durability gap; procedure currently exists only in Lead session history; next interruption (power, network, Vitest pool deadlock) must not require re-deriving it |
| L1 | `_allCategoriesCheck` bidirectional compile-time guard for `SanitizationProfile` | cr-4-1 LOW | **Include** | Retro's "Deferred items ready for Epic 5 pickup" lists this as Story 5-0; small targeted hardening |
| L2 | Bidirectional category-coverage compile-time guard for `SHARE_CATEGORIES` | cr-4-2 LOW | **Include** | Same reasoning as L1; pair with L1 for symmetry across the two `*_CATEGORIES` literals |
| L3 | `parseShareCategories` "unknown category" branch unit test | cr-4-2 LOW | **Include** | One-line typo case (`cmemmov share --categories foobar`) is reachable but untested; trivial to add |
| L4 | `share.test.ts` tests (a) and (f) assert `bundle.wasRedacted?.credentials === true` | cr-4-3 LOW | **Withdrawn (was Include)** | Triage misread the invariant: share calls `buildBundle({ includeCredentials: false })`, so `bundle.credentials` is never populated and the `applySanitization` strip-credentials gate (`if (credentials !== undefined)`) never fires. `wasRedacted.credentials === true` cannot hold for any share bundle. Replaced with explanatory inline comments in tests (a) and (f); see AC5 Withdrawal Note. |
| L5 | `homedirState.value` reset in `share.test.ts::teardown()` | cr-4-3 LOW | **Include** | One-line defensive fix; eliminates a class of cross-test leakage |
| L6 | Test (e) personal-memory exclusion vacuous w.r.t. `applySanitization` | cr-4-3 LOW | **Defer** | Resolution requires extending `SHARE_CATEGORIES` to include `globalMemory` — out of scope for Epic 5 cleanup; deferred-work.md entry already documents the gap |
| L7 | cr-4-0 hyphenated-cwd rename integration test | cr-4-0 LOW | **Defer** | deferred-work.md entry says "when 4.x integration tests are next revisited"; not before Story 5.0 work; rename path for hyphenated projects is covered indirectly today |
| L8 | `docs/bundle-format.md` `PERSONAL_FILENAME_PATTERNS` documentation | Story 4.1 Task 8.3 + Epic 4 retro | **Defer to Story 5.4** | Retro explicitly routes this to Story 5.4 (Documentation Deliverables) |
| L9 | HIGH from cr-1.9 / cr-1.10: `package.json:files` whitelist excludes dynamic-import chunks | Long-standing carry | **Defer to Story 5.2 or 5.3** | Retro routes to "Story 5.x packaging"; packaging is the natural home, not cleanup |
| L10 | Long-standing LOWs from Stories 1.7–3.4 | Standing backlog | **Drop** | Retro confirms "none block Epic 5"; have aged out of relevance |
| R3 | Spec-writing convention: design intent + worked example, not copy-paste skeleton | Epic 4 retro Action Item #3 | **Carry as process principle** | No 5.0 code change; surface as standing guidance for Story 5.1–5.4 spec authoring |
| R4 | When introducing new bundle fields, extend schema at the same time as consuming logic | Epic 4 retro Action Item #4 | **Carry as process principle** | No 5.0 code change; surface as standing guidance for Story 5.x |
| R5 | Continue `epic-cycle` automation + dedicated X.0 cleanup pattern | Epic 4 retro Action Item #5 | **Drop** | Process observation, no actionable code item |
| R6 | Default to "declarative data structure with literal discriminators" for future security APIs | Epic 4 retro Action Item #6 | **Carry as architectural guidance** | No 5.0 code change |

## Acceptance Criteria

### AC1 — Pipeline-recovery runbook is written

**Given** the Epic 4 retrospective documents one power-outage recovery during Story 4.0 CR, and the procedure currently exists only in this Lead's session history
**When** Story 5.0 is implemented
**Then** a new file exists at [_bmad-output/implementation-artifacts/runbook-pipeline-recovery.md](../implementation-artifacts/runbook-pipeline-recovery.md)
**And** the runbook covers, at minimum:
  1. **Detection signals** — how to recognize a pipeline interruption (Vitest pool deadlock symptoms, missing `shutdown_response`, dead agent name vs stale registration, mid-write `git status` patterns)
  2. **Verification steps** — `git -C .` and `git -C src/MA*` `status --short`, `git log -1 --oneline`, comparison with story file's File List to confirm no partial commits
  3. **Team registration cleanup** — how to inspect `C:\Users\Josh\.claude\teams\<team>\config.json` for stale members and the consequence of reusing a name that hasn't been cleaned up
  4. **Resume procedure** — spawning a fresh agent under a NEW unique name (e.g., `cr-4-0-resume` rather than `cr-4-0`), with explicit "do not assume any prior work exists; re-verify the story's File List against `git status` before continuing" instructions
  5. **Failure-mode catalog** — at minimum: power loss, network drop, Vitest worker-pool deadlock, partial git commit, IDE crash. Each entry includes its detection signal and the diff (if any) from the generic resume procedure
  6. **What NOT to do** — do not `git reset --hard` to "clean up", do not reuse the failed agent's name without checking team config, do not skip the verification step

**Given** the runbook
**When** read by someone unfamiliar with the workflow (peer dev, future Lead)
**Then** the procedure is followable without referring to chat history or the retro file
**And** all referenced paths are absolute or clearly relative-to-repo-root

**Dev Note:** Anchor the runbook in the actual Story 4.0 incident as the worked example. Quote a short trace of what the Lead did during the recovery (verify, fresh-name resume, code reviewer pass) — concreteness beats abstraction here.

### AC2 — `_allCategoriesCheck` becomes a bidirectional compile-time guard

**Given** [src/core/sanitization-rules.ts:436-444](../../src/core/sanitization-rules.ts#L436) (`_allCategoriesCheck` is currently a one-directional widening: `readonly (keyof SanitizationProfile)[]` accepts `[...ALL_CATEGORIES, 'credentials', 'claudeJson']`)
**When** Story 5.0 lands
**Then** the check is replaced by (or augmented with) a bidirectional pair such that:
  - Adding a new entry to `ALL_CATEGORIES` without extending `SanitizationProfile` fails typecheck (current behavior — must be preserved)
  - Adding an extra/misspelled key to `SanitizationProfile` (one that is NOT in `ALL_CATEGORIES ∪ {'credentials', 'claudeJson'}`) fails typecheck (NEW behavior)

**Given** the implementation
**When** done via a `satisfies` constraint, a mutual-extends pair, or a mapped-type assertion (e.g., `type _ProfileKeys = keyof SanitizationProfile extends typeof ALL_CATEGORIES[number] | 'credentials' | 'claudeJson' ? true : false`)
**Then** the chosen approach must continue to work with the existing `SanitizationProfile` declaration without altering its public shape
**And** a comment on the new check explains *both* directions it now proves

**Given** the AC9 runtime test in [src/core/sanitization-rules.test.ts:469](../../src/core/sanitization-rules.test.ts#L469)
**When** the suite runs
**Then** that runtime test continues to pass (it remains the second line of defense)

**Dev Note:** The existing void-cast pattern is fine for the widening direction. For the reverse direction, a `satisfies` clause on the profile constant or an inline `type _ReverseCheck = ...` line is sufficient — do not refactor the public `SanitizationProfile` type itself.

### AC3 — `SHARE_CATEGORIES` becomes a bidirectional compile-time guard

**Given** [src/commands/share.ts:26-35](../../src/commands/share.ts#L26) — `SHARE_CATEGORIES` is currently a one-directional `readonly ClaudeCategory[]` (proves every entry is a `ClaudeCategory` but does NOT prove all desired categories are listed)
**When** Story 5.0 lands
**Then** a bidirectional guard is added such that:
  - Removing an intended category (e.g., `'claudeMd'`) without updating a paired type fails typecheck OR a unit test
  - Adding a category that is not in `ClaudeCategory` continues to fail typecheck (current behavior)

**Given** the implementation
**When** the chosen approach uses a paired type alias (e.g., `type ShareCategoryName = 'claudeMd' | 'customCommands' | 'mcpConfig' | 'globalSettings' | 'teams' | 'plugins'`) plus `satisfies readonly ShareCategoryName[]` on `SHARE_CATEGORIES`
**Then** the alias is the *intent* and the array is the *expression*, and the `satisfies` clause enforces equivalence
**And** the existing `SHARE_CATEGORIES_SET = new Set<string>(SHARE_CATEGORIES)` line and all downstream usage in `parseShareCategories` continue to work unchanged

**Given** the import command
**When** it imports the bundle produced by a `share`-flavored export
**Then** category filtering on the consuming side remains unchanged — this AC is a compile-time-only guard, not a runtime behavior change

**Dev Note:** If a `satisfies`-with-paired-alias is too invasive, an alternative is a static `Exclude<ShareCategoryName, typeof SHARE_CATEGORIES[number]>` line that must resolve to `never` — pick whichever reads cleaner against the existing TypeScript style in the file.

### AC4 — `parseShareCategories` unknown-category branch is covered by a unit test

**Given** [src/commands/share.ts:104-110](../../src/commands/share.ts#L104) (the "unknown category" `throw` branch — fires when a token is not in `UNSUPPORTED_CATEGORIES` AND not in `CATEGORY_ALIASES`)
**When** the test suite runs
**Then** a unit test exists in [src/commands/share.test.ts](../../src/commands/share.test.ts) (or the appropriate companion unit test file) that calls `parseShareCategories('foobar')` and asserts a `CmemmovError` with `code: 'INTERNAL'` and `hint` matching `unknown category: foobar`
**And** an additional case covers a mixed input like `parseShareCategories('claudeMd,foobar,teams')` and asserts the same error (the unknown token short-circuits parsing, regardless of position)

**Given** the existing happy-path tests (known-valid tokens, known-unsupported tokens, alias resolution)
**When** the suite runs
**Then** they continue to pass unchanged

**Dev Note:** If `share.test.ts` (unit) does not already exist as a unit test file (i.e., only an integration test exists at `tests/integration/share.test.ts`), add the parse tests in a new `src/commands/share.test.ts` — keep unit tests beside the source per Vitest convention used elsewhere in this repo.

### AC5 — `share.test.ts` tests (a) and (f) assert `bundle.wasRedacted?.credentials === true` — **WITHDRAWN**

**Withdrawal Note (2026-05-14):** This AC was withdrawn mid-implementation after the developer agent surfaced that the assertion is unsatisfiable as written. The AC and its source deferred-work entry both misread which NFR6 layer records the redaction.

The actual code path:

1. `share.ts::run` calls `buildBundle({ ... includeCredentials: false ... })` — hardcoded for NFR6.
2. `export-selection.ts::buildBundle` (lines 178–181) only sets `bundle.credentials` when `opts.includeCredentials === true`. With `false`, `bundle.credentials` stays `undefined`.
3. `applySanitization('strip-personal')` (sanitization-rules.ts:285) has `if (credentials !== undefined)` as the gate before setting `redacted.credentials = true`. For share this gate never fires; `wasRedacted.credentials` is `undefined`, not `true`.

The credentials file IS seeded on disk by `seedShareSourceTree` (default `credentials: true`), but the seed only controls `.credentials.json` existence. Share never propagates the file content into `bundle.credentials` because `includeCredentials: false` short-circuits at buildBundle.

**Where the actual NFR6 guarantee lives** (preserved by Epic 4):

- **Layer 1 — CLI parse:** `--include-credentials` throws `SHARE_INVALID_SOURCE` before any read.
- **Layer 2 — decision-build (this is the layer that actually fires for share):** `buildBundle` is called with hardcoded `includeCredentials: false`, so `bundle.credentials` is never populated. Verified in test (b) (silent + non-silent parse-time rejection) and indirectly in every other test by `expect(bundle.credentials).toBeUndefined()`.
- **Layer 3 — profile-level strip:** `applySanitization('strip-personal')` cannot preserve credentials (the profile literal is `credentials: 'strip'`). This layer is the one AC5 thought it was testing; in practice the layer is a defense-in-depth for callers other than share (e.g., a hypothetical future export-then-sanitize flow).
- **Layer 4 — type-level enforcement:** `SanitizationProfile`'s literal-string discriminator makes `credentials: 'preserve'` unrepresentable.
- **Mechanical byte-sweep:** test (f)'s `expect(bundleText.includes('secret-test-token-EYES-ONLY')).toBe(false)` is the bulletproof NFR6 regression guard for share bundles, and is unaffected by this withdrawal.

**Resolution in this story:**

- Tests (a) and (f) now carry an inline comment explaining why we DO NOT assert `wasRedacted.credentials` for share bundles (see `tests/integration/share.test.ts` near the `expect(bundle.credentials).toBeUndefined()` assertion in each test).
- `_bmad-output/implementation-artifacts/deferred-work.md` cr-4-3 section's L4 bullet is updated to "WITHDRAWN — wrong invariant" with the same analysis.
- Triage table row L4 above is updated from **Include** to **Withdrawn (was Include)**.

**Dev Note:** This is a reference case for the "Schema-extends-with-consumer pattern" carried forward from Epic 4 retro AI#4 (see Dev Notes below): a code reviewer's deferred-work entry is not a substitute for tracing the actual data flow. When a triage row points at a runtime assertion, the spec author should verify the assertion's preconditions actually hold for the caller in question.

### AC6 — `homedirState.value` is reset in `share.test.ts::teardown()`

**Given** [tests/integration/share.test.ts:87-98](../../tests/integration/share.test.ts#L87) (`teardown` function) and the module-scoped `homedirState = { value: '' }` declared at line 19
**When** `teardown(ctx)` runs
**Then** `homedirState.value = ''` is executed unconditionally before (or after — pick one) the existing platform-mock restore and env restore, so that a test which panics after setting `homedirState.value` but before its per-test cleanup runs does NOT leak its value into the next test
**And** the reset runs even when `ctx === undefined` (move the assignment to a position where the early-return guard does not skip it, OR add the assignment unconditionally before the `ctx === undefined` guard)

**Given** the existing 10 tests (a)–(j)
**When** the suite runs after the change
**Then** all tests continue to pass — every test sets `homedirState.value = src.sourceHomedir` immediately before calling `shareRun`, so the unconditional reset cannot break any existing flow

**Dev Note:** The simplest safe placement is to assign `homedirState.value = ''` as the *very first* line of `teardown`, before the `if (ctx === undefined) return;` guard. This guarantees reset on every test exit regardless of ctx state. The vitest `afterEach` callback already calls `teardown(ctx)` unconditionally, so this is the right hook.

### AC7 — Test suite remains green; coverage gates remain satisfied

**Given** the changes in AC2–AC6
**When** `npm test` runs on Windows, macOS, and Linux via CI matrix
**Then** all tests pass (no regressions; 589 baseline + new parseShareCategories tests)
**And** the `vitest --coverage` run keeps `src/core/sanitization-rules.ts` and `src/services/bundle-serializer.ts` at the existing 100% line coverage
**And** `src/commands/share.ts` line coverage stays ≥ 90% (current: 91.81% per Story 4.2 close)

**Given** ESLint
**When** `npm run lint` runs
**Then** there are zero new violations, including the local plugin rules

## Tasks / Subtasks

- [x] Task 1: Pipeline-recovery runbook (AC: #1)
  - [x] 1.1 Create `_bmad-output/implementation-artifacts/runbook-pipeline-recovery.md`
  - [x] 1.2 Section: Detection signals (Vitest pool deadlock, missing shutdown_response, dead-name-with-stale-registration, mid-write `git status` patterns)
  - [x] 1.3 Section: Verification steps (`git -C .`, `git -C src/MA*` status; story File List comparison)
  - [x] 1.4 Section: Team registration cleanup (inspecting and reasoning about `~/.claude/teams/<team>/config.json`)
  - [x] 1.5 Section: Resume procedure (fresh unique agent name + re-verify-no-prior-work instructions)
  - [x] 1.6 Section: Failure-mode catalog (power, network, Vitest deadlock, partial commit, IDE crash)
  - [x] 1.7 Section: What NOT to do (`git reset --hard`, name reuse without config check, skip verification)
  - [x] 1.8 Embed the Story 4.0 power-outage incident as the worked example
- [x] Task 2: Bidirectional `_allCategoriesCheck` (AC: #2)
  - [x] 2.1 Replace or augment the existing widening check in `src/core/sanitization-rules.ts:436-444` with a reverse-direction `satisfies`/mapped-type assertion
  - [x] 2.2 Add a code comment explaining both directions the check now proves
  - [x] 2.3 Verify AC9 runtime test at `src/core/sanitization-rules.test.ts:469` still passes
- [x] Task 3: Bidirectional `SHARE_CATEGORIES` guard (AC: #3)
  - [x] 3.1 Introduce a paired type alias (e.g., `ShareCategoryName`) in `src/commands/share.ts`
  - [x] 3.2 Apply `satisfies readonly ShareCategoryName[]` to `SHARE_CATEGORIES`
  - [x] 3.3 Verify `SHARE_CATEGORIES_SET`, `parseShareCategories`, and `run` still compile and behave identically
- [x] Task 4: `parseShareCategories` unknown-category test (AC: #4)
  - [x] 4.1 Add `parseShareCategories('foobar')` test asserting `CmemmovError` with code `INTERNAL` and hint `unknown category: foobar`
  - [x] 4.2 Add `parseShareCategories('claudeMd,foobar,teams')` test asserting same error
  - [x] 4.3 Ensure tests are colocated per project convention (`src/commands/share.test.ts` if not present yet)
- [x] Task 5: AC5 withdrawal — inline comments + deferred-work.md update (AC: #5 withdrawn)
  - [x] 5.1 Tests (a) and (f) in `tests/integration/share.test.ts` retain `expect(bundle.credentials).toBeUndefined()`; a multi-line comment is added above each assertion explaining that share's NFR6 layer-2 short-circuit (`buildBundle({ includeCredentials: false })`) means `wasRedacted.credentials` does NOT fire for share, and the byte-sweep test in (f) is the mechanical NFR6 guarantee.
  - [x] 5.2 `_bmad-output/implementation-artifacts/deferred-work.md` cr-4-3 (2026-05-13) section: the "Tests (a) and (f) don't assert `bundle.wasRedacted?.credentials === true`" bullet is updated with a "WITHDRAWN — wrong invariant" note recording the analysis.
- [x] Task 6: `homedirState.value` reset in teardown (AC: #6)
  - [x] 6.1 Add `homedirState.value = ''` as the first line of `teardown` in `tests/integration/share.test.ts:87`, before the `ctx === undefined` guard
- [x] Task 7: Verify CI gates (AC: #7)
  - [x] 7.1 Run `npm test` locally and confirm all tests pass (591 passed / 2 skipped, up from 589 baseline by 2 new parseShareCategories tests)
  - [x] 7.2 Run `npm run lint` and confirm zero new violations
  - [x] 7.3 Run `npx vitest --coverage` and confirm coverage gates hold for the three watched files (sanitization-rules.ts: 100%, bundle-serializer.ts: 100%, share.ts: 94.11% — up from 91.81% baseline)

## Dev Notes

### Process principles carried forward (NO 5.0 code change; standing guidance)

These three principles surface from the Epic 4 retro and apply to all of Epic 5's spec-authoring and implementation work — they are NOT acceptance criteria, they are reminders:

1. **Spec-writing convention** (retro AI#3): for non-trivial pattern logic, the spec should provide *design intent + a worked example*, not a copy-paste skeleton. Stories 4.1 (`pathStartsWith`) and 4.2 (`composePatterns`) both required mid-implementation correction because the spec's skeleton looked authoritative when it wasn't. When authoring Story 5.1–5.4 ACs, prefer "describe the algorithm and show one full input→output example" over "here is the code skeleton, fill in the blanks."

2. **Schema-extends-with-consumer pattern** (retro AI#4): when a new ACs introduces a contextual fact (e.g., Story 4.1's `sourceHomedir`), the spec author should explicitly check whether that fact is already on the bundle schema or whether the schema needs to be extended at the *same time* as the consuming logic. Bundle schema bumps should be planned, not emergent.

3. **Declarative-data-with-literal-discriminators for security-sensitive APIs** (retro AI#6): the strip-personal profile (`SANITIZATION_PROFILES` in `src/core/sanitization-rules.ts`) is the canonical reference. When Story 5.x introduces any new security-sensitive surface (e.g., release-pipeline secrets handling, binary-signing policy), default to this pattern.

### Relevant invariants — must be preserved end-to-end

- **NFR6 (credentials never in share bundles)**: enforced at four layers — CLI parse (`SHARE_INVALID_SOURCE` for `--include-credentials`), decision-build (`buildBundle` called with hardcoded `includeCredentials: false`), profile-level (`applySanitization('strip-personal')` unconditionally strips), and type-level (`SanitizationProfile` literal discriminator). AC5's addition reinforces the test-layer record of layer 3 firing. **Do not** touch layers 1, 2, or 4 in this story.
- **Bundle schema version 1.1.0**: fixed in Story 4.1. Story 5.0 does NOT touch the bundle schema.
- **Strict-reader / fail-loudly invariant**: all settings writers go through `readSettingsForMerge` / `readSettingsFileStrict` as of Story 4.0. Story 5.0 does NOT touch any writer.
- **Flat session-JSONL layout** (`<slug>/*.jsonl`, no `sessions/` subdir): fixed in Story 4.0. Story 5.0 does NOT touch the reader or writer.

### Files this story modifies

- **NEW**: `_bmad-output/implementation-artifacts/runbook-pipeline-recovery.md` (AC1)
- **UPDATE**: `src/core/sanitization-rules.ts` (lines 436-444, AC2)
- **UPDATE**: `src/commands/share.ts` (lines 26-35, AC3)
- **UPDATE or NEW**: `src/commands/share.test.ts` (AC4 — colocate per convention if file does not exist)
- **UPDATE**: `tests/integration/share.test.ts` (lines 87-98 for AC6; lines 116 and 375 for AC5)

### Files this story does NOT modify

- Any production code under `src/services/` (claude-reader, claude-writer, bundle-serializer, claude-locator)
- Any production code under `src/commands/` other than `share.ts`
- `src/core/bundle-schema.ts`, `src/core/decision-schema.ts`, `src/core/error.ts`
- Any fixture under `tests/fixtures/`

If any of the AC tasks require touching one of these excluded files, **stop and surface the issue to the Lead** — that signals scope misunderstanding, not a coding decision.

### Testing standards summary

- **Unit tests**: Vitest, colocated as `<file>.test.ts` next to source. Use `describe`/`it`/`expect`. Mocks via `vi.mock` and `vi.spyOn`.
- **Integration tests**: Vitest under `tests/integration/`. Each test gets its own `tmpdir`-rooted `.claude` tree and tears down in `afterEach`.
- **Coverage gates**: vitest config currently requires 100% on `sanitization-rules.ts` and `bundle-serializer.ts`; ≥90% on `share.ts`. Do not drop below these.
- **CI matrix**: Windows, macOS, Linux × Node 20.x. The GitHub Actions workflow is at `.github/workflows/`. Story 5.0 changes must pass on all three.

### Project Structure Notes

- Alignment confirmed with existing patterns: X.0 cleanup story precedes the epic's feature stories (Stories 2.0, 3.0, 4.0 set this pattern; 5.0 follows).
- No conflicts with the unified project structure. The new runbook lives under `_bmad-output/implementation-artifacts/` alongside retros, deferred-work, and story files — consistent with existing process artifacts.

### References

- [Epic 4 retrospective: `_bmad-output/implementation-artifacts/epic-4-retro-2026-05-13.md`](../implementation-artifacts/epic-4-retro-2026-05-13.md#action-items) — Action Items table (rows 1, 3, 4, 6)
- [Deferred work index: `_bmad-output/implementation-artifacts/deferred-work.md`](../implementation-artifacts/deferred-work.md) — sections `cr-4-1` (line 229), `cr-4-2` (line 236), `cr-4-3` (line 246)
- [Story 4.0 retro pattern: `_bmad-output/implementation-artifacts/4-0-epic-3-deferred-cleanup.md`](../implementation-artifacts/4-0-epic-3-deferred-cleanup.md) — triage table format
- Source files: [src/core/sanitization-rules.ts:436-444](../../src/core/sanitization-rules.ts#L436), [src/commands/share.ts:26-35](../../src/commands/share.ts#L26), [src/commands/share.ts:62-124](../../src/commands/share.ts#L62), [tests/integration/share.test.ts:87-98](../../tests/integration/share.test.ts#L87)

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m] (dev-5-0)

### Debug Log References

- One mid-implementation HALT to surface the AC5 invariant misread; lead approved Option 1 (withdraw AC5 + add explanatory comments). See AC5 Withdrawal Note above and the updated `deferred-work.md` cr-4-3 L4 bullet.

### Completion Notes List

- **AC1 (Task 1):** Created `_bmad-output/implementation-artifacts/runbook-pipeline-recovery.md`. Six sections — Detection Signals, Verification Steps, Team Registration Cleanup, Resume Procedure, Failure-Mode Catalog, What NOT To Do. The Story 4.0 power-outage is the worked example in the Failure-Mode Catalog. All referenced paths are absolute (Windows) or clearly relative-to-repo-root.
- **AC2 (Task 2):** Augmented `_allCategoriesCheck` in `src/core/sanitization-rules.ts` with a reverse-direction conditional-type assertion (`_ProfileKeysSubsetOfCanonical`). Forward direction (entries assignable to `keyof SanitizationProfile`) preserved unchanged; new reverse direction proves `keyof SanitizationProfile extends typeof ALL_CATEGORIES[number] | 'credentials' | 'claudeJson'`. AC9 runtime test still green.
- **AC3 (Task 3):** Introduced `ShareCategoryName` type alias in `src/commands/share.ts` and applied `satisfies readonly ShareCategoryName[] & readonly ClaudeCategory[]` to `SHARE_CATEGORIES`. Reverse direction uses `[Exclude<ShareCategoryName, (typeof SHARE_CATEGORIES)[number]>] extends [never] ? true : false` so removing an intended name from the literal fails typecheck. `SHARE_CATEGORIES_SET`, `parseShareCategories`, and `run` continue to behave identically.
- **AC4 (Task 4):** Added two unit tests to `src/commands/share.test.ts` under the existing `AC10 — unsupported categories rejected` describe block: `parseShareCategories('foobar')` and `parseShareCategories('claudeMd,foobar,teams')` — both assert `CmemmovError` with `code: 'INTERNAL'` and `hint: 'unknown category: foobar'`.
- **AC5 (Task 5) — WITHDRAWN mid-implementation:** Trying to add the AC5 assertion produced two integration-test failures because share calls `buildBundle({ includeCredentials: false })`, so `bundle.credentials` is never populated and the strip-personal credentials-strip gate never fires. Lead approved withdrawal. Resolution: explanatory inline comments added to tests (a) and (f) in `tests/integration/share.test.ts`, plus a WITHDRAWN entry in `_bmad-output/implementation-artifacts/deferred-work.md` cr-4-3 L4. Story file's AC5 carries the full Withdrawal Note. Triage table row L4 updated from **Include** to **Withdrawn (was Include)**.
- **AC6 (Task 6):** Added `homedirState.value = ''` as the very first line of `teardown` in `tests/integration/share.test.ts`, BEFORE the `ctx === undefined` guard. All 10 share integration tests (a)–(j) continue to pass.
- **AC7 (Task 7):** `npm run lint` → clean. `npm test` → 591 passed / 2 skipped (baseline was 589; gained 2 new parseShareCategories tests). `npx vitest --coverage` → `sanitization-rules.ts` 100%, `bundle-serializer.ts` 100%, `share.ts` 94.11% (up from 91.81% baseline).

### File List

- `_bmad-output/implementation-artifacts/runbook-pipeline-recovery.md` — NEW (AC1)
- `src/core/sanitization-rules.ts` — modified (AC2 bidirectional `_allCategoriesCheck`)
- `src/commands/share.ts` — modified (AC3 bidirectional `SHARE_CATEGORIES` + `ShareCategoryName` paired alias)
- `src/commands/share.test.ts` — modified (AC4 two unknown-category unit tests)
- `tests/integration/share.test.ts` — modified (AC5 explanatory comments in tests (a) and (f); AC6 `homedirState.value` reset in teardown)
- `_bmad-output/implementation-artifacts/deferred-work.md` — modified (AC5 withdrawal note added to cr-4-3 L4 bullet)
- `_bmad-output/implementation-artifacts/5-0-epic-4-deferred-cleanup.md` — modified (this file: AC5 withdrawal, triage row L4 update, Task 5 reframe, task checkboxes, Dev Agent Record)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — modified (5-0 ready-for-dev → in-progress → review)

### Change Log

- 2026-05-14 — Story 5.0 implemented. Six task groups complete (Tasks 1, 2, 3, 4, 6, 7); Task 5 / AC5 withdrawn mid-implementation with lead approval after the developer agent surfaced that the assertion was unsatisfiable given share's NFR6 layer-2 short-circuit. All gates green: 591 tests pass (up 2), lint clean, coverage holds for the three watched files (share.ts: 91.81% → 94.11%). Status moved in-progress → review.
- 2026-05-14 — Code review pass complete (cr-5-0). Two MEDIUM findings auto-resolved (runbook unfiltered `Stop-Process` snippet replaced with PID-targeted form + DANGER callout in `runbook-pipeline-recovery.md`; stale cr-4-3 `homedirState.value` LOW marked RESOLVED in `deferred-work.md`). Four LOW findings deferred to `deferred-work.md` under "Deferred from: code review of story-5.0 (2026-05-14)". AC5 withdrawn-per-Lead carried as written; not re-raised. AC6 confirmed correct (10 integration tests all pre-assign `homedirState.value`, so the unconditional pre-guard reset is safe). Typecheck (`npx tsc --noEmit`) clean.

## Review Findings

Two MEDIUM (auto-resolved) and four LOW (deferred). AC5 withdrawn — not re-raised per Lead.

- [x] `[Review][Patch]` Runbook Section 5 "Vitest worker-pool deadlock" recommended unfiltered `Get-Process node | Stop-Process`, which kills sibling Claude Code agents and unrelated Node processes (`runbook-pipeline-recovery.md`) — fixed: replaced with PID-targeted `Get-CimInstance Win32_Process | Where-Object CommandLine -like '*vitest*'` flow + DANGER callout.
- [x] `[Review][Patch]` `deferred-work.md` cr-4-3 `homedirState.value` LOW was still listed as deferred even though Story 5.0 AC6 implemented the fix (`deferred-work.md:256`) — fixed: appended a RESOLVED sub-bullet referencing AC6.
- [x] `[Review][Defer]` Runbook hardcodes `C:\Users\Josh\.claude\teams\...` Windows path — generalize to `%USERPROFILE%\...` at next runbook revision (`runbook-pipeline-recovery.md`) — see `deferred-work.md` cr-5-0 section.
- [x] `[Review][Defer]` Style asymmetry between `[Exclude<...>] extends [never]` (share.ts) and `keyof X extends ...` (sanitization-rules.ts) — both correct, asymmetric on first scan (`src/commands/share.ts:56-58`, `src/core/sanitization-rules.ts:453-456`) — see `deferred-work.md` cr-5-0 section.
- [x] `[Review][Defer]` `parseShareCategories('foobar')` test uses `toBe` exact-match where sibling tests use `toContain` (`src/commands/share.test.ts:425,436`) — see `deferred-work.md` cr-5-0 section. Matches AC4's literal-quote wording so not a defect.
- [x] `[Review][Defer]` `_shareCategoriesCoverAlias` const-assignment redundantly re-encodes a check the type alone already encodes (`src/commands/share.ts:56-59`) — see `deferred-work.md` cr-5-0 section.
