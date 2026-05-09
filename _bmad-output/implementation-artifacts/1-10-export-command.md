# Story 1.10: Export Command

Status: done

## Story

As a Claude Code user (Alex),
I want to run `cmemmov export` interactively or via flags to produce a single `.cmemmov` JSON bundle of my chosen artifact categories and projects,
So that I can capture my full Claude Code environment for migration, backup, or version control without manual file editing.

## Acceptance Criteria

1. **Given** a populated `~/.claude/` and I run `cmemmov export` interactively
   **When** the command starts
   **Then** a category multi-select appears (FR1) showing all 10 categories: `globalMemory`, `projectMemory`, `globalSettings`, `projectSettings`, `claudeMd`, `mcpConfig`, `customCommands`, `teams`, `plugins`, `sessionHistory`

2. **Given** the same interactive flow
   **When** I confirm category selection
   **Then** a per-project multi-select appears (FR2) showing decoded original paths from session `cwd`; an `--all-projects` flag bypasses this prompt (FR3)

3. **Given** default export
   **When** it runs
   **Then** session history is excluded by default (FR4); the user can opt in via `--include-sessions`

4. **Given** default export
   **When** it runs
   **Then** credentials are excluded by default (FR5); the user can opt in via `--include-credentials`

5. **Given** `cmemmov export --include-credentials`
   **When** the command begins
   **Then** a prominent stderr warning appears BEFORE the bundle is written (NFR9), and the resulting bundle includes a top-level `warning` metadata field naming credential inclusion

6. **Given** export completes successfully
   **When** I inspect the output
   **Then** a single `.cmemmov` JSON bundle file is produced (FR6) at the path supplied by `--output <path>` (FR7) or at the default `claude-export-<YYYY-MM-DD>.cmemmov` in the current working directory

7. **Given** an export bundle
   **When** I open it in a text editor
   **Then** it is human-readable JSON (FR30); each project entry includes `originalPath` (FR27); top-level metadata includes a Claude Code version fingerprint derived from the installed Claude Code (FR28)

8. **Given** `cmemmov export --silent --categories globalMemory,globalSettings --projects all --output ./e.cmemmov`
   **When** the command runs
   **Then** no prompts appear; decisions populate from flags (FR31); the bundle is produced
   **And** if `--categories` is missing in silent mode, the command exits 2 with a structured error naming the missing flag

9. **Given** `cmemmov export --json`
   **When** the command runs
   **Then** progress messages go to stderr and a single JSON object is emitted to stdout on completion with `success`, `command: 'export'`, `summary`, `errors`, `warnings` (FR32, FR33)

10. **Given** a long-running export with sessions
    **When** it runs
    **Then** incremental progress lines are emitted to stderr at category and project boundaries (FR36)

11. **Given** an export where no categories were selected
    **When** it runs
    **Then** it throws `CmemmovError({ code: 'EXPORT_NOTHING_SELECTED' })`

12. **Given** an export bundle and the user's selection
    **When** I diff bundle contents against the selection
    **Then** the bundle contains nothing beyond the explicitly selected categories and projects (NFR8)

13. **Given** a project for which `resolveOriginalPath` returns `source: 'slugDecode'` or `source: null`
    **When** the per-project multi-select is presented interactively
    **Then** the project entry is labeled `<decoded-path>  (best-effort — no sessions)` for `source: 'slugDecode'` and `<slug-verbatim>  (path unknown)` for `source: null`
    **And** before the project is included in the bundle, the user is prompted to confirm the path or type a corrected one; the confirmed/corrected path is what the bundle records as `originalPath`

14. **Given** a memory-only project in `--silent` mode
    **When** no `--project-path <slug>=<path>` flag is provided for that project
    **Then** the command exits 2 with `CmemmovError({ code: 'PATH_REMAP_AMBIGUOUS', hint: '--project-path <slug>=<path> required for memory-only project <slug>' })`

---

## Dev Notes

### Architecture Layer

```
src/commands/export.ts          ← command orchestrator (orchestrates all services)
src/commands/export-selection.ts ← interactive helpers + bundle construction
src/cli.ts                      ← UPDATE: add export-specific subcommand options
src/core/bundle-schema.ts       ← UPDATE: extend GlobalSchema and ProjectSchema
src/core/decision-schema.ts     ← UPDATE: extend ExportDecision + FLAG_NAMES
src/ui/prompts.ts               ← UPDATE: add promptOriginalPath()
```

Layer compliance: `commands/ → services/ → core/`. Export command imports from services and core — never from ui/output directly (use Output class injected via the run() call).

### Files Created / Updated

