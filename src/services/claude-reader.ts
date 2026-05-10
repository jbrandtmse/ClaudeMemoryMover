import { readFile, readdir, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';
import process from 'node:process';
import { CmemmovError } from '../core/error.js';
import { slugToPath } from '../core/path-engine.js';

export interface MemoryFile {
  filename: string;
  content: string;
}

export interface SessionFile {
  filename: string;
  lines: string[];
}

export interface CommandFile {
  filename: string;
  content: string;
}

export interface ProjectSurface {
  slug: string;
  settings: unknown;
  memories: MemoryFile[];
  claudeMd: string | undefined;
  sessions: SessionFile[];
}

export interface ClaudeSurface {
  claudeDir: string;
  claudeJson: unknown;
  credentialsRef: string | undefined;
  globalSettings: unknown;
  globalMemory: MemoryFile[];
  claudeMd: string | undefined;
  mcpConfig: unknown;
  customCommands: CommandFile[];
  teams: unknown;
  plugins: unknown;
  projects: ProjectSurface[];
}

export interface OriginalPathResult {
  path: string;
  source: 'sessionCwd' | 'slugDecode' | null;
}

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

async function safeStat(path: string): Promise<{ isDirectory: boolean; isFile: boolean } | undefined> {
  try {
    const st = await stat(path);
    return { isDirectory: st.isDirectory(), isFile: st.isFile() };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
}

function safeParseJson(text: string | undefined): unknown {
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Parse a Claude config file (settings.json, plugins.json, team config.json,
 * etc.) from disk into a JS object. Returns `undefined` if the file is absent
 * (ENOENT) or contents are malformed JSON. Centralizing this here keeps
 * `JSON.parse` calls on Claude config files inside `claude-reader.ts` per the
 * architecture invariant.
 */
export async function readClaudeJsonFile(path: string): Promise<unknown> {
  const text = await safeReadFile(path);
  return safeParseJson(text);
}

/**
 * Read a settings-style JSON file into a plain object, distinguishing absent
 * (ENOENT → `undefined`) from malformed (parse failure → `'malformed'` sentinel).
 * The legacy `readClaudeJsonFile` collapses both into `undefined`, which causes
 * a corrupt settings file to be silently treated as empty on the next merge —
 * exactly the bypass Story 3.0 AC #7 closes. Callers must explicitly handle
 * the `'malformed'` case (typically by throwing CmemmovError INTERNAL upstream).
 */
export async function readSettingsFileStrict(
  path: string,
): Promise<Record<string, unknown> | undefined | 'malformed'> {
  const text = await safeReadFile(path);
  if (text === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    // Non-object JSON (array, primitive, null) is structurally wrong for a
    // settings file — the merger has no sensible base to merge into. Surface
    // it the same as parse failure so the caller fails loudly instead of
    // silently clobbering with the incoming data.
    return 'malformed';
  } catch {
    return 'malformed';
  }
}

async function readSessionFile(filePath: string): Promise<SessionFile> {
  let content: string;
  try {
    content = await readFile(filePath, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EBUSY' || code === 'EPERM') {
      throw new CmemmovError({
        code: 'INTERNAL',
        hint: 'close Claude Code and retry',
        file: filePath,
        cause: err,
      });
    }
    throw err;
  }
  const lines = content.split('\n').filter((l) => l.trim().length > 0);
  return { filename: basename(filePath), lines };
}

async function readMemoryDir(dir: string): Promise<MemoryFile[]> {
  const entries = await safeReadDir(dir);
  const mdFiles = entries.filter((f) => f.endsWith('.md'));
  const out: MemoryFile[] = [];
  for (const f of mdFiles) {
    const content = await safeReadFile(join(dir, f));
    if (content !== undefined) out.push({ filename: f, content });
  }
  return out;
}

async function readCommandsDir(dir: string): Promise<CommandFile[]> {
  const entries = await safeReadDir(dir);
  const out: CommandFile[] = [];
  for (const f of entries) {
    const full = join(dir, f);
    const st = await safeStat(full);
    if (!st?.isFile) continue;
    const content = await safeReadFile(full);
    if (content !== undefined) out.push({ filename: f, content });
  }
  return out;
}

async function readTeams(claudeDir: string): Promise<unknown> {
  const teamsDir = join(claudeDir, 'teams');
  const entries = await safeReadDir(teamsDir);
  const teams: Record<string, unknown> = {};
  for (const teamName of entries) {
    const cfgPath = join(teamsDir, teamName, 'config.json');
    const text = await safeReadFile(cfgPath);
    if (text === undefined) continue;
    const parsed = safeParseJson(text);
    if (parsed !== undefined) teams[teamName] = parsed;
  }
  return Object.keys(teams).length > 0 ? teams : undefined;
}

async function readPlugins(claudeDir: string): Promise<unknown> {
  // Prefer plugins.json, then a plugins/ directory.
  const jsonPath = join(claudeDir, 'plugins.json');
  const jsonText = await safeReadFile(jsonPath);
  if (jsonText !== undefined) {
    return safeParseJson(jsonText);
  }
  const pluginsDir = join(claudeDir, 'plugins');
  const dirStat = await safeStat(pluginsDir);
  if (dirStat?.isDirectory === true) {
    const entries = await safeReadDir(pluginsDir);
    const plugins: Record<string, unknown> = {};
    for (const entry of entries) {
      const cfgPath = join(pluginsDir, entry, 'config.json');
      const text = await safeReadFile(cfgPath);
      if (text === undefined) continue;
      const parsed = safeParseJson(text);
      if (parsed !== undefined) plugins[entry] = parsed;
    }
    return Object.keys(plugins).length > 0 ? plugins : undefined;
  }
  return undefined;
}

async function findCredentialsRef(claudeDir: string): Promise<string | undefined> {
  for (const candidate of ['.credentials.json', 'credentials.json']) {
    const full = join(claudeDir, candidate);
    const st = await safeStat(full);
    if (st?.isFile === true) return full;
  }
  return undefined;
}

async function readProject(claudeDir: string, slug: string): Promise<ProjectSurface> {
  const projectDir = join(claudeDir, 'projects', slug);
  const settingsText = await safeReadFile(join(projectDir, 'settings.json'));
  const settings = safeParseJson(settingsText);
  const memories = await readMemoryDir(join(projectDir, 'memory'));
  const claudeMd = await safeReadFile(join(projectDir, 'CLAUDE.md'));

  const sessionsDir = join(projectDir, 'sessions');
  const sessionEntries = await safeReadDir(sessionsDir);
  const jsonlFiles = sessionEntries.filter((f) => f.endsWith('.jsonl'));
  const sessions: SessionFile[] = [];
  for (const f of jsonlFiles) {
    sessions.push(await readSessionFile(join(sessionsDir, f)));
  }

  return { slug, settings, memories, claudeMd, sessions };
}

export async function readClaudeSurface(
  claudeDir: string,
  claudeJson: string,
): Promise<ClaudeSurface> {
  const claudeJsonText = await safeReadFile(claudeJson);
  const claudeJsonParsed = safeParseJson(claudeJsonText);

  const settingsText = await safeReadFile(join(claudeDir, 'settings.json'));
  const globalSettings = safeParseJson(settingsText);
  const mcpConfig =
    globalSettings !== undefined &&
    typeof globalSettings === 'object' &&
    globalSettings !== null
      ? (globalSettings as Record<string, unknown>).mcpServers
      : undefined;

  const globalMemory = await readMemoryDir(join(claudeDir, 'memory'));
  const claudeMd = await safeReadFile(join(claudeDir, 'CLAUDE.md'));
  const customCommands = await readCommandsDir(join(claudeDir, 'commands'));
  const teams = await readTeams(claudeDir);
  const plugins = await readPlugins(claudeDir);
  const credentialsRef = await findCredentialsRef(claudeDir);

  const projectsDir = join(claudeDir, 'projects');
  const projectsEntries = await safeReadDir(projectsDir);
  const projects: ProjectSurface[] = [];
  for (const slug of projectsEntries) {
    const projectDir = join(projectsDir, slug);
    const st = await safeStat(projectDir);
    if (st?.isDirectory !== true) continue;
    projects.push(await readProject(claudeDir, slug));
  }

  return {
    claudeDir,
    claudeJson: claudeJsonParsed,
    credentialsRef,
    globalSettings,
    globalMemory,
    claudeMd,
    mcpConfig,
    customCommands,
    teams,
    plugins,
    projects,
  };
}

export async function resolveOriginalPath(
  slug: string,
  claudeDir: string,
): Promise<OriginalPathResult> {
  const sessionsDir = join(claudeDir, 'projects', slug, 'sessions');
  const sessionFiles = await safeReadDir(sessionsDir);
  const jsonlFiles = sessionFiles.filter((f) => f.endsWith('.jsonl'));

  if (jsonlFiles.length > 0) {
    const withStats = await Promise.all(
      jsonlFiles.map(async (f) => {
        const fullPath = join(sessionsDir, f);
        const st = await stat(fullPath);
        return { f, mtimeMs: st.mtimeMs };
      }),
    );
    withStats.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const mostRecentName = withStats[0]?.f;
    if (mostRecentName !== undefined) {
      const mostRecent = join(sessionsDir, mostRecentName);
      // Wrap EBUSY/EPERM in CmemmovError(INTERNAL) per AC5 — mirrors the
      // guard in readSessionFile so both surface paths translate the same
      // way when Claude Code holds the JSONL open.
      let sessionContent: string;
      try {
        sessionContent = await readFile(mostRecent, 'utf8');
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'EBUSY' || code === 'EPERM') {
          throw new CmemmovError({
            code: 'INTERNAL',
            hint: 'close Claude Code and retry',
            file: mostRecent,
            cause: err,
          });
        }
        throw err;
      }
      for (const line of sessionContent.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;
        try {
          const obj: unknown = JSON.parse(trimmed);
          if (typeof obj === 'object' && obj !== null) {
            const cwdVal = (obj as Record<string, unknown>).cwd;
            if (typeof cwdVal === 'string') {
              return { path: cwdVal, source: 'sessionCwd' };
            }
          }
        } catch {
          // skip malformed line
        }
      }
    }
  }

  const decoded = slugToPath(slug, process.platform);
  if (decoded !== null) {
    return { path: decoded, source: 'slugDecode' };
  }

  return { path: slug, source: null };
}
