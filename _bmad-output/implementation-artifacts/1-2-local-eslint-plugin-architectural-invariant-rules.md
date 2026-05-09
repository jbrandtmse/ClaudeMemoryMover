# Story 1.2: Local ESLint Plugin — Architectural Invariant Rules

Status: done

## Story

As a developer working on cmemmov,
I want a local ESLint plugin that mechanically enforces the architecture's banned-pattern invariants,
so that drift from the cross-cutting discipline (single source of truth for slug codec, atomic writes, output, bundle parsing) is caught at lint time, not in code review months later.

## Acceptance Criteria

1. **`no-process-env-home`**: ESLint reports an error on any file containing `process.env.HOME`, with a message directing the developer to use `os.homedir()`
2. **`no-hardcoded-separator`**: ESLint reports an error on any string literal whose value is exactly `'/'` or `'\\'`, with a hint to use `path.sep`, `path.join`, or `path.resolve`
3. **`no-console-outside-output`**: ESLint reports an error on `console.log`, `console.error`, `console.warn`, `process.stdout.write`, or `process.stderr.write` in any file whose path does NOT end with `src/ui/output.ts`
4. **`no-raw-json-parse`**: ESLint reports an error on any call to `JSON.parse` in any file whose path does NOT end with `src/services/bundle-parser.ts`
5. Each rule has vitest tests: at least one valid case (rule does NOT fire) and at least one invalid case (rule DOES fire), run via `npm run test`
6. The local plugin is wired into `eslint.config.js`; `npm run lint` passes with `--max-warnings=0` on the current placeholder source

## Tasks / Subtasks

- [x] Task 1: Create rule files in `eslint-rules/` (AC: 1–4)
  - [x] Delete `eslint-rules/.gitkeep` (Story 1.1 placeholder)
  - [x] Create `eslint-rules/index.js` — plugin manifest (see Dev Notes)
  - [x] Create `eslint-rules/no-process-env-home.js` (see Dev Notes)
  - [x] Create `eslint-rules/no-hardcoded-separator.js` (see Dev Notes)
  - [x] Create `eslint-rules/no-console-outside-output.js` (see Dev Notes)
  - [x] Create `eslint-rules/no-raw-json-parse.js` (see Dev Notes)

- [x] Task 2: Create vitest tests for each rule (AC: 5)
  - [x] Create `tests/eslint-rules/no-process-env-home.test.ts`
  - [x] Create `tests/eslint-rules/no-hardcoded-separator.test.ts`
  - [x] Create `tests/eslint-rules/no-console-outside-output.test.ts`
  - [x] Create `tests/eslint-rules/no-raw-json-parse.test.ts`
  - [x] Verify `npm run test` runs and all four test files pass

- [x] Task 3: Update `eslint.config.js` to load and apply the plugin (AC: 6)
  - [x] Add `import cmemmovPlugin from './eslint-rules/index.js';` to `eslint.config.js`
  - [x] Add the plugin to the config with all four rules as errors (see Dev Notes)
  - [x] Keep `eslint-rules/**` in the `ignores` array — the JS rule files are NOT TypeScript source
  - [x] Verify `npm run lint` exits 0 with `--max-warnings=0`
  - [x] Verify `npm run check` still exits 0 end-to-end

## Dev Notes

### Current state of `eslint.config.js` (READ before editing — do NOT rewrite from scratch)

```js
import tseslint from 'typescript-eslint';

export default tseslint.config(
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.eslint.json'],
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

**What must be preserved:** All existing spread configs (`strictTypeChecked`, `stylisticTypeChecked`, `disableTypeChecked` for JS files, the `ignores` entry). `eslint-rules/**` must remain in `ignores` — those are plain JS files that do not need TypeScript analysis.

**What to add:**
1. Import the local plugin at the top.
2. Add a new config object that applies the plugin + four custom rules to `src/**/*.ts` files.

### Updated `eslint.config.js` (exact target state)

```js
import tseslint from 'typescript-eslint';
import cmemmovPlugin from './eslint-rules/index.js';

