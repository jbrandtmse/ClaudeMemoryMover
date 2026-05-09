# Story 1.1: Repository Initialization & Build Toolchain

Status: done

## Story

As a developer working on cmemmov,
I want a fully configured Node.js + TypeScript + ESM project with the architecture-mandated toolchain locked in place,
so that every subsequent story builds on a stable foundation matching the architecture's specifications.

## Acceptance Criteria

1. `npm install` resolves all production deps (`commander`, `@clack/prompts`, `picocolors`, `zod`) and dev deps (`typescript`, `@types/node`, `vitest`, `@vitest/coverage-v8`, `tsup`, `eslint`, `@typescript-eslint/parser`, `@typescript-eslint/eslint-plugin`) with every dependency in `package-lock.json` pinned to an exact version (no `^` or `~`)
2. `package.json` declares no `postinstall`, `preinstall`, or other lifecycle scripts that execute arbitrary code
3. `package.json` has `"type": "module"`, `"engines": { "node": ">=22.0.0" }`, `"bin": { "cmemmov": "dist/cmemmov.js" }`, and `"files"` whitelisting only `["dist/cmemmov.js", "dist/cmemmov.d.ts", "README.md", "LICENSE"]`
4. `npm run typecheck` (`tsc --noEmit`) exits 0 with no type errors; `tsconfig.json` has `"strict": true`, NodeNext ESM module resolution, and emits `.d.ts` declarations
5. `npm run lint` (ESLint flat config with `--max-warnings=0`) runs cleanly against placeholder source
6. `npm run test` (vitest) runs and passes with placeholder test file
7. `npm run build` (tsup) produces `dist/cmemmov.js` (single bundled ESM) and `dist/cmemmov.d.ts`
8. `npm run check` (lint + typecheck + test in sequence) all pass
9. `.nvmrc` pins Node v22, `.editorconfig` present, `.gitignore` excludes `dist/` and `node_modules/` (already present — verify, do not duplicate), MIT `LICENSE` present
10. `.github/workflows/ci-seed.yml` runs a 3-OS matrix (`windows-latest`, `macos-latest`, `ubuntu-latest`, Node v22) executing `npm ci && npm run lint && npm run typecheck` on every PR — no tests yet (Story 1.13 replaces this with the full matrix)

## Tasks / Subtasks

- [x] Task 1: Create `.npmrc` and initialize `package.json` (AC: 1, 2, 3)
  - [x] Create `.npmrc` with `save-exact=true`
  - [x] Run `npm init -y` then edit `package.json` to match the spec in Dev Notes
  - [x] Verify no lifecycle scripts exist in `package.json`

- [x] Task 2: Install all dependencies (AC: 1)
  - [x] Install prod deps: `npm install --save-exact commander@12.1.0 "@clack/prompts@1.2.0" picocolors@1.1.1 zod@3.23.8`
  - [x] Install dev deps: `npm install --save-dev --save-exact typescript@5.6.2 "@types/node@22.7.5" vitest@2.1.2 "@vitest/coverage-v8@2.1.2" tsup@8.3.0 eslint@9.11.1 "@typescript-eslint/parser@8.59.2" "@typescript-eslint/eslint-plugin@8.59.2" "typescript-eslint@8.59.2"`
  - [x] Verify `package-lock.json` has no `^` or `~` version prefixes for direct deps

- [x] Task 3: Create `tsconfig.json` (AC: 4)
  - [x] Use exact content from Dev Notes; verify `tsc --noEmit` passes

- [x] Task 4: Create `tsup.config.ts` (AC: 7)
  - [x] Use exact content from Dev Notes; verify `npm run build` produces `dist/cmemmov.js` + `dist/cmemmov.d.ts`

- [x] Task 5: Create `vitest.config.ts` (AC: 6)
  - [x] Use exact content from Dev Notes; no coverage thresholds yet (added in Story 1.3)

- [x] Task 6: Create `eslint.config.js` (AC: 5)
  - [x] Use exact content from Dev Notes; verify `npm run lint` passes with `--max-warnings=0`

