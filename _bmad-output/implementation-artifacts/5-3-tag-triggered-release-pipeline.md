# Story 5.3: Tag-Triggered Release Pipeline

Status: done

## Story

As a cmemmov maintainer,
I want `git push --tags` after `npm version <patch|minor|major>` to fully automate a release: full CI matrix → `npm publish` → 4 Node SEA binary builds → upload to GitHub Release,
so that releases are friction-free, consistent, and never miss a step (CI gate, binary build, signing, upload).

## Acceptance Criteria

### AC1 — Workflow triggers on `v*` tag push and on `workflow_dispatch`

**Given** a new `.github/workflows/release.yml`
**When** a tag matching `v*` is pushed to the repo (e.g., `git push origin v0.2.0`)
**Then** the workflow triggers automatically
**And** the workflow also supports manual invocation via `workflow_dispatch` (GitHub UI → Run workflow), accepting an optional `tag` input for re-running against a specific tag
**And** the trigger pattern is exactly `tags: ['v*']` (with the leading `v`); raw version numbers like `0.2.0` do NOT trigger

**Given** the workflow file structure
**When** the file is inspected
**Then** the top of `release.yml` declares:
  - `on.push.tags: ['v*']`
  - `on.workflow_dispatch.inputs.tag: { description: 'Tag to release (e.g., v0.2.0)', required: false, type: string }`
  - `permissions: { contents: write, id-token: write }` (write contents for GitHub Release creation; id-token for npm provenance OIDC)
  - `concurrency: { group: release-${{ github.ref }}, cancel-in-progress: false }` (never cancel a release run mid-flight; if a duplicate run triggers, queue it — the second push will fail at the npm-publish step anyway, which is the desired behavior per AC4)

### AC2 — CI matrix gate runs first; downstream jobs block until it passes