export default tseslint.config(
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.eslint.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['src/**/*.ts'],
    plugins: { cmemmov: cmemmovPlugin },
    rules: {
      'cmemmov/no-process-env-home': 'error',
      'cmemmov/no-hardcoded-separator': 'error',
      'cmemmov/no-console-outside-output': 'error',
      'cmemmov/no-raw-json-parse': 'error',
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

The custom-rule config block is scoped to `src/**/*.ts` only — test files under `tests/` and config files are intentionally excluded from these invariants.

### `eslint-rules/index.js` (exact content)

```js
import noProcessEnvHome from './no-process-env-home.js';
import noHardcodedSeparator from './no-hardcoded-separator.js';
import noConsoleOutsideOutput from './no-console-outside-output.js';
import noRawJsonParse from './no-raw-json-parse.js';

/** @type {import('eslint').Linter.Plugin} */
const plugin = {
  meta: { name: 'cmemmov', version: '0.0.1' },
  rules: {
    'no-process-env-home': noProcessEnvHome,
    'no-hardcoded-separator': noHardcodedSeparator,
    'no-console-outside-output': noConsoleOutsideOutput,
    'no-raw-json-parse': noRawJsonParse,
  },
};

export default plugin;
```

### `eslint-rules/no-process-env-home.js` (exact content)

Fires on `process.env.HOME` (also `process.env['HOME']`).

```js
/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow process.env.HOME; use os.homedir() instead.' },
    messages: {
      useOsHomedir:
        'Use os.homedir() instead of process.env.HOME — process.env.HOME is unreliable on Windows.',
    },
    schema: [],
  },
  create(context) {
    return {
      MemberExpression(node) {
        if (
          node.object.type === 'MemberExpression' &&
          node.object.object.type === 'Identifier' &&
          node.object.object.name === 'process' &&
          node.object.property.type === 'Identifier' &&
          node.object.property.name === 'env'
        ) {
          const prop = node.property;
          const name =
            prop.type === 'Identifier'
              ? prop.name
              : prop.type === 'Literal' && typeof prop.value === 'string'
                ? prop.value
                : null;
          if (name === 'HOME') {
            context.report({ node, messageId: 'useOsHomedir' });
          }
        }
      },
    };
  },
};
```

### `eslint-rules/no-hardcoded-separator.js` (exact content)

Fires on string literals whose value is exactly `'/'` or `'\\'`.

```js
/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow hardcoded path separators; use path.sep, path.join, or path.resolve.' },
    messages: {
      usePathApi:
        "Hardcoded path separator '{{sep}}' detected. Use path.sep, path.join(), or path.resolve() instead.",
    },
    schema: [],
  },
  create(context) {
    return {
      Literal(node) {
        if (node.value === '/' || node.value === '\\') {
          context.report({
            node,
            messageId: 'usePathApi',
            data: { sep: String(node.value) },
          });
        }
      },
    };
  },
};
```

### `eslint-rules/no-console-outside-output.js` (exact content)

Fires on `console.{log,error,warn}` and `process.{stdout,stderr}.write` in any file that is NOT `src/ui/output.ts`.

```js
const BANNED_IDENTIFIERS = new Set(['log', 'error', 'warn']);
const ALLOWED_SUFFIX = ['src/ui/output.ts', 'src\\ui\\output.ts'];

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Restrict console.* and process.stdout/stderr writes to src/ui/output.ts.' },
    messages: {
      useOutputModule:
        'Direct console/process stream writes are banned outside src/ui/output.ts. Use the Output module.',
    },
    schema: [],
  },
  create(context) {
    const filename = context.filename ?? context.getFilename();
    if (ALLOWED_SUFFIX.some((s) => filename.endsWith(s))) return {};

    return {
      CallExpression(node) {
        const callee = node.callee;

        // console.log / console.error / console.warn
        if (
          callee.type === 'MemberExpression' &&
          callee.object.type === 'Identifier' &&
          callee.object.name === 'console' &&
          callee.property.type === 'Identifier' &&
          BANNED_IDENTIFIERS.has(callee.property.name)
        ) {
          context.report({ node, messageId: 'useOutputModule' });
          return;
        }

        // process.stdout.write / process.stderr.write
        if (
          callee.type === 'MemberExpression' &&
          callee.object.type === 'MemberExpression' &&
          callee.object.object.type === 'Identifier' &&
          callee.object.object.name === 'process' &&
          callee.object.property.type === 'Identifier' &&
          (callee.object.property.name === 'stdout' || callee.object.property.name === 'stderr') &&
          callee.property.type === 'Identifier' &&
          callee.property.name === 'write'
        ) {
          context.report({ node, messageId: 'useOutputModule' });
        }
      },
    };
  },
};
```

### `eslint-rules/no-raw-json-parse.js` (exact content)

Fires on `JSON.parse(...)` in any file that is NOT `src/services/bundle-parser.ts`.

```js
const ALLOWED_SUFFIX = [
  'src/services/bundle-parser.ts',
  'src\\services\\bundle-parser.ts',
];

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Restrict JSON.parse of bundle bytes to src/services/bundle-parser.ts.' },
    messages: {
      useBundleParser:
        'JSON.parse of bundle bytes is banned outside src/services/bundle-parser.ts. Route parsing through the Zod schema.',
    },
    schema: [],
  },
  create(context) {
    const filename = context.filename ?? context.getFilename();
    if (ALLOWED_SUFFIX.some((s) => filename.endsWith(s))) return {};

    return {
      CallExpression(node) {
        const callee = node.callee;
        if (
          callee.type === 'MemberExpression' &&
          callee.object.type === 'Identifier' &&
          callee.object.name === 'JSON' &&
          callee.property.type === 'Identifier' &&
          callee.property.name === 'parse'
        ) {
          context.report({ node, messageId: 'useBundleParser' });
        }
      },
    };
  },
};
```

### Vitest test pattern (use for all four rules)

Tests go in `tests/eslint-rules/`. They import rules from `../../eslint-rules/<rule>.js` and use ESLint's `RuleTester`. `RuleTester.run()` throws on failure, which vitest catches as a test error.

**`tests/eslint-rules/no-process-env-home.test.ts` (example):**

```ts
import { describe, it } from 'vitest';
import { RuleTester } from 'eslint';
import rule from '../../eslint-rules/no-process-env-home.js';

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

describe('no-process-env-home', () => {
  it('passes valid code and fails invalid code', () => {
    tester.run('no-process-env-home', rule as Parameters<typeof tester.run>[1], {
      valid: [
        { code: 'import os from "node:os"; const h = os.homedir();' },
        { code: 'const x = process.env.PATH;' }, // other env vars are fine
      ],
      invalid: [
        {
          code: 'const h = process.env.HOME;',
          errors: [{ messageId: 'useOsHomedir' }],
        },
        {
          code: "const h = process.env['HOME'];",
          errors: [{ messageId: 'useOsHomedir' }],
        },
      ],
    });
  });
});
```

**`tests/eslint-rules/no-hardcoded-separator.test.ts`:**

```ts
import { describe, it } from 'vitest';
import { RuleTester } from 'eslint';
import rule from '../../eslint-rules/no-hardcoded-separator.js';

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

describe('no-hardcoded-separator', () => {
  it('passes valid code and fails invalid code', () => {
    tester.run('no-hardcoded-separator', rule as Parameters<typeof tester.run>[1], {
      valid: [
        { code: 'import path from "node:path"; const p = path.join(a, b);' },
        { code: "const url = 'https://example.com/path';" }, // slash in URL string (not standalone)
        { code: "const re = /\\//;" }, // regex literal, not string
      ],
      invalid: [
        {
          code: "const sep = '/';",
          errors: [{ messageId: 'usePathApi' }],
        },
        {
          code: "const sep = '\\\\';",
          errors: [{ messageId: 'usePathApi' }],
        },
      ],
    });
  });
});
```

**`tests/eslint-rules/no-console-outside-output.test.ts`:**

```ts
import { describe, it } from 'vitest';
import { RuleTester } from 'eslint';
import rule from '../../eslint-rules/no-console-outside-output.js';

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

describe('no-console-outside-output', () => {
  it('allows console in output.ts', () => {
    tester.run('no-console-outside-output', rule as Parameters<typeof tester.run>[1], {
      valid: [
        { code: 'console.log("hello");', filename: 'src/ui/output.ts' },
        { code: 'process.stdout.write("x");', filename: 'src/ui/output.ts' },
      ],
      invalid: [
        {
          code: 'console.log("hello");',
          filename: 'src/commands/export.ts',
          errors: [{ messageId: 'useOutputModule' }],
        },
        {
          code: 'console.error("fail");',
          filename: 'src/core/error.ts',
          errors: [{ messageId: 'useOutputModule' }],
        },
        {
          code: 'process.stderr.write("x");',
          filename: 'src/services/write-gate.ts',
          errors: [{ messageId: 'useOutputModule' }],
        },
      ],
    });
  });
});
```

**`tests/eslint-rules/no-raw-json-parse.test.ts`:**

```ts
import { describe, it } from 'vitest';
import { RuleTester } from 'eslint';
import rule from '../../eslint-rules/no-raw-json-parse.js';

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

describe('no-raw-json-parse', () => {
  it('allows JSON.parse in bundle-parser.ts only', () => {
    tester.run('no-raw-json-parse', rule as Parameters<typeof tester.run>[1], {
      valid: [
        { code: 'const x = JSON.parse(text);', filename: 'src/services/bundle-parser.ts' },
        { code: 'const x = JSON.stringify(obj);', filename: 'src/commands/export.ts' }, // stringify is fine
      ],
      invalid: [
        {
          code: 'const x = JSON.parse(bundleText);',
          filename: 'src/commands/import.ts',
          errors: [{ messageId: 'useBundleParser' }],
        },
        {
          code: 'const data = JSON.parse(fs.readFileSync(path, "utf8"));',
          filename: 'src/core/bundle-schema.ts',
          errors: [{ messageId: 'useBundleParser' }],
        },
      ],
    });
  });
});
```

### TypeScript typing for RuleTester in tests

The `eslint-rules/*.js` files are plain JavaScript (no types). When importing them in TypeScript test files, TypeScript won't know their type. Cast the rule:

```ts
import rule from '../../eslint-rules/no-process-env-home.js';
// cast: rule as Parameters<typeof tester.run>[1]
```

This avoids needing to add `@types` for the rules or convert them to TypeScript. The `eslint` package (`9.11.1`) ships its own types.

### Key constraint: ESLint 9 `context.filename`

ESLint 9 uses `context.filename` (not `context.getFilename()`). The rules above use `context.filename ?? context.getFilename()` for backward compatibility, but `context.filename` is the canonical v9 property.

### Architecture Compliance

From Architecture §"Code Quality":
- Custom rules enforced via `eslint-plugin-cmemmov` (architecture calls it that, but the project tree canonical name is `eslint-rules/` — established in Story 1.1)
- Rules apply to `src/**/*.ts` only (test fixtures intentionally need separator literals and JSON.parse)
- `eslint-rules/**` files remain in `ignores` — they're plain JS tooling, not TypeScript production source

From Architecture §"Enforcement" table:
- `no-console-outside-output` → `console.*` allowed only in `ui/output.ts` ✓
- `no-process-env-home` → `os.homedir()` required ✓
- `no-hardcoded-separator` → path separator literals banned ✓
- `no-raw-json-parse` → bundle parsing via Zod schema ✓

### Previous Story Intelligence (Story 1.1)

**Confirmed working state to build on:**
- `eslint-rules/.gitkeep` exists — delete it when creating rule files
- `eslint.config.js` uses `tseslint.config()` helper from `typescript-eslint@8.59.2` — the plugin integration uses the flat config `plugins:` object syntax (not legacy `extends` arrays)
- `parserOptions.project: ['./tsconfig.eslint.json']` — the broader tsconfig that includes tests — do NOT change this
- `npm run lint` and `npm run check` both exit 0 — keep them passing after this story

**Dev deviations from Story 1.1 that affect this story:**
- `tsup.config.ts` uses object entry form `{ cmemmov: 'src/cli.ts' }` — no impact on this story
- `tsconfig.eslint.json` exists alongside `tsconfig.json` for ESLint scope — tests are in scope for ESLint but remain excluded from the custom rule config block (scoped to `src/**/*.ts`)

### Project Structure Notes

Files to create (all new):
```
eslint-rules/index.js
eslint-rules/no-process-env-home.js
eslint-rules/no-hardcoded-separator.js
eslint-rules/no-console-outside-output.js
eslint-rules/no-raw-json-parse.js
tests/eslint-rules/no-process-env-home.test.ts
tests/eslint-rules/no-hardcoded-separator.test.ts
tests/eslint-rules/no-console-outside-output.test.ts
tests/eslint-rules/no-raw-json-parse.test.ts
```

Files to modify:
```
eslint.config.js  — add plugin import + custom rules config block
```

Files to delete:
```
eslint-rules/.gitkeep  — Story 1.1 placeholder, no longer needed
```

### References

- Epics §"Story 1.2" — all 6 AC (BDD format)
- Architecture §"Code Quality" — custom ESLint rules, invariants enforced
- Architecture §"Enforcement" table — which rules apply to which patterns
- Architecture §"Anti-Patterns" — what the rules prevent
- [ESLint 9 Rule docs](https://eslint.org/docs/latest/extend/custom-rules) — `context.filename`, `RuleTester` flat config format
- Story 1.1 completion notes — `eslint.config.js` current content, dev deviations

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

- `npm run test` → 5 test files passed (4 new rule tests + 1 placeholder), all green
- `npm run lint` → exit 0 (zero warnings, zero errors with `--max-warnings=0`)
- `npm run check` → full lint + typecheck + test pipeline passed end-to-end

### Completion Notes List

- All 5 rule files implemented verbatim per Dev Notes specs (`index.js` plus 4 rule modules in `eslint-rules/`).
- All 4 vitest test files created using ESLint 9 `RuleTester` flat-config pattern with the documented `as Parameters<typeof tester.run>[1]` cast to bridge plain-JS rules into TypeScript tests.
- `eslint.config.js` updated to import the local plugin and add a new flat-config block scoped to `src/**/*.ts` only — test fixtures and config files are intentionally excluded so they may legitimately use path separator literals and `JSON.parse`.
- `eslint-rules/**` retained in `ignores` (these are plain JS tooling files, not TS production source).
- `eslint-rules/.gitkeep` placeholder from Story 1.1 deleted.
- Used ESLint 9 canonical `context.filename` property with `?? context.getFilename()` fallback for back-compat (per Dev Notes guidance).
- All 6 acceptance criteria satisfied: AC1–AC4 (rule behavior) verified by RuleTester; AC5 (vitest tests with valid + invalid cases) confirmed by `npm run test`; AC6 (plugin wired into `eslint.config.js`, `npm run lint --max-warnings=0` exit 0) confirmed.

### File List

Created:

- `eslint-rules/index.js`
- `eslint-rules/no-process-env-home.js`
- `eslint-rules/no-hardcoded-separator.js`
- `eslint-rules/no-console-outside-output.js`
- `eslint-rules/no-raw-json-parse.js`
- `tests/eslint-rules/no-process-env-home.test.ts`
- `tests/eslint-rules/no-hardcoded-separator.test.ts`
- `tests/eslint-rules/no-console-outside-output.test.ts`
- `tests/eslint-rules/no-raw-json-parse.test.ts`

Modified:

- `eslint.config.js` — added local plugin import + flat-config block scoped to `src/**/*.ts`
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — story status: ready-for-dev → in-progress → review

Deleted:

- `eslint-rules/.gitkeep`

## Change Log

| Date | Change |
| --- | --- |
| 2026-05-09 | Story 1.2 implemented: 4 custom ESLint rules (`no-process-env-home`, `no-hardcoded-separator`, `no-console-outside-output`, `no-raw-json-parse`) plus plugin manifest and vitest RuleTester tests. `eslint.config.js` wired to load and apply the plugin to `src/**/*.ts`. Full `npm run check` passes. |
| 2026-05-09 | Code review (cr-1-2): three-layer adversarial review (Blind Hunter, Edge Case Hunter, Acceptance Auditor) executed in-context. All 6 ACs satisfied verbatim against spec; `npm run check` re-verified green. No HIGH severity findings. Two MEDIUM and two LOW enforcement-gap findings deferred to `deferred-work.md` because Story 1.2 spec mandated verbatim "exact content" for each rule file — scope expansion belongs in a follow-up hardening story. Four LOW noise findings dismissed. Story status: review → done. |

### Review Findings

- [x] **Review / Defer (MEDIUM):** `no-process-env-home` misses destructuring (`const { HOME } = process.env`) and computed env access (`process['env'].HOME`). File: `eslint-rules/no-process-env-home.js`. See `deferred-work.md` 2026-05-09 entry. Spec mandated verbatim rule body; expanding scope belongs in a follow-up hardening story.
- [x] **Review / Defer (MEDIUM):** `no-console-outside-output` does not block `console.info/debug/trace/table/dir`. File: `eslint-rules/no-console-outside-output.js`. See `deferred-work.md` 2026-05-09 entry. Rule matches AC3 literal text; broadening to all console methods requires AC update.
- [x] **Review / Defer (LOW):** `no-raw-json-parse` misses `JSON['parse'](text)` computed access. File: `eslint-rules/no-raw-json-parse.js`. See `deferred-work.md` 2026-05-09 entry. Theoretical bypass; relax `Identifier`-only constraint in a follow-up.
- [x] **Review / Defer (LOW):** `no-hardcoded-separator` does not catch template-literal separators. File: `eslint-rules/no-hardcoded-separator.js`. See `deferred-work.md` 2026-05-09 entry. Spec scoped to "string literal whose value is exactly `'/'`"; gap closes naturally once path engine adoption lands (Story 1.7+).