- [x] Task 7: Create placeholder source files (AC: 4, 5, 6, 7)
  - [x] Create `src/version.ts` — exports `VERSION` constant
  - [x] Create `src/cli.ts` — minimal stub that compiles (full implementation in Story 1.9)
  - [x] Create `src/commands/.gitkeep`, `src/core/.gitkeep`, `src/services/.gitkeep`, `src/ui/.gitkeep` — scaffold directory structure
  - [x] Create `eslint-rules/.gitkeep` — scaffold for Story 1.2's local plugin
  - [x] Create `tests/placeholder.test.ts` — single passing vitest test

- [x] Task 8: Create config and tooling files (AC: 9)
  - [x] Create `.nvmrc` with content `22`
  - [x] Create `.editorconfig` with exact content from Dev Notes
  - [x] Verify `.gitignore` already has `dist/` and `node_modules/` entries — add if missing
  - [x] Create `LICENSE` (MIT, copyright Joshua Brandt 2026)

- [x] Task 9: Create GitHub Actions CI seed workflow (AC: 10)
  - [x] Create `.github/workflows/ci-seed.yml` with exact content from Dev Notes

- [x] Task 10: Wire up npm scripts and final validation (AC: 3, 8)
  - [x] Ensure `package.json` scripts match Dev Notes exactly
  - [x] Run `npm run check` end-to-end and confirm exit 0

## Dev Notes

### package.json (exact shape)

```json
{
  "name": "cmemmov",
  "version": "0.1.0",
  "description": "Migrate, backup, and share your Claude Code environment across machines",
  "type": "module",
  "engines": { "node": ">=22.0.0" },
  "bin": { "cmemmov": "dist/cmemmov.js" },
  "files": ["dist/cmemmov.js", "dist/cmemmov.d.ts", "README.md", "LICENSE"],
  "scripts": {
    "typecheck": "tsc --noEmit",
    "lint": "eslint . --max-warnings=0",
    "test": "vitest run",
    "test:watch": "vitest",
    "build": "tsup",
    "dev": "tsup --watch",
    "check": "npm run lint && npm run typecheck && npm run test"
  },
  "dependencies": {
    "commander": "12.1.0",
    "@clack/prompts": "1.2.0",
    "picocolors": "1.1.1",
    "zod": "3.23.8"
  },
  "devDependencies": {
    "typescript": "5.6.2",
    "@types/node": "22.7.5",
    "vitest": "2.1.2",
    "@vitest/coverage-v8": "2.1.2",
    "tsup": "8.3.0",
    "eslint": "9.11.1",
    "@typescript-eslint/parser": "8.59.2",
    "@typescript-eslint/eslint-plugin": "8.59.2",
    "typescript-eslint": "8.59.2"
  }
}
```

**Critical:** No `postinstall`, `preinstall`, `prepare`, or any other lifecycle scripts. The `files` array must be exactly as shown — `.claude/`, `_bmad-output/`, and other workspace tooling directories are excluded from the npm package.

### tsconfig.json (exact content)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "declaration": true,
    "declarationDir": "dist",
    "outDir": "dist",
    "rootDir": "src",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "lib": ["ES2022"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

**Critical:** `"module": "NodeNext"` and `"moduleResolution": "NodeNext"` enforce ESM import paths. All source imports must use `.js` extensions (TypeScript resolves `.js` to `.ts` at compile time). Example: `import { foo } from './foo.js'`.

### tsup.config.ts (exact content)

```ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  outDir: 'dist',
  banner: {
    js: '#!/usr/bin/env node',
  },
  target: 'node22',
});
```

The `banner.js` adds the shebang to the output bundle — do NOT put a shebang in `src/cli.ts` itself.

### vitest.config.ts (exact content — basic, no coverage thresholds yet)

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
    },
  },
});
```

Coverage thresholds are added in Story 1.3 (100% branch coverage on `path-engine.ts`). Do not add them here.

### eslint.config.js (exact content)

Uses `typescript-eslint` unified package (v8) for the flat config helper. The individual `@typescript-eslint/parser` and `@typescript-eslint/eslint-plugin` packages are installed as transitive deps.

```js
import tseslint from 'typescript-eslint';

