import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { WriteGate } from './write-gate.js';
import {
  readClaudeJsonFile,
  readSettingsFileStrict,
  type MemoryFile,
  type SessionFile,
  type CommandFile,
} from './claude-reader.js';
import { remapByDecisions } from '../core/path-engine.js';
import { CmemmovError } from '../core/error.js';

type Mode = 'merge' | 'overwrite';

// Structural type matching `RemapDecision[]` (decision-schema.ts) so this
// module stays decoupled from the schema. TypeScript will accept passing
// the full RemapDecision[] where this narrower type is expected.
type RemapDecisionLike = readonly {
  originalPath: string;
  targetPath: string | null;
}[];
type WarnFn = (msg: string) => void;
// `warn` is reserved for unmatched paths (collected into summary.warnings,
// rendered as a yellow ⚠ in human mode). `info` is for successful "Remapped
// X → Y" log lines that should be visible to the user (so dry-run AC #6 still
// shows before/after) but must NOT inflate summary.warnings (AC #10 requires
// it to list "each unmatched path", not every successful remap).
type InfoFn = (msg: string) => void;

interface GlobalMemoryOpts {
  category: 'globalMemory';
  mode: Mode;
  targetDir: string;
  data: MemoryFile[];
  gate: WriteGate;
}
interface ProjectMemoryOpts {
  category: 'projectMemory';
  mode: Mode;
  targetDir: string;
  data: { slug: string; files: MemoryFile[] };
  gate: WriteGate;
}
interface GlobalSettingsOpts {
  category: 'globalSettings';
  mode: Mode;
  targetDir: string;
  data: unknown;
  gate: WriteGate;
  remapDecisions?: RemapDecisionLike;
  warn?: WarnFn;
  info?: InfoFn;
}
interface ProjectSettingsOpts {
  category: 'projectSettings';
  mode: Mode;
  targetDir: string;
  data: { slug: string; settings: unknown };
  gate: WriteGate;
  remapDecisions?: RemapDecisionLike;
  warn?: WarnFn;
  info?: InfoFn;
}
interface ClaudeMdOpts {
  category: 'claudeMd';
  mode: Mode;
  targetDir: string;
  data: { content: string; slug?: string };
  gate: WriteGate;
}
interface McpConfigOpts {
  category: 'mcpConfig';
  mode: Mode;
  targetDir: string;
  data: unknown;
  gate: WriteGate;
}
interface CustomCommandsOpts {
  category: 'customCommands';
  mode: Mode;
  targetDir: string;
  data: CommandFile[];
  gate: WriteGate;
}
interface TeamsOpts {
  category: 'teams';
  mode: Mode;
  targetDir: string;
  data: Record<string, unknown>;
  gate: WriteGate;
}
interface PluginsOpts {
  category: 'plugins';
  mode: Mode;
  targetDir: string;
  data: unknown;
  gate: WriteGate;
}
interface SessionHistoryOpts {
  category: 'sessionHistory';
  mode: Mode;
  targetDir: string;
  data: { slug: string; files: SessionFile[] };
  gate: WriteGate;
}
interface ClaudeJsonOpts {
  category: 'claudeJson';
  mode: Mode;
  // .claude dir; the on-disk path for ~/.claude.json is derived as
  // `${targetDir}.json` to mirror locateClaude()'s formula.
  targetDir: string;
  data: unknown;
  gate: WriteGate;
  remapDecisions?: RemapDecisionLike;
  warn?: WarnFn;
  info?: InfoFn;
}

export type ApplyCategoryOpts =
  | GlobalMemoryOpts
  | ProjectMemoryOpts
  | GlobalSettingsOpts
  | ProjectSettingsOpts
  | ClaudeMdOpts
  | McpConfigOpts
  | CustomCommandsOpts
  | TeamsOpts
  | PluginsOpts
  | SessionHistoryOpts
  | ClaudeJsonOpts;

function assertNever(x: never): never {
  throw new Error(`Unhandled category: ${(x as ApplyCategoryOpts).category}`);
}