| Action | Path |
|--------|------|
| UPDATE | `src/commands/export.ts` (replace placeholder) |
| CREATE | `src/commands/export.test.ts` |
| CREATE | `src/commands/export-selection.ts` |
| CREATE | `src/commands/export-selection.test.ts` |
| UPDATE | `src/cli.ts` (add export subcommand options) |
| UPDATE | `src/core/bundle-schema.ts` (extend schemas for all 10 categories) |
| UPDATE | `src/core/decision-schema.ts` (extend ExportDecision + FLAG_NAMES) |
| UPDATE | `src/ui/prompts.ts` (add promptOriginalPath) |

### `bundle-schema.ts` — Required Extensions

The current `GlobalSchema` and `ProjectSchema` are missing fields for `claudeMd`, `customCommands`, `teams`, `plugins`, `mcpConfig`, and `warning`. Extend them:

```typescript
// Add alongside MemoryFileSchema:
const CommandFileSchema = z.object({
  filename: z.string(),
  content: z.string(),
}).strict();

// Extend GlobalSchema:
const GlobalSchema = z.object({
  settings: z.unknown().optional(),         // globalSettings (full settings.json)
  claudeJson: z.unknown().optional(),        // ~/.claude.json
  memories: z.array(MemoryFileSchema).optional(),  // globalMemory
  claudeMd: z.string().optional(),           // claudeMd (global CLAUDE.md content)
  customCommands: z.array(CommandFileSchema).optional(),  // customCommands
  teams: z.unknown().optional(),             // teams
  plugins: z.unknown().optional(),           // plugins
  mcpConfig: z.unknown().optional(),         // mcpConfig (mcpServers portion only, when selected without globalSettings)
}).strict();

// Extend ProjectSchema:
export const ProjectSchema = z.object({
  slug: z.string(),
  originalPath: z.string(),
  settings: z.unknown().optional(),          // projectSettings
  memories: z.array(MemoryFileSchema).optional(),  // projectMemory
  claudeMd: z.string().optional(),           // claudeMd (per-project CLAUDE.md content)
  sessions: z.array(SessionFileSchema).optional(),  // sessionHistory
}).strict();

// Extend BundleSchema — add `warning` field:
export const BundleSchema = z.object({
  version: z.string(),
  exportedAt: z.string().datetime(),
  sourcePlatform: z.enum(['win32', 'darwin', 'linux']),
  claudeVersion: z.string(),
  hasCredentials: z.boolean(),
  warning: z.string().optional(),            // populated when --include-credentials used
  integrity: z.string().optional(),
  projects: z.array(ProjectSchema),
  global: GlobalSchema,
  credentials: CredentialsSchema.optional(),
}).strict();
```

**Export-compatible types** — add to bundle-schema.ts exports:
```typescript
export type CommandFile = z.infer<typeof CommandFileSchema>;
```

**IMPORTANT**: `.strict()` is used on ALL schemas — do NOT add extra fields that aren't in the schema. After this extension, the Story 1.6 bundle-parser tests still pass because all new fields are `.optional()`.

### `decision-schema.ts` — Required Extensions

Extend `ExportDecision` and `FLAG_NAMES`:

```typescript
export interface ExportDecision {
  categories: ClaudeCategory[];
  includeCredentials: boolean;
  outputPath: string;
  silent: boolean;
  json: boolean;
  allProjects: boolean;                   // NEW: --all-projects skips project picker
  projects: string[];                     // NEW: explicit slugs or [] for interactive
  projectPaths: Record<string, string>;   // NEW: slug→originalPath overrides (--project-path slug=path)
}

export const FLAG_NAMES = {
  categories: '--categories',
  includeCredentials: '--include-credentials',
  mode: '--mode',
  dryRun: '--dry-run',
  noIntegrityCheck: '--no-integrity-check',
  backupPath: '--backup',
  force: '--force',
  output: '--output',                     // NEW
  allProjects: '--all-projects',          // NEW
  projects: '--projects',                 // NEW
  projectPath: '--project-path',          // NEW
  includeSessions: '--include-sessions',  // NEW (shorthand for adding sessionHistory to categories)
} as const satisfies Record<string, string>;
```

### `cli.ts` — Export Subcommand Options

Update `buildProgram()` so the export command declaration captures its specific options. The dynamic import pattern from Story 1.9 is preserved; only the action handler changes to pass options:

```typescript
// In buildProgram():
const exportCmd = program
  .command('export')
  .description('Export your Claude Code environment to a bundle file')
  .option('--categories <list>', 'comma-separated categories (camelCase or kebab-case; default: all except sessionHistory)')
  .option('--output <path>', 'output file path (default: claude-export-YYYY-MM-DD.cmemmov in cwd)')
  .option('--include-credentials', 'include credentials in bundle (emits warning)')
  .option('--include-sessions', 'include session history in bundle')
  .option('--all-projects', 'include all projects without prompting')
  .option('--projects <list>', 'comma-separated project slugs, or "all"')
  .option('--project-path <spec>', 'provide originalPath for a memory-only project (slug=path)', parseProjectPath, {} as Record<string, string>);

exportCmd.action(async () => {
  const allOpts = exportCmd.optsWithGlobals<ExportCLIOpts>();
  const { run } = await import('./commands/export.js');
  await run(allOpts);
});
```