export default tseslint.config(
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['**/*.{js,cjs,mjs}'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'eslint-rules/**'],
  },
);
```

Story 1.2 adds the local ESLint plugin to this config. Do not add custom rules here.

### Placeholder source files

**src/version.ts:**
```ts
export const VERSION = '0.1.0';
```

**src/cli.ts (minimal stub):**
```ts
import { VERSION } from './version.js';

export function main(): void {
  throw new Error(`cmemmov ${VERSION}: not yet implemented`);
}
```

**tests/placeholder.test.ts:**
```ts
import { describe, it, expect } from 'vitest';

describe('placeholder', () => {
  it('passes', () => {
    expect(true).toBe(true);
  });
});
```

### .editorconfig (exact content)

```ini
root = true

[*]
indent_style = space
indent_size = 2
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true

[*.md]
trim_trailing_whitespace = false
```

### .github/workflows/ci-seed.yml (exact content)

```yaml
name: CI Seed
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
jobs:
  lint-and-typecheck:
    strategy:
      fail-fast: false
      matrix:
        os: [windows-latest, macos-latest, ubuntu-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
```

`fail-fast: false` ensures all three OS jobs report independently — a Linux failure does not cancel the Windows job. Story 1.13 replaces this workflow with the full `npm run check` matrix once there is enough test surface.

### Architecture Compliance Guardrails

**MUST follow — enforced in every subsequent story:**

- `"type": "module"` — all `.ts` and `.js` files are ESM; no CommonJS patterns
- Import paths must use `.js` extension: `import { foo } from './foo.js'`
- No barrel files (`index.ts`) anywhere in `src/` — Story 1.2's ESLint rules will not be in place yet, but establish the pattern now
- `eslint-rules/` directory is scaffolded empty; Story 1.2 populates it — do not add JS files there in this story
- The `.claude/` and `_bmad-output/` directories are workspace tooling — never modify them as part of cmemmov source work
- `dist/` is already in `.gitignore` (verified above) — do not commit build output

**Layered dependency rule (established here, enforced from Story 1.2 onward):**
```
ui → commands → services → core
core imports nothing from fs, os, or process
```
The placeholder `src/cli.ts` stub intentionally doesn't import any command/service modules — that pattern is correct.

**No postinstall scripts — ever.** This is a hard architectural constraint. Verify `package.json` has no `scripts.prepare`, `scripts.postinstall`, or `scripts.preinstall` before completing this story.

### Project Structure Notes

Source files go at the repository root (`c:\git\ClaudeMemoryMover\`). No subdirectory is needed — the `files` field in `package.json` controls what gets published to npm, and `_bmad-output/`, `.claude/`, and other workspace tooling are automatically excluded.

Directory scaffold to create (empty, with `.gitkeep`):
```
src/commands/
src/core/
src/services/
src/ui/
eslint-rules/
tests/integration/
tests/fixtures/bundles/
tests/fixtures/claude-trees/
```

The full directory tree from the architecture is the target structure all 13 stories in Epic 1 will fill in. This story only creates the scaffold.

### References

- Architecture §"Initialization Steps" — exact init commands and dep list
- Architecture §"Final Dependency Footprint" — 4 runtime deps (commander, @clack/prompts, picocolors, zod)
- Architecture §"Starter Template Evaluation" — rationale for bespoke stack, no framework
- Architecture §"Distribution & CI" — ci-seed.yml scope and the Story 1.13 supersession
- Architecture §"Code Quality" — ESLint strictness baseline, `strict-type-checked`
- Architecture §"Complete Project Directory Tree" — full target structure
- Epics §"Story 1.1" AC — exact package.json fields, npm scripts, CI matrix requirement
- Epics §"Additional Requirements" — Node v22 floor (PRD NFR15 updated 2026-05-08: v18 → v22)

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

- Lint phase initially failed with `Parsing error: file was not found in any of the provided project(s)` for `tests/placeholder.test.ts`, `tsup.config.ts`, and `vitest.config.ts`. Root cause: the spec's `tsconfig.json` (`include: ["src/**/*.ts"]`) and the spec's `eslint.config.js` (`parserOptions.project: true`) cannot both be exactly applied — `project: true` only matches the file's nearest tsconfig, which excludes tests and config files.
- Build phase initially produced `dist/cli.js` instead of the AC7-mandated `dist/cmemmov.js`. Root cause: spec's `tsup.config.ts` had `entry: ['src/cli.ts']`, which tsup writes as `dist/cli.js`; AC7 and `package.json bin` both require `dist/cmemmov.js`.

### Completion Notes List

**Implementation summary:** Story 1.1 (Repository Initialization & Build Toolchain) implemented per AC. All 10 acceptance criteria pass and `npm run check` (lint → typecheck → test) exits 0 end-to-end.

**Verification results:**

- `npm install` with `.npmrc save-exact=true` produced lockfile with all 13 direct deps pinned to exact versions (no `^`/`~`) — verified programmatically against `package-lock.json`.
- `package.json` has no `postinstall`/`preinstall`/`prepare` lifecycle scripts; `type: module`, `engines.node >=22.0.0`, `bin.cmemmov: dist/cmemmov.js`, and `files` whitelist match spec exactly.
- `npm run typecheck` (`tsc --noEmit`) — exit 0.
- `npm run lint` (ESLint flat, `--max-warnings=0`) — exit 0.
- `npm run test` (vitest run) — 1 test passing (`tests/placeholder.test.ts`).
- `npm run build` (tsup) — produces `dist/cmemmov.js` (178 B ESM with `#!/usr/bin/env node` shebang banner) and `dist/cmemmov.d.ts`.
- `npm run check` — passes end-to-end.
- `.nvmrc` = `22`, `.editorconfig` per spec, MIT `LICENSE` (Joshua Brandt 2026), `.gitignore` already had `dist/` and `node_modules/` (verified, no duplication added).
- `.github/workflows/ci-seed.yml` with 3-OS matrix (`windows-latest`, `macos-latest`, `ubuntu-latest`), Node 22, runs `npm ci && npm run lint && npm run typecheck`, `fail-fast: false`.

**Deviations from "exact content" in Dev Notes (justified by spec contradictions, both confirmed via Perplexity research against typescript-eslint v8 docs):**

1. **`eslint.config.js` — `parserOptions.project: true` → `project: ['./tsconfig.eslint.json']`**
   - Reason: With `project: true` and the spec's `tsconfig.json` (which scopes `include` to `src/**/*.ts`), typescript-eslint cannot find `tests/placeholder.test.ts`, `tsup.config.ts`, or `vitest.config.ts`, so `npm run lint` fails. AC5 mandates lint must pass against placeholder source (which includes the test file). Tried `projectService: true` (the v8 official recommendation) first — it still required the files to be in some discoverable tsconfig.
   - Resolution: Added `tsconfig.eslint.json` extending the base tsconfig with `include: ["src/**/*.ts","tests/**/*.ts","*.config.ts","*.config.js","eslint.config.js"]`, `noEmit: true`, `rootDir: "."`. Pointed ESLint at it explicitly. Build `tsconfig.json` remains unmodified — preserves `rootDir: "src"` so `tsc --noEmit` and `tsup` only compile production source.

2. **`tsup.config.ts` — `entry: ['src/cli.ts']` → `entry: { cmemmov: 'src/cli.ts' }`**
   - Reason: Array-form entry uses the source basename (`cli`) for output, producing `dist/cli.js`. AC7 explicitly requires `dist/cmemmov.js`, and `package.json bin: { cmemmov: 'dist/cmemmov.js' }` depends on this. Object-form entry sets the output basename to the key.
   - Resolution: Used `entry: { cmemmov: 'src/cli.ts' }` — minimal change, all other tsup options unchanged.

Both deviations are mechanical fixes for spec-internal contradictions; the spirit and architecture intent of every AC are fully satisfied. Recommend the architect ratify these in a follow-up to keep future stories' "exact content" references in sync.

**Architecture compliance:**

- ESM enforced via `"type": "module"` and `tsconfig.json module/moduleResolution: NodeNext`.
- `src/cli.ts` imports `./version.js` (`.js` extension on TS source — correct ESM pattern).
- No barrel files in `src/`.
- `eslint-rules/` scaffolded empty (Story 1.2 will populate).
- Layered structure scaffolded: `src/{commands,core,services,ui}/`.
- `dist/` already in `.gitignore`; build artifacts not committed.
- No `postinstall`/`preinstall`/`prepare` scripts.

### File List

**New files (created in this story):**

- `.npmrc`
- `package.json`
- `package-lock.json`
- `tsconfig.json`
- `tsconfig.eslint.json` (added to resolve type-aware ESLint coverage of test + config files; see Completion Notes deviation #1)
- `tsup.config.ts`
- `vitest.config.ts`
- `eslint.config.js`
- `.nvmrc`
- `.editorconfig`
- `LICENSE`
- `.github/workflows/ci-seed.yml`
- `src/version.ts`
- `src/cli.ts`
- `src/commands/.gitkeep`
- `src/core/.gitkeep`
- `src/services/.gitkeep`
- `src/ui/.gitkeep`
- `eslint-rules/.gitkeep`
- `tests/placeholder.test.ts`
- `tests/integration/.gitkeep`
- `tests/fixtures/bundles/.gitkeep`
- `tests/fixtures/claude-trees/.gitkeep`

**Modified files:** none (`.gitignore` already contained `dist/` and `node_modules/` per AC9 — verified, not modified).

**Deleted files:** none.

### Review Findings

Code review performed 2026-05-09 by reviewer agent (Opus 4.7) using three review layers (Blind Hunter, Edge Case Hunter, Acceptance Auditor).

**Result:** Clean review — all 10 acceptance criteria pass and `npm run check` exits 0 end-to-end. The two documented deviations (`tsconfig.eslint.json` and `tsup` entry object form) are justified mechanical fixes for spec-internal contradictions; the spirit and architectural intent of every AC are satisfied.

No HIGH or MEDIUM severity issues. No `patch` findings.

LOW / informational observations (all deferred — none require code changes in Story 1.1):

- [x] [Review][Defer] `README.md` whitelisted in `package.json` `files` but file does not yet exist — deferred to Story 5-4 (documentation deliverables); `npm pack` warns rather than errors and the AC mandates this exact `files` array.
- [x] [Review][Defer] Architecture doc inconsistency: section "Code Quality" mentions `eslint-plugin-cmemmov/` while the canonical project tree uses `eslint-rules/` — deferred (architecture doc cleanup, not a code change). Story 1.1 follows the canonical tree, which is correct.
- [x] [Review][Defer] `ci-seed.yml` will be replaced by `ci.yml` in Story 1.13 — deferred (planned supersession per story spec).
- [x] [Review][Defer] Architecture doc init-step snippet (lines ~128-148) predates the v22 Node floor and the documented deviations — deferred (architect ratification of dev's spec-deviation rationale to keep future "exact content" references in sync).

## Change Log

| Date       | Version | Description                                                                                                                  | Author |
|------------|---------|------------------------------------------------------------------------------------------------------------------------------|--------|
| 2026-05-09 | 0.1.0   | Initial repository initialization & build toolchain (Story 1.1) — package.json, tsconfig, tsup, vitest, ESLint flat config, placeholder source, MIT license, `.editorconfig`, `.nvmrc`, CI seed workflow. `npm run check` passes end-to-end. Two minor spec deviations documented in Completion Notes (`eslint.config.js` parser option + `tsup.config.ts` entry name) to resolve internal contradictions and satisfy AC5 and AC7. | dev-1-1 |
| 2026-05-09 | 0.1.1   | Code review (3-layer adversarial: Blind Hunter, Edge Case Hunter, Acceptance Auditor): clean — all 10 AC pass, no HIGH/MEDIUM issues, no patches required. 4 LOW informational observations logged as deferred (3 already covered by future stories; 1 architecture-doc cleanup). Deferred items also recorded in `_bmad-output/implementation-artifacts/deferred-work.md`. Status advanced `review` → `done`. | reviewer-1-1 |