**Given** the workflow's job graph
**When** triggered
**Then** the first job is `check-matrix` — lint + typecheck + test on `windows-latest` × `macos-latest` × `ubuntu-latest` × Node 22 (mirrors `.github/workflows/ci.yml`'s `check` job)
**And** every downstream job (`npm-publish`, `binary-builds`, `release`) declares `needs: check-matrix` so they do NOT run until the full matrix has passed

**Given** any matrix shard fails
**When** the failure occurs
**Then** the workflow halts; no `npm publish`, no binary builds, no GitHub Release created
**And** GitHub's UI flags the failed shard with a red ✗

**Implementation guidance:** Don't duplicate the `check` job inline — reference it. Either copy the steps verbatim from `ci.yml` (acceptable for v0.x; documents the gate in one place) or use a reusable workflow (`workflow_call`) and have both `ci.yml` and `release.yml` call it. Pick whichever the dev finds cleaner; the gate must run, but DRY is a nice-to-have, not an AC.

### AC3 — `npm publish` runs with provenance and the correct dist-tag

**Given** the `npm-publish` job
**When** it runs (after `check-matrix` passes)
**Then** it:
  1. Checks out the repo at `${{ github.ref }}`
  2. Sets up Node 22 via `actions/setup-node@v4` with `registry-url: 'https://registry.npmjs.org'`
  3. Runs `npm ci`
  4. Runs `npm run build`
  5. Computes the dist-tag: `node -p "require('./package.json').version.startsWith('0.') ? 'next' : 'latest'"` (or the equivalent in shell) — 0.x → `next`, 1.x+ → `latest`
  6. Runs `npm publish --provenance --access public --tag <dist-tag>` with `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` in the env
  7. Runs `ubuntu-latest` (provenance is currently most reliable on Linux runners; macOS/Windows have intermittent OIDC issues per npm docs)

**Given** the npm publish step
**When** it runs
**Then** the token is provided ONLY via env var `NODE_AUTH_TOKEN`; the token MUST NOT be echoed, logged, or printed in any other step
**And** the workflow's `run:` lines MUST NOT contain `${{ secrets.NPM_TOKEN }}` directly (this would let it leak via `set -x` or job-log expansion) — pass via the `env:` block only

**Given** documentation (this story's task list, NOT user-facing docs)
**When** read by the next maintainer setting up the secret
**Then** the workflow file's top-of-file comment documents:
  - The required GitHub repo secret name: `NPM_TOKEN`
  - The minimum-scope token type: `automation` token with publish-only permissions (NOT a token with admin scope)
  - The provenance prerequisite: the npm package must be linked to this GitHub repo via npm's GitHub linkage (instructions: `npm pkg get repository` must point at this repo, and the npm account must have already enabled provenance for this package OR the publish step uses trusted publishing)

### AC4 — Re-pushing the same tag fails idempotently at `npm publish`

**Given** a tag (e.g., `v0.2.0`) that has already been published once
**When** the same tag is force-pushed or re-triggered via `workflow_dispatch`
**Then** the `check-matrix` job still passes (the code at the tag hasn't changed)
**And** the `npm-publish` job FAILS because npm rejects republishing an existing version (`E403: cannot publish over existing version`)
**And** the `binary-builds` and `release` jobs are skipped (because `npm-publish` failed and they `needs: npm-publish`)
**And** any existing GitHub Release for that tag is NOT modified (because the `release` job never runs)

**Implementation guidance:** This is the desired behavior, not an error case to handle. Do not add an "already published?" pre-check — let npm be the source of truth. The maintainer who wants to fix something for a published version must bump the version and tag again.

### AC5 — Binary builds run on the four target platforms and gate the release

**Given** the `binary-builds` job (a matrix mirroring Story 5.2's `binary-build` job)
**When** it runs (after `check-matrix` AND `npm-publish` pass)
**Then** it builds the four SEA binaries:
  - `cmemmov-windows-x64.exe` (windows-latest)
  - `cmemmov-macos-arm64` (macos-latest)
  - `cmemmov-macos-x64` (macos-13)
  - `cmemmov-linux-x64` (ubuntu-latest)
**And** each shard runs `npm run build && npm run build:binary` (the Story 5.2 pipeline)
**And** each shard's `--version` and `--help` smoke checks (Story 5.2 AC4) gate the shard — a broken binary fails its own shard and blocks the release
**And** each shard uploads its binary as a job artifact via `actions/upload-artifact@v4` with name `cmemmov-<target>` and `if-no-files-found: error`

**Given** any binary shard fails
**When** the failure occurs
**Then** the `release` job does NOT run (because it `needs: binary-builds` and the matrix shard failure short-circuits the dependency)
**And** the GitHub Release is NOT created or modified (avoid partial-asset releases per the AC literal)
**And** the `npm publish` from step AC3 has already happened, so the user-visible state is "published to npm, no binaries on GitHub Release" — log this clearly in the failed workflow output so the maintainer knows to either build binaries manually and upload OR bump the version

**Dev Note:** The order `npm-publish → binary-builds → release` (rather than parallel publish + binaries) is deliberate: if `npm publish` is going to fail (e.g., AC4 idempotency), we don't waste the binary-build runtime. If binaries fail after publish, npm has the canonical artifact and binaries can be retried — partial-asset is recoverable; partial-publish is not.

### AC6 — `release` job creates the GitHub Release and uploads binaries

**Given** the `release` job (depends on `npm-publish` AND `binary-builds`)
**When** it runs (after both prerequisites succeed)
**Then** it:
  1. Downloads all four binary artifacts via `actions/download-artifact@v4` with `pattern: cmemmov-*` and `merge-multiple: true` into `dist/binaries/`
  2. Uses `softprops/action-gh-release@v2` (or equivalent) with:
     - `tag_name: ${{ github.ref_name }}` (from the triggering tag)
     - `files: dist/binaries/cmemmov-*` (uploads all four)
     - `fail_on_unmatched_files: true`
     - **NO `body:` field set** — preserves any release notes the maintainer drafted before tagging (AC8)
     - `draft: false` (publish the release, since the maintainer drafting flow already created a draft with the body content)
  3. Runs on `ubuntu-latest`

**Given** all four binaries are present in `dist/binaries/`
**When** the upload step runs
**Then** the GitHub Release shows four downloadable assets with the exact filenames from Story 5.2 AC3

**Given** the workflow finishes
**When** the maintainer inspects the GitHub Releases page for the tag
**Then** they see: the release marked as not-draft, their manually-written body content unchanged, four binary assets attached, and the npm tarball discoverable on registry.npmjs.org

### AC7 — Maintainer-written release notes are preserved (workflow does NOT auto-generate or overwrite)

**Given** the maintainer's pre-tag workflow:
  1. Maintainer drafts a GitHub Release via the UI: title, body (with release notes), tag name (e.g., `v0.2.0`), saves as **draft**
  2. Maintainer runs `npm version <patch|minor|major>` locally, committing the version bump
  3. Maintainer runs `git push origin main --tags` to push both the commit and the tag
**When** the release workflow triggers from the tag push
**Then** the `softprops/action-gh-release@v2` step finds the existing draft release matching `${{ github.ref_name }}`, attaches the four binaries, and flips the draft to published — without overwriting the manually-written `body` or `name`

**Given** an alternative flow where the maintainer pushes the tag BEFORE drafting the release
**When** the workflow runs and no existing release matches the tag
**Then** the `softprops/action-gh-release@v2` step creates a new release with empty body (no auto-generated changelog) and the four assets — the maintainer can edit the body afterwards
**And** this fallback is documented in `docs/contributing.md` OR the release-workflow file's top-of-file comment

**Dev Note:** `softprops/action-gh-release@v2` defaults to preserving an existing body when `body` is not provided in the workflow input — this is the right behavior for AC7. Verify by reading the action's docs as of 2026-05-14 to confirm no regression in v2 default behavior.

### AC8 — Secrets handling and provenance

**Given** the workflow file
**When** inspected line-by-line for token usage
**Then** `secrets.NPM_TOKEN` appears ONLY in the `npm-publish` job's `env:` block, NOT as a direct `${{ }}` interpolation inside a `run:` line
**And** no `echo`/`printenv`/`set -x` shell debugging is enabled in the `npm-publish` job
**And** the workflow does NOT set `ACTIONS_STEP_DEBUG: true` (which would dump masked secrets via job-log secrets-detection)

**Given** the provenance attestation
**When** `npm view cmemmov@<version> --json` is run after a successful release
**Then** the response includes a `dist.signatures` array and a provenance attestation pointing to the GitHub Actions run that published it
**And** the npm package page on registry.npmjs.org shows the "Provenance" badge

**Implementation guidance:** Provenance requires `--provenance` on `npm publish` AND the `id-token: write` permission AND `actions/setup-node@v4` with `registry-url: 'https://registry.npmjs.org'`. Document this trifecta in the workflow's top-of-file comment so the next maintainer doesn't accidentally remove one piece and silently break provenance.

### AC9 — Workflow file is self-documenting

**Given** the new `.github/workflows/release.yml`
**When** opened by any maintainer (or a future Lead reviewing the pipeline)
**Then** a top-of-file `#` comment block documents:
  - What this workflow does (one paragraph)
  - How to trigger it (`git push --tags` or manual dispatch)
  - The required secret (`NPM_TOKEN` with publish-only scope)
  - The recommended pre-tag flow (draft release with body → tag → push)
  - The "what to do if a binary build fails after publish" recovery (per AC5 Dev Note)
  - A pointer to `_bmad-output/implementation-artifacts/runbook-pipeline-recovery.md` for general pipeline-interruption recovery

### AC10 — End-to-end manual test on a dry-run tag

**Given** the workflow is committed and `NPM_TOKEN` is set in repo secrets
**When** the maintainer wants to verify the wiring without consuming a real version number
**Then** the documented dry-run procedure (in the workflow's top-of-file comment OR in `docs/contributing.md`) explains:
  1. Bump to a clearly-dry version like `0.1.0-dry.<n>` in package.json on a feature branch
  2. Push the branch and create tag `v0.1.0-dry.<n>` from it (NOT from main — this is a dry run, no published commit)
  3. Push the tag
  4. Watch the workflow run
  5. After success: `npm unpublish cmemmov@0.1.0-dry.<n> --force` (allowed within 72 hours of publish per npm policy) AND delete the GitHub Release AND delete the tag

**And** the documentation explicitly warns that `--force` unpublish is only available within 72 hours of publish for npm 2025+ policy; after that, the dry-run version is permanent and counts against the package's history. Recommend running dry-runs sparingly.

**Dev Note:** This AC is documentation-only (no workflow code). The intent is to give the maintainer a safe rehearsal path that doesn't pollute the production version sequence.

### AC11 — Lint + tests remain green; no regressions in the code paths this story touches

**Given** the workflow YAML changes
**When** `npm test` runs on the existing CI matrix
**Then** all existing tests pass (this story is YAML-only outside `docs/contributing.md`; no `src/` changes)

**Given** YAML lint
**When** the new `release.yml` is validated against `.github/workflows/ci.yml`'s structure and any pre-commit YAML lint hooks
**Then** the file parses cleanly (`actionlint` zero violations preferred but not gating; basic YAML well-formedness IS gating)

**Given** `actionlint` if it is wired into pre-commit OR the dev runs it manually
**When** it runs
**Then** zero violations on the new workflow file. If `actionlint` is not yet wired in, this is a soft-target — document the recommended invocation in the workflow comment.

## Tasks / Subtasks

- [x] Task 1: New workflow file `.github/workflows/release.yml` (AC: #1–#9)
  - [x] 1.1 Top-of-file comment block with the AC9 documentation
  - [x] 1.2 `on:` triggers — `push.tags: ['v*']` AND `workflow_dispatch.inputs.tag`
  - [x] 1.3 `permissions: { contents: write, id-token: write }`
  - [x] 1.4 `concurrency: { group: release-${{ github.ref }}, cancel-in-progress: false }`
  - [x] 1.5 Job `check-matrix`: mirrors `ci.yml`'s `check` job exactly (lint + typecheck + test on three OSes × Node 22)
  - [x] 1.6 Job `npm-publish`: `needs: check-matrix`, runs on ubuntu-latest, sets up Node 22 with `registry-url`, `npm ci`, `npm run build`, computes dist-tag (0.x → next, 1.x+ → latest), runs `npm publish --provenance --access public --tag <tag>` with `NODE_AUTH_TOKEN` env var
  - [x] 1.7 Job `binary-builds`: matrix mirror of Story 5.2's `binary-build` job, `needs: [check-matrix, npm-publish]`, uploads artifacts named `cmemmov-<target>` with `if-no-files-found: error`
  - [x] 1.8 Job `release`: `needs: [npm-publish, binary-builds]`, downloads all four artifacts, uses `softprops/action-gh-release@v2` with `tag_name`, `files: dist/binaries/cmemmov-*`, `fail_on_unmatched_files: true`, NO `body:` field
- [x] Task 2: Document the maintainer workflow in `docs/contributing.md` (AC: #7, #10)
  - [x] 2.1 If `docs/contributing.md` does not exist yet (likely — Story 5.4 owns it; check first), create a stub with just the release-flow section and a TODO pointing at Story 5.4 to expand the rest of the file
  - [x] 2.2 Section: "Cutting a release" — the pre-tag flow (draft release → version bump → push tags → workflow runs → release is published)
  - [x] 2.3 Section: "Dry-running the release pipeline" — the AC10 procedure with the 72-hour-unpublish warning
- [x] Task 3: Document required GitHub secrets (AC: #3, #8)
  - [x] 3.1 In `docs/contributing.md` OR the workflow's top-of-file comment, document `NPM_TOKEN` with `automation` scope (publish-only, NOT admin)
  - [x] 3.2 Reference the npm provenance trifecta: `--provenance` + `id-token: write` + `registry-url` setup
- [x] Task 4: Verify gates (AC: #11)
  - [x] 4.1 `npm run lint` clean (no src changes, should be a no-op)
  - [x] 4.2 `npm test` all green (this story is YAML+docs, but run the suite to confirm no incidental regression)
  - [x] 4.3 Validate `release.yml` parses as YAML (`node -e "require('js-yaml').load(...)"` or via online linter; OR commit it and watch the GitHub Actions YAML validator)
  - [x] 4.4 Run `actionlint` against `release.yml` if `actionlint` is installed locally; otherwise document the recommended invocation

## Dev Notes

### Why no auto-generated changelog

Architecture decision (referenced in epics.md Story 5.3 ACs): the maintainer writes release notes manually before tagging. The workflow does NOT use `release-please`, `semantic-release`, or `softprops/action-gh-release@v2`'s `generate_release_notes` flag. This is deliberate:
- Manual notes are higher-quality for v0.x where the audience is small and the changes are intentional
- Auto-generated notes from commit messages couple the release notes to commit hygiene, which adds friction during the rapid-iteration v0.x phase
- For v1.x+, this decision can be revisited per the Architecture's Important Gap log

Do NOT include `generate_release_notes: true` in the action invocation. Do NOT set a `body:` field. Let the action default to "preserve existing body if release exists; empty body if not".

### Trusted publishing vs NPM_TOKEN secret

As of late 2025, npm supports "trusted publishing" via OIDC — no `NPM_TOKEN` required. This is the modern recommended path. However, it requires:
1. npm account has the package linked to a specific GitHub repo (one-time setup)
2. Workflow has `permissions: { id-token: write }` (we already have this for provenance)

**For this story, use the `NPM_TOKEN` secret path** — it's simpler to set up and document for v0.x. Adding trusted-publishing migration is a future story (track as a LOW in deferred-work.md if Task 1.6 is being implemented and the dev notices trusted publishing is already configured for the package).

### Dist-tag computation — shell vs Node

Two equivalent ways:

```bash
DIST_TAG=$(node -p "require('./package.json').version.startsWith('0.') ? 'next' : 'latest'")
echo "DIST_TAG=$DIST_TAG" >> $GITHUB_ENV
```

```yaml
- name: Compute dist-tag
  id: dist-tag
  run: |
    version=$(node -p "require('./package.json').version")
    if [[ "$version" == 0.* ]]; then
      echo "tag=next" >> $GITHUB_OUTPUT
    else
      echo "tag=latest" >> $GITHUB_OUTPUT
    fi
```

Either works. Pick the one that reads more naturally. The shell-only approach (`[[ "$version" == 0.* ]]`) is bash-specific — fine since the publish job runs on ubuntu-latest where bash is the default shell.

### Files this story modifies / creates

- **NEW** `.github/workflows/release.yml` (Task 1)
- **NEW or UPDATE** `docs/contributing.md` (Task 2) — likely NEW if Story 5.4 hasn't created it yet
- **UPDATE** `_bmad-output/implementation-artifacts/sprint-status.yaml` (Task 4 ancillary — automatic via workflow)
- **UPDATE** `_bmad-output/implementation-artifacts/5-3-tag-triggered-release-pipeline.md` (this story file — Dev Agent Record at completion)

### Files this story does NOT modify

- Any code under `src/` (this is a pipeline story, no source-code changes)
- `package.json` (do NOT bump the version as part of this story; version bumps are real-release events)
- `.github/workflows/ci.yml` (preserve the existing PR/push-to-main CI; release.yml is separate)
- `tsup.config.ts` or `scripts/build-binary.mjs` (the Story 5.2 build pipeline is consumed as-is)

If any of those need to change to satisfy an AC, stop and surface the issue — that signals scope misunderstanding.

### Process principles (carried from Epic 4 retro)

- **Spec-writing convention (AI#3):** the workflow YAML is a hand-curated, declarative artifact. The skeleton fragments above are illustrative, not copy-paste. Adapt to the actual `ci.yml` structure and current `actions/*` versions when implementing.
- **Schema-extends-with-consumer (AI#4):** the `binary-builds` matrix MUST stay in sync with Story 5.2's `SUPPORTED_TARGETS` in `scripts/build-binary.mjs`. If the dev finds the matrix and the constant drifting, fix the matrix (single-source-of-truth lives in `build-binary.mjs`; the YAML is a consumer). Manually verify the four targets match.
- **Declarative-data-as-contract (AI#6):** the YAML IS the contract. Don't move logic into a runner-side bash heredoc that could drift from the YAML semantics — keep everything in the workflow file.

### Relevant invariants

- **Pre-release CI gate:** the full matrix must pass before any publish step. Already enforced by `needs: check-matrix`. Verify by reading the job graph after writing the file.
- **Idempotency at the npm layer:** never add an "is this already published?" pre-check. npm is the source of truth (AC4).
- **No body overwrite:** the GitHub Release body comes from the maintainer's pre-tag draft, never from the workflow. Verify by NOT setting `body:` in the action invocation (AC7).
- **Token never echoed:** `secrets.NPM_TOKEN` only appears in `env:` blocks. Verify by grep.

### Testing standards summary

- **No unit tests:** YAML workflows are not unit-testable in any practical sense.
- **Smoke verification:** the only meaningful test is a real run, which requires actually pushing a tag. The AC10 dry-run procedure exists for this purpose.
- **Pre-merge verification:** verify the YAML parses and the job graph is well-formed via `actionlint` or visual inspection in the GitHub Actions UI after committing.
- **Coverage gate:** N/A for YAML.

### Project Structure Notes

- Alignment confirmed: `release.yml` is the third workflow file under `.github/workflows/`, sibling to `ci.yml` and `nightly.yml`. Naming is consistent.
- The `docs/` directory will have `install-binary.md` (Story 5.2) plus this story's `contributing.md` stub. Story 5.4 expands `contributing.md` with the rest of the developer-facing docs.

### References

- [Epic 5 spec — Story 5.3: epics.md:1502-1544](../planning-artifacts/epics.md#L1502) — original ACs
- [Existing CI workflow: .github/workflows/ci.yml](../../.github/workflows/ci.yml) — the `check` job is the model for `check-matrix`
- [Story 5.2 binary-build job: .github/workflows/ci.yml `binary-build`](../../.github/workflows/ci.yml) — the model for `binary-builds`
- [Story 5.2 SUPPORTED_TARGETS: scripts/build-binary.mjs](../../scripts/build-binary.mjs) — the four targets the release matrix must match
- [Pipeline recovery runbook: _bmad-output/implementation-artifacts/runbook-pipeline-recovery.md](./runbook-pipeline-recovery.md) — fallback for workflow interruptions
- [npm provenance docs](https://docs.npmjs.com/generating-provenance-statements) — authoritative source for the `--provenance` + `id-token: write` + `registry-url` trifecta
- [softprops/action-gh-release@v2 docs](https://github.com/softprops/action-gh-release) — verify the "preserve existing body if no `body:` set" default is still the v2 behavior

### Review Findings

Code review pass: `cr-5-3` on 2026-05-14. Three review layers (Blind Hunter, Edge Case Hunter, Acceptance Auditor) produced 9 raw findings — 6 dismissed as noise/false-positive/style, 1 auto-patched, 2 deferred. Zero HIGH/MEDIUM issues. All 11 ACs cross-checked and confirmed satisfied.

- [x] **Review · Patch** — `docs/contributing.md` referenced a trusted-publishing entry in `deferred-work.md` that did not exist (`docs/contributing.md:104-109`). Patched by adding the entry to `_bmad-output/implementation-artifacts/deferred-work.md` under "Deferred from: code review of story-5.3 (2026-05-14)".
- [x] **Review · Defer** — Third-party actions in `release.yml` pinned by major version, not SHA (`.github/workflows/release.yml`, multiple lines). Deferred: project-wide convention (existing `ci.yml`/`nightly.yml` use the same pattern); best resolved as a one-shot hardening pass across all workflows.
- [x] **Review · Defer** — Migrate `npm publish` from `NPM_TOKEN` secret to npm trusted publishing (OIDC) (`.github/workflows/release.yml:140`). Deferred: satisfies the contributing.md "Future: trusted publishing" promise; the provenance trifecta already in place is the prerequisite. Resolution target: at 1.0 cut or earlier.

Layer-by-layer notes (for the next reviewer's reference):

- Blind Hunter raised 9 candidates; 2 were the explicitly-approved deviations from the team-lead message (inline `check-matrix`, `inputs.tag || github.ref_name` fallback), 1 confirmed via WebFetch of `actions/upload-artifact@v4` docs to NOT be a path-doubling defect (the action applies least-common-ancestor stripping for wildcard paths).
- Edge Case Hunter walked: dist-tag glob anchoring, secret interpolation injection surface, Windows PowerShell vs bash shell behavior on the `Compute dist-tag` step (job runs on `ubuntu-latest` only, so N/A), concurrency-group race across distinct tags (acceptable for v0.x), `BUILD_TARGET` env var unused by `build-binary.mjs` (mirrors `ci.yml::binary-build` pre-existing convention).
- Acceptance Auditor confirmed AC1-AC11 each map to a concrete artifact: trigger block (lines 68-77), permissions (79-81), concurrency (83-85), `check-matrix` mirror of `ci.yml::check` (91-105), `npm-publish` with provenance trifecta (107-140), `binary-builds` matrix matching `scripts/build-binary.mjs::SUPPORTED_TARGETS` (145-174), `release` job with `softprops/action-gh-release@v2` and NO `body:` field (176-202), and dry-run procedure documented in both workflow comment AND `docs/contributing.md:111-148`.

## Dev Agent Record

### Agent Model Used

claude-opus-4-7 (dev-5-3, epic-cycle-5-5 team)

### Debug Log References

- YAML parse + job-graph verification: `node -e "require('js-yaml').load(...)"` against `.github/workflows/release.yml` — all four jobs (`check-matrix`, `npm-publish`, `binary-builds`, `release`) parse cleanly; `needs:` chain forms the linear gate `check-matrix → npm-publish → binary-builds → release` per AC2/AC5/AC6.
- Matrix consistency check: extracted `outputBase` values from `scripts/build-binary.mjs::SUPPORTED_TARGETS` and compared to `binary-builds.strategy.matrix.include[*].target` — exact match for all four targets (`linux-x64`, `macos-arm64`, `macos-x64`, `windows-x64`). No drift.
- AC8 secret-handling grep: `NPM_TOKEN` appears in non-comment code ONLY at `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}`. No `set -x`, no `echo NPM_TOKEN`, no `ACTIONS_STEP_DEBUG` anywhere.
- AC7 body-preservation grep: no `body:` field, no `generate_release_notes` — confirmed `softprops/action-gh-release@v2` will preserve any existing draft body.
- Regression gates: `npm run lint` clean; `npm test` → 665 passed / 4 pre-existing skipped / 0 failed (38 test files).
- `actionlint` not installed locally; per AC11 it is a soft-target — the recommended invocation is documented in the workflow file's top-of-file comment.

### Completion Notes List

- Wrote `.github/workflows/release.yml` from scratch (sibling to `ci.yml` and `nightly.yml`). Four jobs gated linearly per AC5 Dev Note ordering: `check-matrix` (3-OS Node-22 matrix mirroring `ci.yml::check`) → `npm-publish` (provenance, dist-tag computed from `package.json` version) → `binary-builds` (4-target matrix matching Story 5.2 `SUPPORTED_TARGETS`) → `release` (downloads artifacts, attaches via `softprops/action-gh-release@v2`).
- Decision: inlined the `check-matrix` job rather than extracting `ci.yml::check` into a `workflow_call` reusable workflow. Per AC2 implementation guidance, either is acceptable; inline keeps the release gate self-contained in one file and is easier to audit. The DRY tradeoff: a future change to `ci.yml::check` must be mirrored here. Documented in the workflow file's comment.
- Decision: used the 2-step shell + `GITHUB_OUTPUT` form for the dist-tag computation (rather than the one-liner `node -p` + `GITHUB_ENV`). Both forms appear in the spec's Dev Notes as equivalent; the 2-step form keeps the shell logic visible without dipping into Node, and the result is consumed by the next step via `steps.dist-tag.outputs.tag`. Job-output is the more conventional pattern.
- Decision: threaded the optional `workflow_dispatch.inputs.tag` into the `release` job's `tag_name` via the fallback expression `${{ inputs.tag || github.ref_name }}`. Per AC1, the input exists "for re-running against a specific tag"; per the Perplexity research, `github.ref_name` already resolves to the tag for both `push.tags` and `workflow_dispatch` when run against a tag ref, so the fallback only matters if the maintainer dispatches against a non-tag ref (e.g., the default branch) with the input set. AC6 step 2 literally says `tag_name: ${{ github.ref_name }}`; the fallback expression collapses to that for the common case while supporting the AC1 manual-override case.
- Decision: created `docs/contributing.md` as a release-flow stub with explicit "Story 5.4 owns the rest of this guide" note at the top, per Task 2.1. Includes Cutting-a-Release, Required-Secrets (with provenance trifecta table), Dry-Running, and Partial-Release-Recovery sections.
- Verified the `binary-builds` matrix targets match `scripts/build-binary.mjs::SUPPORTED_TARGETS` exactly — required by Epic 4 retro AI#4 (schema-extends-with-consumer): the YAML is the consumer; `build-binary.mjs` is the single source of truth.
- Verified AC8 secret hygiene: `NPM_TOKEN` only appears in the `env:` block, never in a `run:` line; no `set -x`; no `ACTIONS_STEP_DEBUG`.
- All four binary-build targets pinned to specific runner OSes per Story 5.2: `windows-latest` (windows-x64), `macos-latest` (macos-arm64 — GitHub's default macOS image is arm64 since 2024), `macos-13` (last available Intel image for macos-x64), `ubuntu-latest` (linux-x64). Pinning macos-13 is load-bearing — `macos-latest` no longer produces x64 binaries.
- Local verification limited per the spec: cannot actually push a tag in this session. What WAS verified: YAML parses cleanly, job graph is well-formed (linear `needs:` chain), `binary-builds` matrix targets match `SUPPORTED_TARGETS`, lint clean, 665/665 tests pass, no regressions. The workflow's real-run smoke test must happen on the first dry-run tag the maintainer cuts (see `docs/contributing.md` → Dry-Running).
- `actionlint` is recommended but not gating per AC11; the workflow's top-of-file comment documents the recommended local invocation.

### File List

- `.github/workflows/release.yml` — new
- `docs/contributing.md` — new (release-flow stub per Task 2.1; Story 5.4 will expand)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — modified (5-3 status: ready-for-dev → in-progress → review)
- `_bmad-output/implementation-artifacts/5-3-tag-triggered-release-pipeline.md` — modified (this story file: tasks/subtasks checked, Status → review, Dev Agent Record + Change Log filled in)

## Change Log

- 2026-05-14 — Story 5.3 implemented (dev-5-3): wrote `.github/workflows/release.yml` with the four-job linear gate, created `docs/contributing.md` release-flow stub, validated YAML + job graph + matrix consistency + secret hygiene + body preservation + lint + 665-test regression suite. Status: ready-for-dev → review.
