# Contributing to cmemmov

Thanks for your interest in cmemmov. This page covers the local development environment, the npm scripts you'll run day-to-day, how to land a change, the architectural rules the ESLint config enforces, and the release-cutting flow.

For user-facing docs, start at [the README](../README.md).

---

## Dev environment

### Prerequisites

- **Node.js ≥ 22.0.0.** The engine floor is set in `package.json` and matches the Node 22 LTS line. Anything older will reject the install.
- **npm.** Bundled with Node; no separate install.
- **Git.** Any recent version.

Source lives entirely in this repo — no submodules, no generated SDKs.

### One-time setup

```sh
git clone https://github.com/jbrandtmse/ClaudeMemoryMover.git
cd ClaudeMemoryMover
npm install
npm run check
```

`npm run check` runs lint, typecheck, and the test suite in series. If it passes on a fresh clone you're set.

### Editor

VS Code works out of the box — open the repo, accept the recommended TypeScript and ESLint extensions if VS Code prompts. There is no required extension list and no committed `.vscode/` config to honor.

If you use a different editor, you only need TypeScript and ESLint integration. The repo uses native ESM, strict TypeScript (`strictTypeChecked` + `stylisticTypeChecked` from `typescript-eslint`), and the four custom ESLint rules under `eslint-rules/` (see below).

### Where the source lives

| Path | Purpose |
| --- | --- |
| `src/core/` | Pure types and utilities — no Node built-ins except `node:path` |
| `src/services/` | Filesystem, OS, and Claude Code I/O |
| `src/commands/` | One file per CLI command |
| `src/ui/` | Output formatting, prompt wrappers, decision schema |
| `src/cli.ts` | Commander entry point that wires commands to flags. `tsup` builds this to `dist/cmemmov.js` — the bin entry for `npm install -g cmemmov`. |
| `src/cli-sea.ts` | Thin wrapper bundled into `dist/cmemmov-bundled.cjs` for the Node SEA binary build (Story 5.2). |
| `tests/` | Vitest tests, mirroring `src/` structure |
| `eslint-rules/` | The four project-specific ESLint rules |
| `scripts/` | Build helpers (`build-binary.mjs`, `bench-startup.mjs`) |
| `docs/` | This file and the other user/developer docs |

---

## npm scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | `tsup --watch` — rebuilds on save into `dist/`. Use while iterating. |
| `npm test` | Runs the vitest suite once. The CI command. |
| `npm run test:watch` | Vitest watcher mode for the inner loop. |
| `npm run lint` | ESLint over the whole repo with `--max-warnings=0`. |
| `npm run typecheck` | `tsc --noEmit` against `tsconfig.json`. |
| `npm run build` | `tsup` production build into `dist/`. Emits `dist/cmemmov.js` plus lazy-import chunks and `.d.ts` files. |
| `npm run check` | `lint && typecheck && test`. Run before pushing. |
| `npm run build:binary` | Builds a Node SEA single-file binary for the current platform via `scripts/build-binary.mjs`. Output lands at `dist/binaries/cmemmov-<platform>-<arch>(.exe)?`. |
| `npm run coverage:run` | Vitest with `--coverage` for the v8 reporter. |
| `npm run bench:startup` | Throwaway startup-time benchmark. |

`npm run check` is the canonical pre-push check and matches what CI runs on every PR.

---

## Branching, PRs, and commits

### Branching strategy

- Feature branches off `main` (`feat/...`, `fix/...`, `docs/...`, `chore/...` — pick what fits).
- PRs target `main`.
- Squash-merge is the default. Each PR ends up as a single commit on `main`.
- No long-lived release branches — releases are cut by tagging `main` directly (see "Cutting a release" below).

### PR conventions

- Keep PRs small and focused — one story, one bug, or one cohesive refactor per PR.
- The repo uses the [BMad story format](../_bmad-output/implementation-artifacts/) for tracking design intent. If you're implementing a story, link the story file in the PR description. If you're not, a one-paragraph summary is fine.
- CI must be green before merge: lint, typecheck, and the test suite on Windows, macOS, and Linux.
- Commit messages on `main` follow `<type>(<scope>): <subject>` (e.g., `feat(share): support repeatable --include-pattern`). Squash-merge auto-fills from the PR title — give it a good one.

### Running tests across operating systems

CI exercises Windows, macOS, and Linux on every PR. Locally, `npm test` runs against the host OS only — relying on CI to catch the other two is the project's standard practice. If a test is platform-sensitive (path separators, `EBUSY`/`EPERM` codes, Windows drive-letter case), guard it with `process.platform` checks rather than `describe.skip`-ing it on the off-OS, so the test still asserts behavior on the platform it covers.

---

## Architectural rules

The repo's ESLint config (`eslint.config.js`) enforces a small set of architectural invariants. Violations fail the build via `npm run lint --max-warnings=0`.

### The layered dependency rule

```text
ui → commands → services → core
```

