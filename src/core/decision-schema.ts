export type ClaudeCategory =
  | 'globalMemory'
  | 'projectMemory'
  | 'globalSettings'
  | 'projectSettings'
  | 'claudeMd'
  | 'mcpConfig'
  | 'customCommands'
  | 'teams'
  | 'plugins'
  | 'sessionHistory'
  // claudeJson is exported unconditionally (not user-selectable) and has no
  // entry in ALL_CATEGORIES — it lives in the union solely for writer-side
  // type safety in the applyCategory discriminated union.
  | 'claudeJson';

export const ALL_CATEGORIES: readonly ClaudeCategory[] = [
  'globalMemory',
  'projectMemory',
  'globalSettings',
  'projectSettings',
  'claudeMd',
  'mcpConfig',
  'customCommands',
  'teams',
  'plugins',
  'sessionHistory',
] as const;

export type ImportMode = 'merge' | 'overwrite';

export interface ExportDecision {
  categories: ClaudeCategory[];
  includeCredentials: boolean;
  outputPath: string;
  silent: boolean;
  json: boolean;
  allProjects: boolean;
  projects: string[];
  projectPaths: Record<string, string>;
}

export interface ImportDecision {
  bundlePath: string;
  categories: ClaudeCategory[];
  mode: ImportMode;
  // Categories to apply with 'overwrite' semantics when `mode === 'merge'`.
  // Encodes `--mode overwrite=<category>` without changing the ImportMode union.
  overwriteCategories: ClaudeCategory[];
  dryRun: boolean;
  noIntegrityCheck: boolean;
  silent: boolean;
  json: boolean;
  // Cross-OS prefix-substitution rules collected from `--remap` flags. Empty
  // for same-OS imports; non-empty entries opt the importer into scripted
  // remap mode and bypass the interactive `confirmCrossOsPath` prompt.
  remap: { lhs: string; rhs: string }[];
}

export type RemapOutcome = 'auto-confirmed' | 'user-confirmed' | 'overridden' | 'skipped';

export interface RemapDecision {
  slug: string;
  originalPath: string;
  targetPath: string | null;
  outcome: RemapOutcome;
}

export type RemapDecisions = RemapDecision[];

export interface RollbackDecision {
  backupPath: string | undefined;
  dryRun: boolean;
  silent: boolean;
  json: boolean;
}

export const FLAG_NAMES = {
  categories: '--categories',
  includeCredentials: '--include-credentials',
  mode: '--mode',
  dryRun: '--dry-run',
  noIntegrityCheck: '--no-integrity-check',
  backupPath: '--backup',
  force: '--force',
  output: '--output',
  allProjects: '--all-projects',
  projects: '--projects',
  projectPath: '--project-path',
  includeSessions: '--include-sessions',
} as const satisfies Record<string, string>;
