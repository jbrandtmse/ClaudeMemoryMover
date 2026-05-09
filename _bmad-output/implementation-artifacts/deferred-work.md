# Deferred Work

This file tracks issues surfaced during code review that are real but not actionable in the story under review. Each entry cites the source review and notes the planned resolution path (later story, architecture doc cleanup, etc.).

## Deferred from: code review of story-1.1 (2026-05-09)

- **`README.md` listed in `package.json` `files` whitelist but file does not exist.** `npm pack`/`npm publish` will warn rather than error, and AC3 of Story 1.1 mandates this exact `files` array. Resolution path: Story 5-4 (documentation deliverables) creates README.md.
- **Architecture doc inconsistency: `eslint-plugin-cmemmov/` vs `eslint-rules/`.** Architecture §"Code Quality" line ~352 mentions `eslint-plugin-cmemmov/`, while the canonical project tree (line ~523) uses `eslint-rules/`. Story 1.1 followed the canonical tree (correct). Resolution path: architecture doc edit to remove the stale `eslint-plugin-cmemmov/` reference.
- **`ci-seed.yml` will be replaced by `ci.yml` in Story 1.13.** The story spec explicitly notes this supersession. Resolution path: Story 1.13 (full 3-OS test matrix) deletes/renames `ci-seed.yml` and introduces `ci.yml` with the complete `npm run check` matrix.
- **Architecture doc init-step snippet (lines ~128-148) predates the v22 Node floor and Story 1.1's documented spec deviations.** Specifically, the architecture's stack-init commands and `tsup.config.ts` / `eslint.config.js` snippets contain the same internal contradictions that the dev had to resolve. Resolution path: architect ratifies the dev's deviations (`tsconfig.eslint.json` addition + `tsup` `entry` object form) and updates the architecture doc so subsequent stories' "exact content" references stay in sync.
