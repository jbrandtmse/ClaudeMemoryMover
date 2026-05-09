# Story 1.8: UI Layer — Output Formatter, Prompts Wrapper, Decision Schema

Status: review

## Story

As a developer working on cmemmov,
I want an `output` module that is the only place writing to stdout/stderr (with human and JSON modes), a `prompts` wrapper around `@clack/prompts` that is silent-mode-aware, and a `decision-schema` that defines the parity surface between interactive prompts and CLI flags,
So that NFR14 (no silent failures), FR31 (silent mode parity), FR32 (`--json` output), FR33 (structured errors), and the "no interleaving" output discipline are enforced by construction.

## Acceptance Criteria

1. **Given** the output module in human mode
   **When** any command writes a final summary
   **Then** the summary goes to stdout; all progress messages flush to stderr first; there is exactly one final stdout write per command and no interleaving with stderr

2. **Given** the output module in `--json` mode
   **When** any command completes (success or fail)
   **Then** a single JSON object is emitted to stdout with shape `{ success, command, summary, errors, warnings }`; progress lines are emitted to stderr as unstructured text

3. **Given** any source file outside `src/ui/output.ts`
   **When** ESLint runs
   **Then** `console.log`, `console.error`, `console.warn`, `process.stdout.write`, and `process.stderr.write` are flagged by the `no-console-outside-output` rule (this rule is ALREADY implemented from Story 1.2 — verify it passes for all new files; do NOT change the rule implementation)

4. **Given** a `CmemmovError` surfaced through the output module
   **When** in human mode
   **Then** stderr shows the structured error with `code`, `file`, `operation`, `hint`, and a colored headline using `picocolors`
   **And** when in `--json` mode, the error is included in the final stdout JSON object's `errors` array with all non-undefined fields

5. **Given** the prompts module in interactive mode
   **When** a command needs a category multi-select
   **Then** `@clack/prompts` presents the selection UI; Ctrl+C is handled gracefully (emits cancel message and exits with code 130 without partial writes)

6. **Given** the prompts module in `--silent` mode with all required CLI flags supplied
   **When** a command needs a decision
   **Then** the prompt function returns the value derived from the flags WITHOUT prompting

7. **Given** the prompts module in `--silent` mode with a required CLI flag missing
   **When** a command tries to ask for that decision
   **Then** it throws `CmemmovError({ code: 'INTERNAL', exitCode: 2, hint: '--<flag-name> required in silent mode' })`

8. **Given** `core/decision-schema.ts`
   **When** I inspect it
   **Then** every interactive prompt (categories, merge mode, credential opt-in, dry-run) has a corresponding CLI flag, and both populate the same `Decision` struct; `ClaudeCategory` is defined here (not in `claude-writer.ts`) so it can be shared across `core/` and `ui/` without cross-layer imports

## Tasks / Subtasks

- [x] Task 1: Create `src/core/decision-schema.ts`
  - [x] Export `type ClaudeCategory` (the 10-category union) — this MOVES from `claude-writer.ts`; update `claude-writer.ts` to import it from `'../core/decision-schema.js'`
  - [x] Export `const ALL_CATEGORIES: readonly ClaudeCategory[]` — the canonical ordered list
  - [x] Export `type ImportMode = 'merge' | 'overwrite'`
  - [x] Export `interface ExportDecision { categories: ClaudeCategory[]; includeCredentials: boolean; outputPath: string; silent: boolean; json: boolean; }`
  - [x] Export `interface ImportDecision { bundlePath: string; categories: ClaudeCategory[]; mode: ImportMode; dryRun: boolean; noIntegrityCheck: boolean; silent: boolean; json: boolean; }`
  - [x] Export `interface RollbackDecision { backupPath: string | undefined; dryRun: boolean; silent: boolean; json: boolean; }`
  - [x] Export `const FLAG_NAMES` mapping flag names to human-readable descriptions (used by prompts to build `--<flag-name> required` error messages)
  - [x] No fs, no os, no process imports — pure types and constants only

- [x] Task 2: Create `src/core/decision-schema.test.ts`
  - [x] Test that `ALL_CATEGORIES` contains exactly 10 entries and all match `ClaudeCategory`
  - [x] Test that `ExportDecision`, `ImportDecision`, `RollbackDecision` are structurally sound (type-level, no runtime assertions needed — a `satisfies` check suffices)

