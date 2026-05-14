# Contributing to cmemmov

> **Stub note (Story 5.3):** This page currently covers just the release-flow
> sections. Story 5.4 owns the full contributing guide and will expand the
> rest of this file (local-dev setup, code style, PR conventions, etc.).
> See `_bmad-output/implementation-artifacts/5-4-documentation-deliverables.md`.

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