- **`core/*`** depends on nothing outside `core/*`. No Node built-ins except `node:path` (for separator utilities). Pure types, schemas, and pure functions.
- **`services/*`** depend on `core/*` and Node built-ins (`fs`, `os`, `path`, etc.). This is the only layer that touches the filesystem and the user's environment.
- **`commands/*`** depend on `services/*`, `core/*`, and `ui/*`. One file per CLI command.
- **`ui/*`** depends on `core/*` (for error types) and the three UI dependencies (`commander`, `@clack/prompts`, `picocolors`). Never imports from `services/*` or `commands/*`.
- **`cli.ts`** wires `commands/*` to `commander` and is the only file that does so.

Why: `core/*` is testable in isolation without mocking the filesystem. `services/*` localizes the platform-specific I/O. `commands/*` are thin orchestrators. `ui/*` is swappable (e.g., for a future TUI or JSON-only mode). The rule is currently enforced **by code review** — there's no dedicated ESLint rule that walks import graphs across layers — but the related mechanical invariants below cover the most common violations.

### The mechanical invariants (ESLint-enforced)

`eslint.config.js` uses `no-restricted-imports` plus four custom rules under `eslint-rules/` to enforce:

| Rule | What it blocks | Owned by |
| --- | --- | --- |
| `no-restricted-imports` (fs writes) | Direct calls to `writeFile`, `rename`, `unlink`, `copyFile`, `rmdir`, `rm` (and the sync variants) outside `services/write-gate.ts` and `services/backup-service.ts`. `commands/export.ts` and `commands/share.ts` are exempt for bundle-output writes. | The WriteGate invariant — every write to `~/.claude/` is journalled and backed up. |
| `no-restricted-imports` (`os.homedir`) | Direct calls to `os.homedir()` outside `services/claude-locator.ts`. | The single-locator invariant — one file decides where `~/.claude/` is. |
| `cmemmov/no-process-env-home` | `process.env.HOME`, `process.env.USERPROFILE`, etc. | Same invariant — locator is the only source of truth. |
| `cmemmov/no-hardcoded-separator` | String literals exactly equal to `'/'` or `'\\'`. | Force code to use `path.sep` / `posix.sep` / `win32.sep` and the path engine for slug ops. |
| `cmemmov/no-console-outside-output` | `console.log`, `console.error`, `console.warn`, `process.stdout.write`, `process.stderr.write` outside `src/ui/output.ts`. | Force every print to route through the Output module (JSON-mode aware). |
| `cmemmov/no-raw-json-parse` | `JSON.parse` outside the three allowed source files (`src/services/bundle-parser.ts`, `src/services/claude-reader.ts`, `src/commands/export-selection.ts`). All `*.test.ts` files are exempt. | Force bundle/config parsing through the Zod-validated paths so a malformed file surfaces a structured error, not a `SyntaxError`. |

The custom rules live under `eslint-rules/` as plain ESLint flat-config plugins. Each rule's source includes the AST patterns it walks and is short enough to read end-to-end.

### Adding a new ESLint rule

1. Drop a new `eslint-rules/<rule-name>.js` exporting `{ meta, create }` (standard ESLint rule shape).
2. Register it in `eslint-rules/index.js` so the plugin object exposes it.
3. Turn it on in `eslint.config.js` under the `plugins: { cmemmov: cmemmovPlugin }` block.
4. Add a `cmemmov/<rule-name>.test.js` next to the rule using `RuleTester` from ESLint's testing utilities. Cover both the bypass cases the rule should catch and the legitimate cases it should leave alone.
5. Run `npm run lint`. If the new rule fires on existing code, decide whether the existing code is wrong (fix it) or whether the rule needs an exemption block in `eslint.config.js` (add it with a comment explaining the carve-out).

One worked example is `eslint-rules/no-process-env-home.js`: it walks `MemberExpression` looking for `process.env.HOME` / `process.env.USERPROFILE`. The bypass case (destructuring `const { HOME } = process.env`) is a known gap tracked in `deferred-work.md`; that level of detail is more than most rules need.

---

## Cutting a release

`cmemmov` releases are tag-driven. Pushing a tag matching `v*` (for example
`v0.2.0`) fires the `.github/workflows/release.yml` pipeline which:

1. Runs the full CI matrix (lint + typecheck + test on Windows, macOS, Linux).
2. Publishes the package to npm with provenance.
3. Builds four Node SEA binaries (Windows x64, macOS arm64, macOS x64, Linux x64).
4. Attaches the binaries to the matching GitHub Release.

### Pre-tag flow (recommended)

This flow preserves your manually-written release notes — the workflow never
overwrites a release body that already exists.

1. **Draft the GitHub Release**.
   - In the GitHub UI, go to **Releases → Draft a new release**.
   - Pick the tag name you're about to create (e.g., `v0.2.0`) — GitHub will
     accept a tag that doesn't exist yet.
   - Fill in the title and body (your release notes).
   - Click **Save draft** (NOT Publish). This creates a draft release that the
     workflow will find and flip to published once the binaries are attached.

2. **Bump the version locally and tag**.
   ```sh
   git checkout main
   git pull
   npm version patch      # or `minor` / `major`
   ```
   `npm version` updates `package.json`, commits the bump, and creates an
   annotated tag matching the new version (e.g., `v0.2.0`).