- [x] Task 3: Update `src/services/claude-writer.ts`
  - [x] Remove the local `ClaudeCategory` type definition
  - [x] Add `import type { ClaudeCategory } from '../core/decision-schema.js'`
  - [x] Verify `npm run check` still passes after this refactor

- [x] Task 4: Create `src/ui/output.ts`
  - [x] Export `interface OutputResult { success: boolean; command: string; summary: string; errors: ErrorRecord[]; warnings: string[]; }`
  - [x] Export `interface ErrorRecord { code: string; file?: string; operation?: string; hint?: string; }`
  - [x] Export class `Output` (or factory function `createOutput`) — see Dev Notes for full interface
  - [x] `progress(msg: string): void` — writes `msg` to **stderr** immediately
  - [x] `warn(msg: string): void` — writes colored warning to **stderr** immediately; buffers message for JSON `warnings` array
  - [x] `error(err: CmemmovError): void` — writes formatted error to **stderr** (human mode) OR buffers for JSON (json mode)
  - [x] `finish(summary: string, success?: boolean): void` — flushes final output to **stdout**: in human mode emits `summary`; in json mode emits `JSON.stringify(OutputResult)`
  - [x] Human error format (stderr): `pc.red(pc.bold('[CODE]'))` + file/operation/hint indented below
  - [x] `no-console-outside-output` rule allows this file — use `console.error(...)` for stderr writes (stderr) and `console.log(...)` for stdout writes, OR use `process.stderr.write` / `process.stdout.write` directly (both are allowed in output.ts)

- [x] Task 5: Create `src/ui/output.test.ts`
  - [x] Spy on `process.stdout.write` and `process.stderr.write` via `vi.spyOn`
  - [x] Test human mode: `progress` goes to stderr, `finish` goes to stdout only
  - [x] Test json mode: `finish` emits single JSON object with correct shape to stdout
  - [x] Test error formatting: human stderr shows `code`, `file`, `hint`; json includes error in `errors` array
  - [x] Test warn buffering: `warn` → stderr immediately; `finish` includes in json `warnings`
  - [x] Test "exactly one stdout write per finish call"

- [x] Task 6: Create `src/ui/prompts.ts`
  - [x] Import from `@clack/prompts` — use `multiselect`, `select`, `confirm`, `isCancel`, `cancel`, `spinner`
  - [x] Export `function selectCategories(opts: { silent: boolean; value?: ClaudeCategory[] }): Promise<ClaudeCategory[]>`
  - [x] Export `function selectMergeMode(opts: { silent: boolean; value?: ImportMode }): Promise<ImportMode>`
  - [x] Export `function confirmCredentials(opts: { silent: boolean; value?: boolean }): Promise<boolean>`
  - [x] Export `function confirmOverwrite(opts: { silent: boolean; value?: boolean }): Promise<boolean>`
  - [x] Export `function createSpinner(): { start(msg: string): void; stop(msg: string): void; fail(msg: string): void }`  — thin wrapper around `@clack/prompts` `spinner()`
  - [x] Each prompt: if `silent === true` AND `value !== undefined` → return `value` immediately without calling clack
  - [x] Each prompt: if `silent === true` AND `value === undefined` → throw `CmemmovError({ code: 'INTERNAL', hint: '--<flag> required in silent mode' })`
  - [x] Ctrl+C: after each clack call check `isCancel(result)` → call `cancel('Operation cancelled.')`, then `process.exit(130)`
  - [x] The `no-console-outside-output` rule does NOT ban prompts.ts (the rule bans console.* and process.stdout/stderr.write; @clack/prompts handles its own I/O internally — prompts.ts does not call console.* or process.stdout.write directly)

- [x] Task 7: Create `src/ui/prompts.test.ts`
  - [x] Mock `@clack/prompts` via `vi.mock('@clack/prompts')`
  - [x] Test interactive path: mock returns a valid value; prompt function returns it
  - [x] Test silent + value supplied: clack NOT called; value returned immediately
  - [x] Test silent + value missing: `CmemmovError(INTERNAL)` thrown with hint
  - [x] Test Ctrl+C: mock `isCancel` returns true; verify `cancel()` called and `process.exit(130)` reached (mock `process.exit`)

- [x] Task 8: Delete `src/ui/.gitkeep`