Add these types and helpers to `cli.ts` (keep them local, not exported, since they're CLI plumbing):

```typescript
interface GlobalCLIOpts {
  silent?: boolean;
  json?: boolean;
  dryRun?: boolean;
}

interface ExportCLIOpts extends GlobalCLIOpts {
  categories?: string;       // raw comma-separated string from commander
  output?: string;
  includeCredentials?: boolean;
  includeSessions?: boolean;
  allProjects?: boolean;
  projects?: string;         // raw comma-separated string from commander
  projectPath?: Record<string, string>;  // accumulated by parseProjectPath reducer
}

function parseProjectPath(val: string, prev: Record<string, string>): Record<string, string> {
  const eqIdx = val.indexOf('=');
  if (eqIdx < 1) return prev;
  const slug = val.slice(0, eqIdx);
  const path = val.slice(eqIdx + 1);
  return { ...prev, [slug]: path };
}
```

**Commander option type nuances**: boolean options declared with `.option('--include-credentials', ...)` (no `<value>`) result in `undefined` when absent and `true` when present. Do NOT use `?? false` before receiving in the run() function — use `=== true` or explicit boolean coercion.

### `prompts.ts` — Add `promptOriginalPath`

Add this new exported function to handle the memory-only project path confirmation:

```typescript
export async function promptOriginalPath(opts: {
  slug: string;
  suggestedPath: string;
  silent: boolean;
  value?: string;
}): Promise<string> {
  if (opts.silent) {
    if (opts.value === undefined) {
      throw new CmemmovError({
        code: 'PATH_REMAP_AMBIGUOUS',
        hint: `${FLAG_NAMES.projectPath} <slug>=<path> required for memory-only project ${opts.slug}`,
      });
    }
    return opts.value;
  }

  // Import text from @clack/prompts — it's already in dependencies
  const { text } = await import('@clack/prompts');
  const result = await text({
    message: `Original path for project ${opts.slug}:`,
    placeholder: opts.suggestedPath,
    initialValue: opts.suggestedPath,
    validate: (v) => (v.trim().length === 0 ? 'Path cannot be empty' : undefined),
  });

  bailOnCancel<string>(result);
  return result.trim();
}
```

**Note**: `@clack/prompts@1.2.0` exports `text` for single-line text input. Import it dynamically inside the function body to avoid adding it to the eager imports of `prompts.ts`.

Actually, looking at the `@clack/prompts` package — check `node_modules/@clack/prompts/dist/index.d.ts` for the `text` export signature before implementing. If `text` isn't exported, use `select` with a free-text option instead.

### `export-selection.ts` — Module Responsibilities

This module handles:
1. **`parseCategories(raw: string): ClaudeCategory[]`** — normalizes comma-separated flag value to `ClaudeCategory[]`
2. **`detectClaudeVersion(projects: ProjectSurface[]): string`** — extracts version from session JSONL
3. **`selectProjectsForExport(opts)`** — interactive or silent project selection
4. **`buildBundle(surface, decision, claudeVersion)`** — assembles `Bundle` from surface + decisions
5. **`defaultOutputPath(): string`** — returns `claude-export-YYYY-MM-DD.cmemmov` in cwd

#### `parseCategories` — normalization table

The CLI accepts both camelCase and kebab-case aliases:

| CLI alias | `ClaudeCategory` |
|-----------|-----------------|
| `globalMemory` or `global-memory` | `globalMemory` |
| `projectMemory` or `project-memory` | `projectMemory` |
| `globalSettings` or `global-settings` or `settings` | `globalSettings` |
| `projectSettings` or `project-settings` | `projectSettings` |
| `claudeMd` or `claude-md` | `claudeMd` |
| `mcpConfig` or `mcp-config` or `mcp` | `mcpConfig` |
| `customCommands` or `custom-commands` or `commands` | `customCommands` |
| `teams` | `teams` |
| `plugins` | `plugins` |
| `sessionHistory` or `session-history` | `sessionHistory` |
| `all` | all 10 categories |

Unknown aliases → throw `CmemmovError({ code: 'INTERNAL', hint: 'unknown category: <alias>' })`.

#### `detectClaudeVersion` — version fingerprint (FR28)

Read the `version` field from any session JSONL line:

```typescript
export function detectClaudeVersion(projects: ProjectSurface[]): string {
  for (const project of projects) {
    for (const session of project.sessions ?? []) {
      for (const line of session.lines) {
        try {
          const obj = JSON.parse(line) as unknown;
          if (typeof obj === 'object' && obj !== null) {
            const ver = (obj as Record<string, unknown>).version;
            if (typeof ver === 'string' && ver.length > 0) {
              return ver;
            }
          }
        } catch { /* skip malformed line */ }
      }
    }
  }
  return 'unknown';
}
```

**Note**: This function uses `JSON.parse` on session JSONL lines. The `no-raw-json-parse` ESLint rule bans `JSON.parse` everywhere except `bundle-parser.ts` and `claude-reader.ts`. You MUST add `src/commands/export-selection.ts` to the rule's allowlist in `eslint-rules/no-raw-json-parse.js`. Check that file — it has a `ALLOWED_SUFFIXES` array.

#### `buildBundle` — category-to-bundle-field mapping

Each selected `ClaudeCategory` populates specific fields:

```typescript
export function buildBundle(
  surface: ClaudeSurface,
  decision: ExportDecision,
  claudeVersion: string,
  selectedSlugs: string[],  // the resolved project slugs to include
  projectOriginalPaths: Map<string, string>,  // slug → confirmed originalPath
): Bundle {
  const cats = new Set(decision.categories);

  // Per-project assembly
  const projects: Project[] = selectedSlugs.map((slug) => {
    const proj = surface.projects.find((p) => p.slug === slug);
    const originalPath = projectOriginalPaths.get(slug) ?? slug;
    const entry: Project = { slug, originalPath };
    if (cats.has('projectSettings') && proj?.settings !== undefined)
      entry.settings = proj.settings;
    if (cats.has('projectMemory') && proj && proj.memories.length > 0)
      entry.memories = proj.memories;
    if (cats.has('claudeMd') && proj?.claudeMd !== undefined)
      entry.claudeMd = proj.claudeMd;
    if (cats.has('sessionHistory') && proj && proj.sessions.length > 0)
      entry.sessions = proj.sessions;
    return entry;
  });

  // Global assembly
  const global: Global = {};
  if (cats.has('globalSettings') && surface.globalSettings !== undefined)
    global.settings = surface.globalSettings;
  if (cats.has('globalMemory') && surface.globalMemory.length > 0)
    global.memories = surface.globalMemory;
  if (cats.has('claudeMd') && surface.claudeMd !== undefined)
    global.claudeMd = surface.claudeMd;
  if (cats.has('customCommands') && surface.customCommands.length > 0)
    global.customCommands = surface.customCommands;
  if (cats.has('teams') && surface.teams !== undefined)
    global.teams = surface.teams;
  if (cats.has('plugins') && surface.plugins !== undefined)
    global.plugins = surface.plugins;
  if (cats.has('mcpConfig') && !cats.has('globalSettings') && surface.mcpConfig !== undefined)
    global.mcpConfig = surface.mcpConfig;
  if (surface.claudeJson !== undefined)
    global.claudeJson = surface.claudeJson;   // always included if present

  // Credentials
  let credentials: Bundle['credentials'];
  if (decision.includeCredentials && surface.credentialsRef !== undefined) {
    // credentials content is read separately (pass it in via the decision or surface extension)
    // See export.ts flow below
  }

  const bundle: Bundle = {
    version: BUNDLE_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    sourcePlatform: process.platform as 'win32' | 'darwin' | 'linux',
    claudeVersion,
    hasCredentials: decision.includeCredentials,
    projects,
    global,
  };

  if (decision.includeCredentials) {
    bundle.warning = 'This bundle contains credentials. Do not share publicly.';
  }

  return bundle;
}
```

**Type import note**: `Global` and `Project` types come from `'../core/bundle-schema.js'` (via `z.infer`). `BUNDLE_FORMAT_VERSION` also from there. `ClaudeSurface` from `'../services/claude-reader.js'`.

#### `mcpConfig` vs `globalSettings` overlap

When the user selects `mcpConfig` but NOT `globalSettings`:
- `global.mcpConfig` gets `surface.mcpConfig` (just the `mcpServers` portion)
- `global.settings` stays `undefined`

When the user selects BOTH `globalSettings` and `mcpConfig`:
- `global.settings` gets the full `surface.globalSettings` (which includes `mcpServers`)
- `global.mcpConfig` is NOT set separately (it's already embedded in `settings`)

The conditional `!cats.has('globalSettings')` guard in the buildBundle example above handles this.

### `export.ts` — Full Command Orchestration

```typescript
import { writeFile } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { locateClaude } from '../services/claude-locator.js';
import { readClaudeSurface, resolveOriginalPath } from '../services/claude-reader.js';
import { serializeBundle } from '../services/bundle-serializer.js';
import { applySanitization } from '../core/sanitization-rules.js';
import { Output } from '../ui/output.js';
import { selectCategories, confirmCredentials, createSpinner, promptOriginalPath } from '../ui/prompts.js';
import { CmemmovError } from '../core/error.js';
import {
  parseCategories,
  detectClaudeVersion,
  selectProjectsForExport,
  buildBundle,
  defaultOutputPath,
} from './export-selection.js';
```

**Credentials content**: `ClaudeSurface.credentialsRef` holds the path to the credentials file (or `undefined` if absent). To include credentials in the bundle, read the file:
```typescript
const credContent = surface.credentialsRef !== undefined
  ? await readFile(surface.credentialsRef, 'utf8')
  : undefined;
```
Then pass the parsed content to `buildBundle`. The exact bundle shape for credentials is `{ content: parsedJson, wasRedacted: false }`.

**Full run() flow**:
```
1. Parse CLI opts → ExportDecision (normalize categories, parse project-path, etc.)
2. Locate Claude (locateClaude())
3. Construct Output(command, json)
4. Read surface (readClaudeSurface())
5. Resolve originalPaths for all projects
6. Select categories (interactive or from --categories flag)
7. Validate: categories.length > 0 or throw EXPORT_NOTHING_SELECTED
8. Add sessionHistory if --include-sessions and not already in categories
9. Select projects (interactive or --all-projects/--projects)
10. For memory-only projects: prompt for path confirmation (interactive) or check --project-path (silent)
11. Confirm credentials opt-in (interactive confirmCredentials or --include-credentials flag)
12. If includeCredentials: warn on stderr BEFORE write
13. Read credentials file content if includeCredentials
14. Build bundle
15. Sanitize (if !includeCredentials: applySanitization('redact-credentials'))
16. Serialize
17. Write bytes to outputPath
18. output.finish(summary, true)
```

**Determining outputPath**: `opts.output ?? defaultOutputPath()`.

`defaultOutputPath()` returns `path.join(process.cwd(), `claude-export-${new Date().toISOString().slice(0,10)}.cmemmov`)`.

**Writing the output file**: use `fs/promises.writeFile(outputPath, bytes)` directly — NOT through WriteGate. WriteGate is for writes to the user's `~/.claude/` directory. The export bundle is an output artifact.

### `selectProjectsForExport` — Interactive + Silent

```typescript
export async function selectProjectsForExport(opts: {
  surface: ClaudeSurface;
  pathResults: Map<string, OriginalPathResult>;
  silent: boolean;
  allProjects: boolean;
  projects: string[];   // empty = interactive
}): Promise<string[]> {
  if (opts.allProjects || (opts.silent && opts.projects.length === 0)) {
    return opts.surface.projects.map((p) => p.slug);
  }

  if (opts.silent) {
    // --projects specified explicitly
    if (opts.projects.includes('all')) {
      return opts.surface.projects.map((p) => p.slug);
    }
    return opts.projects; // validate slugs exist — caller should check
  }

  // Interactive multi-select
  const options = opts.surface.projects.map((p) => {
    const result = opts.pathResults.get(p.slug);
    let label: string;
    if (result === undefined || result.source === null) {
      label = `${p.slug}  (path unknown)`;
    } else if (result.source === 'slugDecode') {
      label = `${result.path}  (best-effort — no sessions)`;
    } else {
      label = result.path;
    }
    return { value: p.slug, label };
  });

  // ... use multiselect from @clack/prompts via selectCategories pattern
}
```

For the interactive multi-select over projects, you can add a `selectProjects` function to `prompts.ts` following the same pattern as `selectCategories` (no silent path needed since callers always gate on silent before reaching this).

### Category → ClaudeSurface field mapping reference

| Category | `ClaudeSurface` field | Bundle destination |
|----------|----------------------|-------------------|
| `globalMemory` | `surface.globalMemory` (MemoryFile[]) | `bundle.global.memories` |
| `globalSettings` | `surface.globalSettings` (unknown) | `bundle.global.settings` |
| `mcpConfig` | `surface.mcpConfig` (unknown) | `bundle.global.mcpConfig` (only when globalSettings not selected) |
| `claudeMd` (global) | `surface.claudeMd` (string\|undefined) | `bundle.global.claudeMd` |
| `customCommands` | `surface.customCommands` (CommandFile[]) | `bundle.global.customCommands` |
| `teams` | `surface.teams` (unknown) | `bundle.global.teams` |
| `plugins` | `surface.plugins` (unknown) | `bundle.global.plugins` |
| `projectMemory` | `surface.projects[*].memories` | `bundle.projects[*].memories` |
| `projectSettings` | `surface.projects[*].settings` | `bundle.projects[*].settings` |
| `claudeMd` (project) | `surface.projects[*].claudeMd` | `bundle.projects[*].claudeMd` |
| `sessionHistory` | `surface.projects[*].sessions` | `bundle.projects[*].sessions` |
| credentials | read from `surface.credentialsRef` | `bundle.credentials` |

**`claudeJson`**: always included in `bundle.global.claudeJson` if present — it's needed for import path remapping regardless of category selection. It is NOT exposed as a user-selectable category.

### ESLint Compliance

- `export-selection.ts` uses `JSON.parse` in `detectClaudeVersion` → add `src/commands/export-selection.ts` to `eslint-rules/no-raw-json-parse.js` ALLOWED_SUFFIXES
- `export.ts` uses `process.platform` → NOT banned (only `process.env.HOME` is banned)  
- `export.ts` uses `fs/promises` writeFile → ALLOWED (only write-gate fs operations are banned in services; command modules may use fs directly)
- Do NOT use `console.*` or `process.stdout/stderr.write` directly — use `out.progress()`, `out.warn()`, `out.error()`, `out.finish()` from `Output`

**CRITICAL**: Check `eslint-rules/no-raw-json-parse.js` for the exact `ALLOWED_SUFFIXES` format before adding the allowlist entry. Mirror the existing entries exactly.

### `no-raw-json-parse` ESLint rule — current allowlist

From Story 1.7 and 1.6, the rule allows `JSON.parse` in:
- `bundle-parser.ts`
- `claude-reader.ts`
- `*.test.ts` (test files)

Add `export-selection.ts` to this list (check the actual file at `eslint-rules/no-raw-json-parse.js` for the exact format).

### Test Strategy

**`export-selection.test.ts`** — unit tests (all pure functions, no FS):
- `parseCategories`: test each alias, `all`, unknown alias throws, camelCase and kebab-case
- `detectClaudeVersion`: returns version from first session line, falls back to 'unknown', skips malformed lines
- `buildBundle`: each category populates the correct bundle field; empty categories produce empty arrays; mcpConfig without globalSettings uses mcpConfig field; credentials warning field

**`export.test.ts`** — command integration tests (mock all services):
- Mock `claude-locator.ts` (returns fixed claudeDir/claudeJson)
- Mock `claude-reader.ts` (`readClaudeSurface`, `resolveOriginalPath`)
- Mock `bundle-serializer.ts` (`serializeBundle` → returns fixed Buffer)
- Mock `fs/promises` (`writeFile`) — capture the call args
- Mock `ui/prompts.ts` — inject decisions without real @clack interaction
- Spy on `process.stdout/stderr.write`

Key test cases:
1. AC1/AC2: interactive mode calls `selectCategories` and `selectProjectsForExport`
2. AC3: `sessionHistory` not in default interactive selection
3. AC4/AC5: credential opt-in path — warn before write, bundle.warning set, bundle.hasCredentials true
4. AC6: output file written to `--output` path OR default path
5. AC7: bundle has `claudeVersion`, `originalPath` per project
6. AC8: silent mode — no prompts called when all flags provided; throws INTERNAL for missing `--categories`
7. AC11: empty categories → EXPORT_NOTHING_SELECTED
8. AC12: bundle contains only selected categories (NFR8)
9. AC13: slugDecode project shows "(best-effort)" label and calls promptOriginalPath
10. AC14: memory-only project in silent mode without --project-path → PATH_REMAP_AMBIGUOUS

### Previous Story Learnings (Stories 1.8 and 1.9)

- **`await Promise.resolve()` in async functions with only a throw**: TypeScript's `require-await` rule fires on `async` functions that don't actually `await` anything. Pattern from Story 1.9 placeholders — use `await Promise.resolve()` before the throw.
- **`vi.mock` for ESM modules**: use factory pattern `vi.mock('./service.js', () => ({ fn: vi.fn() }))`. For modules that export multiple functions, name each one explicitly.
- **`vi.hoisted` for mutable state in mock factories**: if a test needs to change mock behavior between tests, use `vi.hoisted(() => ({ ... }))` and reference it in factory closures.
- **`process.exit` in tests**: always mock as `() => { throw new Error('exit') }` with `vi.spyOn(process, 'exit')`.
- **`exactOptionalPropertyTypes: true`**: assign optional bundle fields conditionally. Never assign `undefined` explicitly; use `if (x !== undefined) obj.field = x`.
- **`no-console-outside-output` rule**: ANY use of `console.*` in command modules will fail lint. Use `out.progress()`, `out.warn()` only.
- **Commander `optsWithGlobals()`**: use this to get both local and parent (global) options in one object. The types need to be declared explicitly.
- **Static-literal `await import()`**: esbuild requires the import path to be a string literal. Do NOT build paths dynamically.
- **Story 1.7's `resolveOriginalPath`**: returns `{ path: string, source: 'sessionCwd'|'slugDecode'|null }`. The `path` field is always populated (slug verbatim when source is null). Memory-only projects have `source: 'slugDecode'` or `source: null`.

### Key Invariants to Preserve

The Story 1.6 bundle-parser tests use bundles that DON'T have `claudeMd`, `customCommands`, etc. After extending the schemas with optional fields, those tests still pass because `.optional()` means the field is allowed to be absent during parsing. **DO NOT** make any previously-optional field required.

Story 1.9's `cli.ts` still works — you're only ADDING options to the export subcommand, not changing the structure of `buildProgram()` or `main()`. The `exportCmd.action()` replaces the bare `.action()` by capturing the cmd reference. All other commands remain as-is.

### `@clack/prompts` — `text` export verification

Before implementing `promptOriginalPath`, run:
```typescript
// Check if 'text' is exported from @clack/prompts:
// Look at: node_modules/@clack/prompts/dist/index.d.ts
```

If `text` is NOT exported, implement the path confirmation using `select` with a special "type your own path" option plus a follow-up `text` prompt, or use node's `readline` as a fallback. Do NOT invent API methods that don't exist.

---

## Dev Agent Record

### Completion Notes

Implemented the `cmemmov export` command end-to-end per all 14 ACs. All 279 tests pass, lint clean, typecheck clean.

**Key design decisions:**
- Bundle output uses `fs/promises.writeFile` directly (not WriteGate) since the export bundle is an output artifact written outside `~/.claude/`. Added an ESLint override block in `eslint.config.js` for `src/commands/export.ts` to permit this single import while preserving the `homedir` restriction.
- `JSON.parse` for session JSONL `version` extraction lives in `export-selection.ts::detectClaudeVersion`; added to the `no-raw-json-parse` ESLint allowlist.
- Credentials file parsing uses the existing `readClaudeJsonFile` from `claude-reader.ts` rather than re-implementing JSON.parse. Files that fail to parse yield `bundle.credentials.content === null`.
- The interactive flow in `selectCategories`/`selectProjects` lives in `ui/prompts.ts`; project labels show `(best-effort — no sessions)` for `slugDecode` and `(path unknown)` for `null`-source per AC13.
- `mcpConfig` is only set on the bundle when `globalSettings` is NOT also selected (story `mcpConfig` overlap rule).
- `promptOriginalPath` throws `PATH_REMAP_AMBIGUOUS` (not `INTERNAL`) when called in silent mode without a `--project-path` override, matching AC14.
- Updated `cli.test.ts` AC6 and AC7 placeholder lists to remove `export` since it is now a real command (consistent with the same pattern used when other placeholders are completed).

**Files Created**
- `src/commands/export-selection.ts` — `parseCategories`, `detectClaudeVersion`, `defaultOutputPath`, `buildBundle`
- `src/commands/export-selection.test.ts` — 25 unit tests
- `src/commands/export.test.ts` — 19 integration tests (mocks claude-locator, claude-reader, bundle-serializer, ui/prompts, fs/promises writeFile)

**Files Modified**
- `src/commands/export.ts` — replaced placeholder with full orchestration
- `src/cli.ts` — added export-specific subcommand options + `parseProjectPath` reducer; switched from bare `.action()` to `optsWithGlobals<ExportCLIOpts>()` pattern
- `src/core/bundle-schema.ts` — added `CommandFileSchema`, `claudeMd`/`customCommands`/`teams`/`plugins`/`mcpConfig` to `GlobalSchema`, `claudeMd` to `ProjectSchema`, `warning` to `BundleSchema`; added `CommandFile` type export
- `src/core/decision-schema.ts` — extended `ExportDecision` with `allProjects`, `projects`, `projectPaths`; extended `FLAG_NAMES` with `output`, `allProjects`, `projects`, `projectPath`, `includeSessions`
- `src/core/decision-schema.test.ts` — updated `ExportDecision` satisfies test, added new flag assertions
- `src/ui/prompts.ts` — added `selectProjects` and `promptOriginalPath`; imported `text` from `@clack/prompts`
- `src/ui/prompts.test.ts` — added clack `text` mock + new test blocks for `selectProjects` and `promptOriginalPath`
- `src/cli.test.ts` — removed `export` from placeholder lists (AC6, AC7) since it is now implemented
- `eslint-rules/no-raw-json-parse.js` — allowlisted `src/commands/export-selection.ts` for `JSON.parse` of session JSONL lines
- `eslint.config.js` — added override block for `src/commands/export.ts` to allow direct `fs/promises.writeFile` for the output bundle artifact

### File List

- `src/commands/export.ts` (modified)
- `src/commands/export.test.ts` (created)
- `src/commands/export-selection.ts` (created)
- `src/commands/export-selection.test.ts` (created)
- `src/cli.ts` (modified)
- `src/cli.test.ts` (modified)
- `src/core/bundle-schema.ts` (modified)
- `src/core/decision-schema.ts` (modified)
- `src/core/decision-schema.test.ts` (modified)
- `src/ui/prompts.ts` (modified)
- `src/ui/prompts.test.ts` (modified)
- `eslint-rules/no-raw-json-parse.js` (modified)
- `eslint.config.js` (modified)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified — story status transition)

### Change Log

| Date | Change | Author |
|------|--------|--------|
| 2026-05-09 | Story created | bmad-create-story |
| 2026-05-09 | Implementation complete; status backlog → in-progress → review | bmad-dev-story |
| 2026-05-09 | Code review (HIGH/MEDIUM auto-resolved; status review → done) | bmad-code-review |

### Review Findings (2026-05-09)

Adversarial review surfaced 18 findings. HIGH/MEDIUM patches applied automatically; LOW items either patched (trivial cleanup) or deferred to `_bmad-output/implementation-artifacts/deferred-work.md`. 286/286 tests pass; lint clean; typecheck clean.

- [x] [Review][Patch] HIGH — `--include-sessions` interactively without `--categories` skipped category multi-select (AC1/AC3 violation). Root cause: `buildDecision` injected `sessionHistory` into otherwise-empty `categories`, then `chooseCategories` saw non-empty and bypassed the prompt. Fix: removed eager injection from `buildDecision`; `run()`'s post-prompt injection at lines 207-210 now handles flag uniformly. [src/commands/export.ts:47-83]
- [x] [Review][Patch] MEDIUM — Silent-mode `--projects` did not validate slug existence; phantom slugs produced bundle entries with no real data. Fix: added `validateProjectSlugs()` that throws `CmemmovError({code:'INTERNAL', hint:'unknown project slug(s): ...'})` before returning silent/non-silent slug lists. [src/commands/export.ts:101-110]
- [x] [Review][Patch] MEDIUM — `--project-path` override silently ignored when project source was `sessionCwd`. Fix: override now wins regardless of source; new `if (override !== undefined)` short-circuit in `resolveProjectPaths` precedes source-based branching. [src/commands/export.ts:resolveProjectPaths]
- [x] [Review][Patch] MEDIUM — `parseProjectPath` accepted empty path (`slug=`) and silent code path bundled an empty `originalPath`. Fix: empty override now throws `PATH_REMAP_AMBIGUOUS` with the offending slug in the hint. [src/commands/export.ts:resolveProjectPaths]
- [x] [Review][Patch] MEDIUM — `process.platform as 'win32'|'darwin'|'linux'` was a lying cast; bundles created on unsupported OSes (freebsd, sunos, etc.) violated `BundleSchema.sourcePlatform` enum silently. Fix: `assertSupportedPlatform()` runtime check throws `INTERNAL` with the offending platform name. [src/commands/export-selection.ts:13-22, buildBundle]
- [x] [Review][Patch] LOW — `--all-projects` + `--projects` both passed: `--projects` was silently ignored. Fix: emit stderr warning naming the ignored flag. [src/commands/export.ts:chooseProjects]
- [x] [Review][Patch] LOW — Duplicate `--projects a,a` produced duplicate bundle entries. Fix: dedupe via `Set` after parsing the comma-separated list. [src/commands/export.ts:buildDecision]
- [x] [Review][Patch] LOW — `--include-credentials` with no credentials file produced `hasCredentials:true` and silent empty bundle.credentials. Fix: emit second stderr warning ("No credentials file was found...") when `surface.credentialsRef === undefined`. [src/commands/export.ts:run]
- [x] [Review][Patch] LOW — Vestigial `void ALL_CATEGORIES;` reference at end of `export.ts` and matching unused import. Fix: removed both. [src/commands/export.ts]
- [x] [Review][Defer] LOW — `writeFile` overwrites existing bundle path silently. Logged in deferred-work.md.
- [x] [Review][Defer] LOW — `writeFile` is non-atomic (no tmp+rename). Logged in deferred-work.md.
- [x] [Review][Defer] LOW — `writeFile` errors bubble as opaque INTERNAL. Logged in deferred-work.md.
- [x] [Review][Defer] LOW — `parseCategories('all,bogus')` short-circuits on `all`. Logged in deferred-work.md.
- [x] [Review][Defer] LOW — Unparseable credentials produce `wasRedacted:false` semantically misleading state. Logged in deferred-work.md.
- [x] [Review][Defer] LOW — `resolveOriginalPath` called for ALL projects even when subset is selected. Logged in deferred-work.md.
- [x] [Review][Defer] LOW — AC8 missing-flag error uses generic INTERNAL code. Logged in deferred-work.md.
- [x] [Review][Dismiss] LOW — `promptOriginalPath` validate signature returns `string|undefined` (clack accepts truthy strings; works in practice).
- [x] [Review][Dismiss] TRIVIAL — `selectedSlugs.find` is O(N²) (small N).
- [x] [Review][Dismiss] TRIVIAL — Two `new Date()` calls (defaultOutputPath + buildBundle) could split midnight UTC (cosmetic only).

**Regression tests added to `src/commands/export.test.ts`:**
- `regression: --include-sessions interactive without --categories shows multi-select`
- `regression: silent --projects validates slug existence`
- `regression: --project-path is honored even when source is sessionCwd` (×2)
- `regression: --all-projects + --projects warns and uses all`
- `regression: duplicate --projects slugs are deduped`
- `credentials file content > warns when --include-credentials requested but no credentials file present`