3. **Push the commit and the tag**.
   ```sh
   git push origin main --tags
   ```
   Both the bump commit and the tag go in one push.

4. **Watch the workflow**.
   - GitHub Actions tab → the `Release` workflow run appears.
   - On success: the draft release is now published with the four binaries
     attached, and the new version is on npm.

### Fallback flow (no pre-drafted release)

If you forget to draft the release first and push the tag anyway, the
workflow still works — it creates a new GitHub Release with an empty body
and the four binary assets. You can edit the body afterwards via the UI.

### What `npm publish` does

The `npm-publish` job runs `npm publish --provenance --access public --tag <dist-tag>`
where `<dist-tag>` is computed from `package.json`:

| Version range | Dist-tag |
| ------------- | -------- |
| `0.x.x`       | `next`   |
| `1.x.x` and later | `latest` |

This keeps pre-1.0 releases off the default install path. Users can pull a
v0.x version with `npm install cmemmov@next`; users on `npm install cmemmov`
get the latest stable (which doesn't exist until we cut 1.0).

## Required GitHub secrets

The release workflow needs exactly one repo secret:

| Secret name | Type | Scope | Notes |
| ----------- | ---- | ----- | ----- |
| `NPM_TOKEN` | npm classic token, **automation** type | publish-only, NOT admin | Generate at https://www.npmjs.com/settings/`<user>`/tokens. The "automation" classic token is the right choice for CI publishing — it's narrower-scope than an admin token and exempt from 2FA prompts. |

Add the secret via **Settings → Secrets and variables → Actions → New
repository secret**. Name it exactly `NPM_TOKEN`. The workflow file maps it
into the `npm publish` step as `NODE_AUTH_TOKEN` — that's the only place it
appears in the workflow.

### Provenance trifecta

npm package provenance ([npm docs](https://docs.npmjs.com/generating-provenance-statements))
requires three things, all already configured in `release.yml`:

1. `--provenance` flag on the `npm publish` command.
2. `permissions: { id-token: write }` at the workflow level (lets the runner
   request a short-lived OIDC token from GitHub).
3. `actions/setup-node@v4` configured with `registry-url: 'https://registry.npmjs.org'`.

Removing any one of these silently strips the provenance attestation. After a
successful release, verify it worked:

```sh
npm view cmemmov@<version> --json | jq '.dist.signatures'
```

Or visit the package page on registry.npmjs.org — successfully signed releases
show a **Provenance** badge.

### Future: trusted publishing

npm now supports OIDC-based "trusted publishing" — no long-lived `NPM_TOKEN`
required. Tracked as a future migration in
`_bmad-output/implementation-artifacts/deferred-work.md`. For v0.x the classic
automation-token path is simpler to set up and document.

## Dry-running the release pipeline

To exercise the wiring without consuming a real version number:

1. **Bump to a clearly-dry version** on a feature branch:
   ```sh
   git checkout -b dry-run-pipeline
   # edit package.json manually: "version": "0.1.0-dry.1"
   git commit -am "chore: dry-run pipeline test"
   git tag v0.1.0-dry.1
   ```

2. **Push the branch and the tag**:
   ```sh
   git push origin dry-run-pipeline
   git push origin v0.1.0-dry.1
   ```

3. **Watch the workflow run** in the Actions tab. All four jobs should
   succeed; the GitHub Release for `v0.1.0-dry.1` will have the four binaries
   attached and the package will appear on npm under the `next` dist-tag.

4. **Clean up within 72 hours**:
   ```sh
   npm unpublish cmemmov@0.1.0-dry.1 --force
   ```
   then delete the GitHub Release (via the UI) and delete the tag locally
   and remotely:
   ```sh
   git tag -d v0.1.0-dry.1
   git push origin :refs/tags/v0.1.0-dry.1
   ```

> **WARNING:** npm allows `--force` unpublish **only within 72 hours of
> publish** (per npm's 2025+ policy). After that window, the version is
> permanent and counts against the package's history forever. Run dry-runs
> sparingly. Prefer testing the workflow YAML locally with
> [`actionlint`](https://github.com/rhysd/actionlint) before any real run.

## Recovering from a partial release

If the binary-build job fails after `npm publish` succeeds, you'll have a
version on npm with no binaries on the GitHub Release. The workflow gates
the GitHub Release on a clean binary build, so the GitHub Release page is
untouched — no partial assets.

Two recovery paths:

1. **Re-run failed shards** in the Actions UI. Artifacts persist for the
   workflow run, so when the `release` job retries it picks up where it
   stopped. This works if the failure was transient (network blip, runner
   flake).

2. **Bump and re-tag** if the failure is structural (broken binary). The npm
   version is canonical and immutable, but binaries can be rebuilt against
   a new version. Run `npm version patch && git push --tags` to cut the next
   release.

For general pipeline-interruption recovery (power loss, runner crash, etc.),
see `_bmad-output/implementation-artifacts/runbook-pipeline-recovery.md`.