export async function applyCategory(opts: ApplyCategoryOpts): Promise<void> {
  switch (opts.category) {
    case 'globalMemory':
      return applyGlobalMemory(opts);
    case 'projectMemory':
      return applyProjectMemory(opts);
    case 'globalSettings':
      return applyGlobalSettings(opts);
    case 'projectSettings':
      return applyProjectSettings(opts);
    case 'claudeMd':
      return applyClaudeMd(opts);
    case 'mcpConfig':
      return applyMcpConfig(opts);
    case 'customCommands':
      return applyCustomCommands(opts);
    case 'teams':
      return applyTeams(opts);
    case 'plugins':
      return applyPlugins(opts);
    case 'sessionHistory':
      return applySessionHistory(opts);
    case 'claudeJson':
      return applyClaudeJson(opts);
    default:
      return assertNever(opts);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function safeReadDir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

async function safeReadFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

// The live WriteGate's `remove` is `fs.rm(path, { recursive: true })` (no
// `force`), so it throws ENOENT when the target is missing. Overwrite paths
// can run against fresh installs where the category dir does not yet exist —
// guard those with this helper so the gate only sees a real removal.
async function safeGateRemove(gate: WriteGate, path: string): Promise<void> {
  if (await pathExists(path)) {
    await gate.remove(path);
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function deepMerge(target: unknown, source: unknown): unknown {
  if (!isObject(target) || !isObject(source)) return source;
  const result: Record<string, unknown> = { ...target };
  for (const [key, val] of Object.entries(source)) {
    const existing = result[key];
    if (Array.isArray(existing) && Array.isArray(val)) {
      const allStrings =
        (existing as unknown[]).every((e) => typeof e === 'string') &&
        (val as unknown[]).every((e) => typeof e === 'string');
      if (allStrings) {
        // String arrays (permission rules, etc.): de-dupe by string equality.
        result[key] = [...new Set([...(existing as string[]), ...(val as string[])])];
      } else {
        // Object arrays (e.g. hooks): a Set-based dedup uses reference equality
        // and silently produces logical duplicates. Replace existing with
        // incoming so the merge is deterministic.
        result[key] = val;
      }
    } else {
      result[key] = deepMerge(existing, val);
    }
  }
  return result;
}

function extractMemoryTitle(content: string): string | undefined {
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (line.startsWith('# ')) return line.slice(2).trim();
  }
  return undefined;
}

function extractMemoryHook(content: string): string | undefined {
  // Skip frontmatter (--- ... ---), look for description: in frontmatter,
  // else fall back to first non-blank, non-heading line in the body.
  const lines = content.split('\n');
  if (lines[0]?.trim() === '---') {
    for (let i = 1; i < lines.length; i++) {
      const l = lines[i] ?? '';
      if (l.trim() === '---') break;
      const m = /^description:\s*(.+)$/.exec(l.trim());
      if (m?.[1] !== undefined) return m[1].trim();
    }
  }
  let inFrontmatter = false;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = (lines[i] ?? '').trim();
    if (i === 0 && trimmed === '---') {
      inFrontmatter = true;
      continue;
    }
    if (inFrontmatter) {
      if (trimmed === '---') inFrontmatter = false;
      continue;
    }
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith('#')) continue;
    return trimmed;
  }
  return undefined;
}

function buildMemoryIndex(files: MemoryFile[]): string {
  const entries: string[] = ['# Memory Index', ''];
  const nonIndex = files.filter((f) => f.filename !== 'MEMORY.md');
  nonIndex.sort((a, b) => a.filename.localeCompare(b.filename));
  for (const f of nonIndex) {
    const title = extractMemoryTitle(f.content) ?? f.filename;
    const hook = extractMemoryHook(f.content);
    const line =
      hook !== undefined
        ? `- [${title}](${f.filename}) — ${hook}`
        : `- [${title}](${f.filename})`;
    entries.push(line);
  }
  entries.push('');
  return entries.join('\n');
}

async function readExistingMemoryFiles(memoryDir: string): Promise<MemoryFile[]> {
  const entries = await safeReadDir(memoryDir);
  const out: MemoryFile[] = [];
  for (const f of entries) {
    if (!f.endsWith('.md')) continue;
    const content = await safeReadFile(join(memoryDir, f));
    if (content !== undefined) out.push({ filename: f, content });
  }
  return out;
}

// ---------------------------------------------------------------------------
// globalMemory & projectMemory
// ---------------------------------------------------------------------------

async function applyMemoryAt(
  memoryDir: string,
  files: MemoryFile[],
  mode: Mode,
  gate: WriteGate,
): Promise<void> {
  if (mode === 'overwrite') {
    await safeGateRemove(gate, memoryDir);
    await gate.mkdir(memoryDir, { recursive: true });
    // Skip any incoming MEMORY.md; the rebuilt index below is authoritative.
    for (const f of files) {
      if (f.filename === 'MEMORY.md') continue;
      await gate.write(join(memoryDir, f.filename), f.content);
    }
    const index = buildMemoryIndex(files);
    await gate.write(join(memoryDir, 'MEMORY.md'), index);
    return;
  }

  // merge: existing entries win on collision; index rebuilt from final state.
  const existing = await readExistingMemoryFiles(memoryDir);
  const existingNames = new Set(existing.map((f) => f.filename));
  await gate.mkdir(memoryDir, { recursive: true });
  const newlyWritten: MemoryFile[] = [];
  for (const f of files) {
    if (existingNames.has(f.filename)) continue;
    await gate.write(join(memoryDir, f.filename), f.content);
    newlyWritten.push(f);
  }
  const finalState = [...existing, ...newlyWritten];
  const index = buildMemoryIndex(finalState);
  await gate.write(join(memoryDir, 'MEMORY.md'), index);
}

async function applyGlobalMemory(opts: GlobalMemoryOpts): Promise<void> {
  const memoryDir = join(opts.targetDir, 'memory');
  await applyMemoryAt(memoryDir, opts.data, opts.mode, opts.gate);
}

async function applyProjectMemory(opts: ProjectMemoryOpts): Promise<void> {
  const memoryDir = join(opts.targetDir, 'projects', opts.data.slug, 'memory');
  await applyMemoryAt(memoryDir, opts.data.files, opts.mode, opts.gate);
}

// ---------------------------------------------------------------------------
// globalSettings & projectSettings
// ---------------------------------------------------------------------------

// Read+parse a JSON settings file, distinguishing absent (ENOENT → empty base)
// from malformed (parse failure → throw INTERNAL). The default reader collapses
// both to `undefined`, which would silently overwrite a corrupt-but-recoverable
// settings file on the next merge.
async function readSettingsForMerge(filePath: string): Promise<Record<string, unknown>> {
  const result = await readSettingsFileStrict(filePath);
  if (result === undefined) return {};
  if (result === 'malformed') {
    throw new CmemmovError({
      code: 'INTERNAL',
      hint: `settings file is malformed; restore from backup or fix manually before importing: ${filePath}`,
    });
  }
  return result;
}

async function applySettingsAt(
  filePath: string,
  data: unknown,
  mode: Mode,
  gate: WriteGate,
): Promise<void> {
  await gate.mkdir(dirname(filePath), { recursive: true });
  if (mode === 'overwrite') {
    await gate.write(filePath, JSON.stringify(data, null, 2));
    return;
  }
  const existing = await readSettingsForMerge(filePath);
  const merged = deepMerge(existing, data);
  await gate.write(filePath, JSON.stringify(merged, null, 2));
}

// Permission rules in settings.json follow Claude Code's `Verb(path)` format
// (e.g. `Read(/Users/me/agents/**)`). For each rule we extract the path,
// apply prefix-substitution against the remap decisions, and reconstruct.
// Strings that don't match the format pass through untouched and silently
// (defensive: future permission types must not break on unknown shapes).
//
// Real-world Claude Code stores permissions as `{ allow: [...], deny: [...] }`
// (nested-array form). The Story 2.3 ACs use a flat-array shorthand example,
// but the implementation must handle both so live bundles get rewritten.
function remapPermissionRule(
  rule: unknown,
  decisions: RemapDecisionLike,
  warn: WarnFn,
  info: InfoFn,
  context: string,
): unknown {
  if (typeof rule !== 'string') return rule;
  const m = /^([A-Za-z]+)\((.+)\)$/.exec(rule);
  // The regex has two required capture groups, so on a successful match
  // m[1] and m[2] are always defined. Guard against the optional shape
  // anyway to keep the strict-null type narrowing happy.
  const verb = m?.[1];
  const pathPart = m?.[2];
  if (verb === undefined || pathPart === undefined) return rule;
  const result = remapByDecisions(pathPart, decisions);
  if (result !== null) {
    info(`Remapped ${context} permission: ${rule} → ${verb}(${result})`);
    return `${verb}(${result})`;
  }
  warn(`No remap rule matched permission path in ${context}: ${pathPart}`);
  return rule;
}

const PERMISSION_BUCKETS = ['allow', 'deny', 'ask'] as const;

function remapPermissionRules(
  data: unknown,
  decisions: RemapDecisionLike,
  warn: WarnFn,
  info: InfoFn,
  context: string,
): unknown {
  if (!isObject(data)) return data;
  const permissions: unknown = data.permissions;

  // Flat-array form: `permissions: ["Read(...)", "Write(...)"]`. Used in the
  // Story 2.3 AC examples and some legacy fixtures.
  if (Array.isArray(permissions)) {
    const remapped: unknown[] = permissions.map((rule: unknown): unknown =>
      remapPermissionRule(rule, decisions, warn, info, context),
    );
    return { ...data, permissions: remapped };
  }

  // Nested-array form: `permissions: { allow: [...], deny: [...], ask: [...] }`.
  // This is the actual on-disk shape Claude Code writes. Only known buckets are
  // walked; unknown sibling fields pass through verbatim.
  if (isObject(permissions)) {
    const remappedPerms: Record<string, unknown> = { ...permissions };
    for (const bucket of PERMISSION_BUCKETS) {
      const arr = permissions[bucket];
      if (!Array.isArray(arr)) continue;
      remappedPerms[bucket] = arr.map((rule: unknown): unknown =>
        remapPermissionRule(rule, decisions, warn, info, context),
      );
    }
    return { ...data, permissions: remappedPerms };
  }

  return data;
}

async function applyGlobalSettings(opts: GlobalSettingsOpts): Promise<void> {
  const filePath = join(opts.targetDir, 'settings.json');
  const decisions = opts.remapDecisions ?? [];
  const warn = opts.warn ?? ((): void => undefined);
  const info = opts.info ?? ((): void => undefined);
  const data =
    decisions.length > 0
      ? remapPermissionRules(opts.data, decisions, warn, info, 'global settings.json')
      : opts.data;
  await applySettingsAt(filePath, data, opts.mode, opts.gate);
}

async function applyProjectSettings(opts: ProjectSettingsOpts): Promise<void> {
  const filePath = join(opts.targetDir, 'projects', opts.data.slug, 'settings.json');
  const decisions = opts.remapDecisions ?? [];
  const warn = opts.warn ?? ((): void => undefined);
  const info = opts.info ?? ((): void => undefined);
  const settings =
    decisions.length > 0
      ? remapPermissionRules(
          opts.data.settings,
          decisions,
          warn,
          info,
          `project ${opts.data.slug} settings.json`,
        )
      : opts.data.settings;
  await applySettingsAt(filePath, settings, opts.mode, opts.gate);
}

// ---------------------------------------------------------------------------
// claudeJson  (~/.claude.json — adjacent to ~/.claude/, not inside it)
// ---------------------------------------------------------------------------

// Recognized absolute-path-bearing fields in ~/.claude.json. Other fields
// (theme, telemetryConsent, hasSeenOnboarding, hotkeys, mcpServers, …) pass
// through verbatim. TODO: Story 2.4 integration tests may surface additional
// path-bearing fields — extend this list as new ones are discovered.
const CLAUDE_JSON_PATH_FIELDS = ['lastSessionCwd', 'currentProject'] as const;

function remapClaudeJsonPaths(
  data: unknown,
  decisions: RemapDecisionLike,
  warn: WarnFn,
  info: InfoFn,
): unknown {
  if (!isObject(data)) return data;
  const result: Record<string, unknown> = { ...data };

  for (const field of CLAUDE_JSON_PATH_FIELDS) {
    const value = result[field];
    if (typeof value !== 'string' || value.length === 0) continue;
    const remapped = remapByDecisions(value, decisions);
    if (remapped !== null) {
      info(`Remapped .claude.json ${field}: ${value} → ${remapped}`);
      result[field] = remapped;
    } else {
      warn(`No remap rule matched .claude.json ${field}: ${value}`);
    }
  }

  const recentProjects: unknown = result.recentProjects;
  if (Array.isArray(recentProjects)) {
    result.recentProjects = recentProjects.map((entry: unknown): unknown => {
      if (!isObject(entry)) return entry;
      const pathVal: unknown = entry.path;
      if (typeof pathVal !== 'string' || pathVal.length === 0) return entry;
      const remapped = remapByDecisions(pathVal, decisions);
      if (remapped !== null) {
        info(`Remapped .claude.json recentProjects[].path: ${pathVal} → ${remapped}`);
        return { ...entry, path: remapped };
      }
      warn(`No remap rule matched .claude.json recentProjects[].path: ${pathVal}`);
      return entry;
    });
  }

  return result;
}

async function applyClaudeJson(opts: ClaudeJsonOpts): Promise<void> {
  // Mirrors locateClaude()'s formula: ~/.claude → ~/.claude.json.
  const filePath = `${opts.targetDir}.json`;
  const decisions = opts.remapDecisions ?? [];
  const warn = opts.warn ?? ((): void => undefined);
  const info = opts.info ?? ((): void => undefined);
  const data =
    decisions.length > 0 ? remapClaudeJsonPaths(opts.data, decisions, warn, info) : opts.data;

  if (opts.mode === 'overwrite') {
    await applySettingsAt(filePath, data, opts.mode, opts.gate);
    return;
  }

  // merge: standard deep-merge, EXCEPT `recentProjects` is replace-not-union.
  // The default `deepMerge` Set-unions string arrays; for `recentProjects`
  // (typically an array of objects with `path` keys, but historically also
  // an array of strings) that produces stale cross-machine paths leaking
  // through after fix-paths runs. Always trust the incoming list.
  await opts.gate.mkdir(dirname(filePath), { recursive: true });
  const existing = await readSettingsForMerge(filePath);
  const merged = deepMerge(existing, data);
  if (isObject(data) && 'recentProjects' in data && isObject(merged)) {
    merged.recentProjects = data.recentProjects;
  }
  await opts.gate.write(filePath, JSON.stringify(merged, null, 2));
}

// ---------------------------------------------------------------------------
// claudeMd
// ---------------------------------------------------------------------------

async function applyClaudeMd(opts: ClaudeMdOpts): Promise<void> {
  const filePath =
    opts.data.slug !== undefined
      ? join(opts.targetDir, 'projects', opts.data.slug, 'CLAUDE.md')
      : join(opts.targetDir, 'CLAUDE.md');
  if (opts.mode === 'overwrite') {
    await opts.gate.mkdir(dirname(filePath), { recursive: true });
    await opts.gate.write(filePath, opts.data.content);
    return;
  }
  // merge: existing CLAUDE.md is project-defining; keep on collision.
  const existing = await safeReadFile(filePath);
  if (existing !== undefined) return;
  await opts.gate.mkdir(dirname(filePath), { recursive: true });
  await opts.gate.write(filePath, opts.data.content);
}

// ---------------------------------------------------------------------------
// mcpConfig
// ---------------------------------------------------------------------------

async function applyMcpConfig(opts: McpConfigOpts): Promise<void> {
  const settingsPath = join(opts.targetDir, 'settings.json');
  const parsed = await readClaudeJsonFile(settingsPath);
  const existing: Record<string, unknown> = isObject(parsed) ? parsed : {};

  await opts.gate.mkdir(dirname(settingsPath), { recursive: true });
  if (opts.mode === 'overwrite') {
    const next = { ...existing, mcpServers: opts.data };
    await opts.gate.write(settingsPath, JSON.stringify(next, null, 2));
    return;
  }

  // merge: union mcpServers by `name` (keys); existing keys win on collision.
  const existingMcp =
    isObject(existing.mcpServers) ? (existing.mcpServers) : {};
  const incomingMcp = isObject(opts.data) ? opts.data : {};
  const mergedMcp: Record<string, unknown> = { ...existingMcp };
  for (const [name, val] of Object.entries(incomingMcp)) {
    if (!(name in mergedMcp)) mergedMcp[name] = val;
  }
  const next = { ...existing, mcpServers: mergedMcp };
  await opts.gate.write(settingsPath, JSON.stringify(next, null, 2));
}

// ---------------------------------------------------------------------------
// customCommands
// ---------------------------------------------------------------------------

async function applyCustomCommands(opts: CustomCommandsOpts): Promise<void> {
  const commandsDir = join(opts.targetDir, 'commands');
  if (opts.mode === 'overwrite') {
    await safeGateRemove(opts.gate, commandsDir);
    await opts.gate.mkdir(commandsDir, { recursive: true });
    for (const f of opts.data) {
      await opts.gate.write(join(commandsDir, f.filename), f.content);
    }
    return;
  }
  // merge: union by filename, existing kept on collision.
  const existing = await safeReadDir(commandsDir);
  const existingNames = new Set(existing);
  await opts.gate.mkdir(commandsDir, { recursive: true });
  for (const f of opts.data) {
    if (existingNames.has(f.filename)) continue;
    await opts.gate.write(join(commandsDir, f.filename), f.content);
  }
}

// ---------------------------------------------------------------------------
// teams
// ---------------------------------------------------------------------------

async function applyTeams(opts: TeamsOpts): Promise<void> {
  const teamsDir = join(opts.targetDir, 'teams');
  if (opts.mode === 'overwrite') {
    await safeGateRemove(opts.gate, teamsDir);
    await opts.gate.mkdir(teamsDir, { recursive: true });
    for (const [teamName, cfg] of Object.entries(opts.data)) {
      const teamDir = join(teamsDir, teamName);
      await opts.gate.mkdir(teamDir, { recursive: true });
      await opts.gate.write(join(teamDir, 'config.json'), JSON.stringify(cfg, null, 2));
    }
    return;
  }
  // merge: union by team `id` (config.json files keyed by team dir name);
  // existing kept on collision. Read existing team ids from disk.
  const existingDirs = await safeReadDir(teamsDir);
  const existingIds = new Set<string>();
  for (const d of existingDirs) {
    const parsed = await readClaudeJsonFile(join(teamsDir, d, 'config.json'));
    if (isObject(parsed) && typeof parsed.id === 'string') {
      existingIds.add(parsed.id);
    }
  }
  await opts.gate.mkdir(teamsDir, { recursive: true });
  for (const [teamName, cfg] of Object.entries(opts.data)) {
    const cfgId = isObject(cfg) && typeof cfg.id === 'string' ? cfg.id : undefined;
    if (cfgId !== undefined && existingIds.has(cfgId)) continue;
    const teamDir = join(teamsDir, teamName);
    await opts.gate.mkdir(teamDir, { recursive: true });
    await opts.gate.write(join(teamDir, 'config.json'), JSON.stringify(cfg, null, 2));
  }
}

// ---------------------------------------------------------------------------
// plugins
// ---------------------------------------------------------------------------

async function applyPlugins(opts: PluginsOpts): Promise<void> {
  // Plugins format on disk varies (plugins.json file vs plugins/<name>/config.json
  // dir). For Epic 1 scope we write to plugins.json (single-file canonical form);
  // overwrite replaces wholesale; merge unions by top-level key with existing keys winning.
  const pluginsPath = join(opts.targetDir, 'plugins.json');
  await opts.gate.mkdir(dirname(pluginsPath), { recursive: true });
  if (opts.mode === 'overwrite') {
    await opts.gate.write(pluginsPath, JSON.stringify(opts.data, null, 2));
    return;
  }
  const parsed = await readClaudeJsonFile(pluginsPath);
  const existing: Record<string, unknown> = isObject(parsed) ? parsed : {};
  const incoming = isObject(opts.data) ? opts.data : {};
  const merged: Record<string, unknown> = { ...existing };
  for (const [name, val] of Object.entries(incoming)) {
    if (!(name in merged)) merged[name] = val;
  }
  await opts.gate.write(pluginsPath, JSON.stringify(merged, null, 2));
}

// ---------------------------------------------------------------------------
// sessionHistory
// ---------------------------------------------------------------------------

async function applySessionHistory(opts: SessionHistoryOpts): Promise<void> {
  const sessionsDir = join(opts.targetDir, 'projects', opts.data.slug, 'sessions');
  if (opts.mode === 'overwrite') {
    await safeGateRemove(opts.gate, sessionsDir);
    await opts.gate.mkdir(sessionsDir, { recursive: true });
    for (const sf of opts.data.files) {
      await opts.gate.write(join(sessionsDir, sf.filename), sf.lines.join('\n'));
    }
    return;
  }
  // merge: append-only by filename; existing JSONL never overwritten.
  const existing = await safeReadDir(sessionsDir);
  const existingNames = new Set(existing);
  await opts.gate.mkdir(sessionsDir, { recursive: true });
  for (const sf of opts.data.files) {
    if (existingNames.has(sf.filename)) continue;
    await opts.gate.write(join(sessionsDir, sf.filename), sf.lines.join('\n'));
  }
}