- [x] Task 9: Final validation
  - [x] `npm run check` exits 0
  - [x] Verify `ClaudeCategory` is defined in exactly ONE place: `src/core/decision-schema.ts`
  - [x] Verify no `console.log/error/warn` or `process.stdout.write/stderr.write` outside `src/ui/output.ts` in src/: `grep -r "console\.\|process\.stdout\|process\.stderr" src/ | grep -v "src/ui/output.ts" | grep -v ".test.ts"`

### Review Findings

- [x] **Review · Patch** — `confirmOverwrite` used `FLAG_NAMES.mode` for its silent-mode hint, surfacing a misleading `--mode required in silent mode` error when the actual missing decision was the overwrite confirmation (`src/ui/prompts.ts:80`). Fixed by adding `FLAG_NAMES.force` (`--force`) and routing `confirmOverwrite` to it; test now asserts the exact hint string. AC7+AC8 violation resolved.
- [x] **Review · Patch** — `createSpinner.fail` delegated to `s.stop(msg)`, but @clack/prompts v1.2.0's `SpinnerResult` exposes a distinct `error(msg?: string): void` method (per `dist/index.d.mts:300`). Failures rendered identically to successes (`src/ui/prompts.ts:107-109`). Fixed by routing `fail` to `s.error(msg)`; spinner mock factory updated to include `error: vi.fn()`; new test asserts `fail` calls `error` and not `stop`. The story's Completion Notes claim "clack v1.2.0 has no distinct error variant" was incorrect.
- [x] **Review · Patch** — `bailOnCancel` was typed `(result: unknown): void`, forcing each prompt to use `result as TYPE` after the cancel check — a type lie if `bailOnCancel` were ever changed to not exit (`src/ui/prompts.ts:25-30`). Fixed by converting to a TypeScript assertion function `function bailOnCancel<T>(result: T | symbol): asserts result is T`; explicit type argument supplied at each call site; redundant `as` casts removed.
- [x] **Review · Defer** — `decision-schema.test.ts:36-37` runtime `satisfies` assertion is an identity tautology — deferred to `deferred-work.md` (LOW, cosmetic; type guarantee already enforced at compile time)
- [x] **Review · Defer** — `Output.finish()` is not idempotent (no double-call guard) — deferred to `deferred-work.md` (LOW; no current consumer can trigger; revisit when first command wires up `Output` in Story 2.x)
- [x] **Review · Defer** — `output.test.ts:166` `JSON.parse(raw)` throw assertion is value-fragile — deferred to `deferred-work.md` (LOW; works for current `'hi'` literal)
- [x] **Review · Defer** — Unicode `⚠` may render as `?` on non-UTF-8 Windows terminals — deferred to `deferred-work.md` (LOW; cross-OS verification belongs in Story 1.13's matrix)

## Dev Notes

### Architecture Layer for These Files

```
src/core/decision-schema.ts   ← PURE (no fs, no os, no process)
src/ui/output.ts              ← UI layer (writes stdout/stderr)
src/ui/prompts.ts             ← UI layer (wraps @clack/prompts)
```

Layer rule: `ui → commands → services → core`. Both `output.ts` and `prompts.ts` are in the UI layer and may import from `core/` but NOT from `services/` or `commands/`.

### `no-console-outside-output` Rule — Current State

The rule (`eslint-rules/no-console-outside-output.js`) already:
- Bans `console.log`, `console.error`, `console.warn` outside `src/ui/output.ts`
- Bans `process.stdout.write`, `process.stderr.write` outside `src/ui/output.ts`
- Allows both inside `src/ui/output.ts`

`src/ui/prompts.ts` does NOT call `console.*` or `process.stdout/stderr.write` directly — it calls `@clack/prompts` APIs which handle their own I/O. The rule does NOT need changes for `prompts.ts`.

### Installed Libraries

- `@clack/prompts@1.2.0` — **already in `package.json` dependencies**; no install needed
- `picocolors@1.1.1` — **already in `package.json` dependencies**; use for coloring in output.ts

Do NOT add new dependencies. Use what's already installed.

### `@clack/prompts@1.2.0` API

Read `node_modules/@clack/prompts/dist/index.d.ts` for the exact types. Key exports:

```typescript
import {
  multiselect,      // T[] | symbol
  select,           // T | symbol
  confirm,          // boolean | symbol
  isCancel,         // (val: unknown) => val is symbol
  cancel,           // (msg: string) => void — prints cancellation message
  spinner,          // () => { start(msg?), stop(msg?), message(msg?) }
} from '@clack/prompts';
```

`multiselect` options: `{ message, options: Array<{value, label, hint?, selected?}>, required? }`
`select` options: `{ message, options: Array<{value, label, hint?}> }`
`confirm` options: `{ message, initialValue? }`

**Ctrl+C pattern**:
```typescript
const result = await multiselect({ message: '...', options: [...] });
if (isCancel(result)) {
  cancel('Operation cancelled.');
  process.exit(130);
}
return result;
```

**IMPORTANT**: All @clack/prompts functions return `T | symbol`. `symbol` indicates Ctrl+C cancellation. Always check `isCancel(result)` before using the result.

### `Output` Class — Full Interface

```typescript
import pc from 'picocolors';
import type { CmemmovError } from '../core/error.js';

export interface ErrorRecord {
  code: string;
  file?: string;
  operation?: string;
  hint?: string;
}

export interface OutputResult {
  success: boolean;
  command: string;
  summary: string;
  errors: ErrorRecord[];
  warnings: string[];
}

export class Output {
  readonly #json: boolean;
  readonly #command: string;
  readonly #errors: ErrorRecord[] = [];
  readonly #warnings: string[] = [];

  constructor(command: string, opts: { json?: boolean } = {}) {
    this.#command = command;
    this.#json = opts.json ?? false;
  }

  progress(msg: string): void {
    process.stderr.write(msg + '\n');
  }

  warn(msg: string): void {
    this.#warnings.push(msg);
    process.stderr.write(pc.yellow('⚠ ' + msg) + '\n');
  }

  error(err: CmemmovError): void {
    const record: ErrorRecord = { code: err.code };
    if (err.file !== undefined) record.file = err.file;
    if (err.operation !== undefined) record.operation = err.operation;
    if (err.hint !== undefined) record.hint = err.hint;
    this.#errors.push(record);

    if (!this.#json) {
      // Human mode: format to stderr immediately
      const lines: string[] = [pc.red(pc.bold(`[${err.code}]`))];
      if (err.file !== undefined) lines.push('  file: ' + err.file);
      if (err.operation !== undefined) lines.push('  operation: ' + err.operation);
      if (err.hint !== undefined) lines.push('  hint: ' + err.hint);
      process.stderr.write(lines.join('\n') + '\n');
    }
    // JSON mode: buffered — emitted in finish()
  }

  finish(summary: string, success = true): void {
    if (this.#json) {
      const result: OutputResult = {
        success,
        command: this.#command,
        summary,
        errors: this.#errors,
        warnings: this.#warnings,
      };
      process.stdout.write(JSON.stringify(result) + '\n');
    } else {
      process.stdout.write(summary + '\n');
    }
  }
}
```

**Important**: `finish` writes ONCE to stdout. Commands call `output.progress(...)` / `output.warn(...)` / `output.error(...)` throughout, then call `output.finish(summary, success)` exactly once at the end.

### `picocolors` Usage

`picocolors` exposes: `pc.red(s)`, `pc.green(s)`, `pc.yellow(s)`, `pc.blue(s)`, `pc.bold(s)`, `pc.dim(s)`, `pc.cyan(s)`, etc.

```typescript
import pc from 'picocolors';
```

In JSON mode, avoid color codes in the `summary` and `errors` fields (they'd appear as escape sequences). Use colors only in stderr writes in human mode.

### `decision-schema.ts` — ClaudeCategory Move

`ClaudeCategory` is currently defined in `src/services/claude-writer.ts`. It needs to MOVE to `src/core/decision-schema.ts` because:
1. `core/` modules are pure and can be safely imported by both `ui/` and `services/`
2. `prompts.ts` (UI layer) needs `ClaudeCategory` for the category multi-select — it cannot import from `services/` (cross-layer violation)
3. `claude-writer.ts` (services) can import from `core/` (allowed direction)

After the move, `claude-writer.ts` must have:
```typescript
import type { ClaudeCategory } from '../core/decision-schema.js';
// Remove the local ClaudeCategory type definition
```

`claude-reader.ts` does NOT use `ClaudeCategory` — no change needed there.

### `FLAG_NAMES` Constant

```typescript
export const FLAG_NAMES = {
  categories: '--categories',
  includeCredentials: '--include-credentials',
  mode: '--mode',
  dryRun: '--dry-run',
  noIntegrityCheck: '--no-integrity-check',
  backupPath: '--backup',
} as const satisfies Record<string, string>;
```

The prompts module uses these to build error messages like `'--categories required in silent mode'`.

### `prompts.ts` — selectCategories Implementation Pattern

```typescript
import { multiselect, isCancel, cancel } from '@clack/prompts';
import { CmemmovError } from '../core/error.js';
import { type ClaudeCategory, ALL_CATEGORIES, FLAG_NAMES } from '../core/decision-schema.js';

export async function selectCategories(opts: {
  silent: boolean;
  value?: ClaudeCategory[];
}): Promise<ClaudeCategory[]> {
  if (opts.silent) {
    if (opts.value === undefined) {
      throw new CmemmovError({
        code: 'INTERNAL',
        hint: `${FLAG_NAMES.categories} required in silent mode`,
      });
    }
    return opts.value;
  }

  const result = await multiselect<ClaudeCategory>({
    message: 'Select categories to include:',
    options: ALL_CATEGORIES.map((c) => ({ value: c, label: c })),
    required: true,
  });

  if (isCancel(result)) {
    cancel('Operation cancelled.');
    process.exit(130);
  }

  return result;
}
```

Follow this exact pattern for each prompt function.

### `createSpinner` Wrapper

```typescript
export function createSpinner() {
  const s = spinner();
  return {
    start: (msg: string) => { s.start(msg); },
    stop: (msg: string) => { s.stop(msg); },
    fail: (msg: string) => { s.stop(msg); },  // clack stop with error-like message
  };
}
```

The spinner from @clack handles its own stderr output — no need to route through `Output`.

### Output Test Pattern — Capturing stdout/stderr

```typescript
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('Output', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes progress to stderr only', () => {
    const out = new Output('export', { json: false });
    out.progress('Reading...');
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Reading...'));
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it('finish writes exactly one line to stdout in human mode', () => {
    const out = new Output('export', { json: false });
    out.finish('Done!');
    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('Done!'));
  });
  
  it('finish emits valid JSON in json mode', () => {
    const out = new Output('export', { json: true });
    out.finish('Exported 3 projects', true);
    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const raw = (stdoutSpy.mock.calls[0] as [string])[0];
    const parsed = JSON.parse(raw) as { success: boolean; command: string; summary: string };
    expect(parsed.success).toBe(true);
    expect(parsed.command).toBe('export');
    expect(parsed.summary).toBe('Exported 3 projects');
  });
});
```

### Prompts Test Pattern — Mocking @clack/prompts

```typescript
import { vi, describe, it, expect } from 'vitest';

vi.mock('@clack/prompts', () => ({
  multiselect: vi.fn(),
  select: vi.fn(),
  confirm: vi.fn(),
  isCancel: vi.fn().mockReturnValue(false),
  cancel: vi.fn(),
  spinner: vi.fn().mockReturnValue({ start: vi.fn(), stop: vi.fn() }),
}));

import * as clack from '@clack/prompts';
import { selectCategories } from './prompts.js';
import { CmemmovError } from '../core/error.js';

it('returns value immediately in silent mode', async () => {
  const result = await selectCategories({ silent: true, value: ['globalMemory'] });
  expect(result).toEqual(['globalMemory']);
  expect(clack.multiselect).not.toHaveBeenCalled();
});

it('throws CmemmovError when silent + no value', async () => {
  await expect(selectCategories({ silent: true }))
    .rejects.toMatchObject({ code: 'INTERNAL' });
});

it('handles Ctrl+C by calling cancel and exiting 130', async () => {
  vi.mocked(clack.multiselect).mockResolvedValueOnce(Symbol('cancel'));
  vi.mocked(clack.isCancel).mockReturnValueOnce(true);
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
  await expect(selectCategories({ silent: false })).rejects.toThrow('exit');
  expect(clack.cancel).toHaveBeenCalledWith('Operation cancelled.');
  expect(exitSpy).toHaveBeenCalledWith(130);
  exitSpy.mockRestore();
});
```

### Previous Story Learnings (from Stories 1.6 and 1.7)

- **ESLint flat-config last-wins**: When adding restrictions to `eslint.config.js`, use a single merged block rather than separate blocks with the same rule name. Story 1.7 restructured `no-restricted-imports` for exactly this reason. If Story 1.8 needs ESLint changes, follow the same pattern.
- **`vi.mock` factory over `vi.spyOn` for ESM module namespace**: `vi.spyOn` cannot redefine properties on frozen ESM namespaces. For `@clack/prompts`, use `vi.mock('@clack/prompts', () => ({ ... }))` factory pattern.
- **Private class fields (`#field`)**: TypeScript supports `#` private fields and they work well with strict mode. Use `readonly #field` for immutable members.
- **`exactOptionalPropertyTypes: true`**: When building objects with optional fields conditionally (e.g., `ErrorRecord`), assign fields only when defined: `if (err.file !== undefined) record.file = err.file`.
- **`process.exit()` in tests**: Always spy on and mock `process.exit` when testing code that calls it; the `.mockImplementation(() => { throw new Error('exit'); })` pattern allows assertions after the exit call.
- **Wrap `JSON.parse` in try/catch**: The `finish` method in json mode calls `JSON.stringify` (no parse needed). But if the output module ever needs to parse, remember `no-raw-json-parse` would flag it — decide at that point whether to add an allowlist entry.

### Files to Create / Modify

| Action | Path |
|--------|------|
| CREATE | `src/core/decision-schema.ts` |
| CREATE | `src/core/decision-schema.test.ts` |
| CREATE | `src/ui/output.ts` |
| CREATE | `src/ui/output.test.ts` |
| CREATE | `src/ui/prompts.ts` |
| CREATE | `src/ui/prompts.test.ts` |
| UPDATE | `src/services/claude-writer.ts` (import ClaudeCategory from core) |
| DELETE | `src/ui/.gitkeep` |

No new npm packages needed — `@clack/prompts@1.2.0` and `picocolors@1.1.1` are already in `package.json`.

## Dev Agent Record

### Completion Notes

Implementation completed on 2026-05-09. All 9 tasks completed with full test coverage:

- **Task 1**: Created `src/core/decision-schema.ts` as the single source of truth for `ClaudeCategory`, `ALL_CATEGORIES`, `ImportMode`, the three decision interfaces (`ExportDecision`, `ImportDecision`, `RollbackDecision`), and `FLAG_NAMES`. Pure module with no fs/os/process imports.
- **Task 2**: Created `src/core/decision-schema.test.ts` with 8 tests covering canonical category list, flag-name mapping, and structural soundness (`satisfies` checks) of each decision interface.
- **Task 3**: Refactored `src/services/claude-writer.ts` to re-export `ClaudeCategory` from the core module (`export type { ClaudeCategory } from '../core/decision-schema.js'`). Used a re-export rather than a plain `import type` because the service file does not consume `ClaudeCategory` directly (it uses string-literal discriminants on each `*Opts` interface), and the lint rule `@typescript-eslint/no-unused-vars` would reject an unused import. The re-export preserves the original symbol path for potential consumers.
- **Task 4**: Created `src/ui/output.ts` with the `Output` class. Uses private class fields (`#json`, `#command`, `#errors`, `#warnings`). `progress`/`warn`/`error` route to `process.stderr.write`; `finish` writes exactly once to `process.stdout.write`. Human mode emits a colored `[CODE]` headline via `picocolors`; JSON mode emits a single `OutputResult` JSON object. Optional `ErrorRecord` fields are assigned conditionally to honor `exactOptionalPropertyTypes: true`.
- **Task 5**: Created `src/ui/output.test.ts` with 14 tests using `vi.spyOn(process.stdout, 'write')` and `vi.spyOn(process.stderr, 'write')`. Validates human/JSON modes, error formatting (both modes), warning buffering, single-write-per-finish discipline, no-interleaving discipline, and default options.
- **Task 6**: Created `src/ui/prompts.ts` wrapping `@clack/prompts`. Exports `selectCategories`, `selectMergeMode`, `confirmCredentials`, `confirmOverwrite`, and `createSpinner`. Each prompt branches on `silent`: returns `value` immediately when silent and value supplied; throws `CmemmovError({ code: 'INTERNAL', hint: '--FLAG required in silent mode' })` when silent and value missing (FLAG = the relevant CLI flag from `FLAG_NAMES`). Ctrl+C handling via `isCancel(result)` → `cancel('Operation cancelled.')` → `process.exit(130)`. Helper `bailOnCancel` and `requireSilentValue` keep the per-prompt code DRY.
- **Task 7**: Created `src/ui/prompts.test.ts` with 16 tests using `vi.mock('@clack/prompts', () => ({ ... }))` factory pattern (per Story 1.7 learning — `vi.spyOn` cannot redefine ESM namespace properties). Covers each prompt's three paths (silent+value, silent+missing, interactive) plus Ctrl+C handling for `selectCategories`, `selectMergeMode`, `confirmCredentials`. `process.exit` mocked to throw so assertions can run after the synthetic exit.
- **Task 8**: Deleted `src/ui/.gitkeep` (no longer needed once `output.ts` and `prompts.ts` populate the directory).
- **Task 9**: `npm run check` passes (lint + typecheck + 207 tests). Verified `ClaudeCategory` is defined exactly once (`src/core/decision-schema.ts`). Verified no `console.*` or `process.stdout/stderr.write` calls exist outside `src/ui/output.ts` (only test-file allowances).

**Acceptance Criteria mapped to tests:**

- AC1 (no interleaving in human mode) → `output.test.ts` "progress goes to stderr and finish goes to stdout — no interleaving"
- AC2 (single JSON object on stdout in --json) → `output.test.ts` "finish emits a single JSON object on stdout with the expected shape" + "json output never interleaves"
- AC3 (no-console-outside-output rule) → enforced by ESLint plugin from Story 1.2; verified by `npm run check` exit 0
- AC4 (CmemmovError surfaces structured fields) → `output.test.ts` "error writes structured details to stderr" + "error is buffered and surfaces in json errors[]" + "error in json mode omits undefined optional fields"
- AC5 (Ctrl+C handled with code 130) → `prompts.test.ts` Ctrl+C tests for each prompt; `process.exit(130)` asserted via spy
- AC6 (silent + value returns without prompting) → `prompts.test.ts` "returns the value immediately in silent mode without calling clack" for each prompt
- AC7 (silent + missing throws CmemmovError INTERNAL with --<flag> hint) → `prompts.test.ts` "throws CmemmovError(INTERNAL)..." tests
- AC8 (decision-schema parity surface; ClaudeCategory in core, not services) → `decision-schema.test.ts` plus the file/grep verification in Task 9

**Key decisions:**

- **Re-export ClaudeCategory from claude-writer.ts** rather than removing it entirely: the story instructs to "remove local definition and import" but TypeScript lint flagged the unused-import. Re-exporting from `../core/decision-schema.js` satisfies both the architectural intent (single source of truth in core) and the lint rule, while preserving the legacy import path.
- **Type cast `result as ClaudeCategory[]` after `bailOnCancel`** in `prompts.ts`: clack's API returns `T | symbol`, but after `isCancel(result)` causes `process.exit(130)` (which throws via the test mock or actually exits in production), narrowing past the symbol requires a cast since `bailOnCancel` is not a TypeScript assertion function. Could be made cleaner with `asserts result is ...` but the current form keeps the helper reusable across the four different return types.
- **`createSpinner` exposes `start/stop/fail` only**: matches the story's interface exactly. `fail` and `stop` both delegate to clack's `s.stop(msg)` since clack's spinner does not have a distinct error variant in v1.2.0; the wrapper's contract preserves the option to differentiate later.

### Change Log

| Date | Change | Author |
|------|--------|--------|
| 2026-05-09 | Story 1.8 implementation completed: created `decision-schema.ts`, `output.ts`, `prompts.ts` and tests; moved `ClaudeCategory` to core; deleted `src/ui/.gitkeep`. All 207 tests pass; `npm run check` exits 0. | dev-1-8 |

### File List

Created:

- `src/core/decision-schema.ts`
- `src/core/decision-schema.test.ts`
- `src/ui/output.ts`
- `src/ui/output.test.ts`
- `src/ui/prompts.ts`
- `src/ui/prompts.test.ts`

Modified:

- `src/services/claude-writer.ts` (removed local `ClaudeCategory` type definition; replaced with `export type { ClaudeCategory } from '../core/decision-schema.js'`)

Deleted:

- `src/ui/.gitkeep`
