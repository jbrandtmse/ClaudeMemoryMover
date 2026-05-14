import { posix } from 'node:path';
import type { Bundle, Project } from './bundle-schema.js';
import { ALL_CATEGORIES } from './decision-schema.js';

export type SanitizationProfileName = 'redact-credentials' | 'strip-personal';

export type CategoryDecision = 'preserve' | 'strip' | 'partial' | 'redact-only';

export interface SanitizationProfile {
  readonly credentials: CategoryDecision;
  readonly globalMemory: CategoryDecision;
  readonly projectMemory: CategoryDecision;
  readonly globalSettings: CategoryDecision;
  readonly projectSettings: CategoryDecision;
  readonly claudeMd: CategoryDecision;
  readonly mcpConfig: CategoryDecision;
  readonly customCommands: CategoryDecision;
  readonly teams: CategoryDecision;
  readonly plugins: CategoryDecision;
  readonly sessionHistory: CategoryDecision;
  readonly claudeJson: CategoryDecision;
}

export const SANITIZATION_PROFILES: Readonly<Record<SanitizationProfileName, SanitizationProfile>> = {
  'redact-credentials': {
    credentials: 'redact-only',
    globalMemory: 'preserve',
    projectMemory: 'preserve',
    globalSettings: 'preserve',
    projectSettings: 'preserve',
    claudeMd: 'preserve',
    mcpConfig: 'preserve',
    customCommands: 'preserve',
    teams: 'preserve',
    plugins: 'preserve',
    sessionHistory: 'preserve',
    claudeJson: 'preserve',
  },
  'strip-personal': {
    credentials: 'strip',
    globalMemory: 'partial',
    projectMemory: 'partial',
    globalSettings: 'partial',
    projectSettings: 'partial',
    claudeMd: 'preserve',
    mcpConfig: 'partial',
    customCommands: 'preserve',
    teams: 'preserve',
    plugins: 'preserve',
    sessionHistory: 'strip',
    claudeJson: 'partial',
  },
} as const;

// Exported for Story 4.2 share command preview and --include-pattern/--exclude-pattern composition.
export const PERSONAL_FILENAME_PATTERNS: readonly RegExp[] = [
  /^personal/i,
  /^private/i,
  /^me_/i,
  /^todo/i,
];

// Fields safe to share with a team.
// Denied fields include: email, name, machineId, lastSessionCwd, currentProject,
// recentProjects, mcpServers (handled by AC5), projects (per-project history),
// githubRepoPaths.
export const CLAUDE_JSON_TEAM_ALLOWLIST: readonly string[] = [
  'theme',
  'editorMode',
  'verbose',
  'experiments',
];


interface MemoryFile {
  filename: string;
  content: string;
}

// Returns kept memories and stripped filenames scoped as `<scope>/<filename>`.
export function stripPersonalMemories(
  memories: MemoryFile[],
  scope: string,
): { kept: MemoryFile[]; strippedFilenames: string[] } {
  const kept: MemoryFile[] = [];
  const strippedFilenames: string[] = [];

  for (const mem of memories) {
    if (isPersonalFilename(mem.filename) || hasFrontmatterPersonalTrue(mem.content)) {
      strippedFilenames.push(`${scope}/${mem.filename}`);
    } else {
      kept.push(mem);
    }
  }

  return { kept, strippedFilenames };
}

function isPersonalFilename(filename: string): boolean {
  return PERSONAL_FILENAME_PATTERNS.some((re) => re.test(filename));
}

// Minimal line-scan for `personal: true` in YAML frontmatter (no YAML library).
function hasFrontmatterPersonalTrue(content: string): boolean {
  const lines = content.split('\n');
  if (lines[0]?.trim() !== '---') return false;
  const closeIdx = lines.indexOf('---', 1);
  if (closeIdx === -1) return false;
  for (let i = 1; i < closeIdx; i++) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    if (/^personal:\s*true\s*$/.test(lines[i]!)) return true;
  }
  return false;
}

// Platform-aware prefix check: normalizes separator style and case on win32
// so that C:/Users/Josh and C:\Users\Josh are treated as equivalent.
function pathStartsWith(filePath: string, prefix: string, platform: string): boolean {
  if (platform === 'win32') {
    // Normalize both slash styles to posix.sep before comparing (avoids the
    // no-hardcoded-separator rule which flags literal '/' and '\' strings).
    const normalize = (p: string) => p.replace(/[/\\]/g, posix.sep).toLowerCase();
    return normalize(filePath).startsWith(normalize(prefix));
  }
  return filePath.startsWith(prefix);
}

// Returns kept permissions and stripped rule strings.
// Non-string, relative, network, and unparseable rules pass through unchanged.
// `platform` is the SOURCE machine's platform (from bundle.sourcePlatform), not the host.
export function stripHomedirPermissionRules(
  permissions: unknown,
  sourceHomedir: string,
  scope: string,
  platform: string = process.platform,
): { kept: unknown; stripped: string[] } {
  if (!Array.isArray(permissions)) return { kept: permissions, stripped: [] };

  const kept: unknown[] = [];
  const stripped: string[] = [];

  for (const rule of permissions) {
    if (typeof rule !== 'string') {
      kept.push(rule);
      continue;
    }
    const argMatch = /^\w+\((.+)\)$/.exec(rule);
    if (argMatch?.[1] === undefined) {
      kept.push(rule);
      continue;
    }
    const arg = argMatch[1];
    if (isNetworkPath(arg) || !isAbsolutePath(arg, platform)) {
      kept.push(rule);
      continue;
    }
    if (pathStartsWith(arg, sourceHomedir, platform)) {
      stripped.push(`${scope !== '' ? scope + ': ' : ''}${rule}`);
    } else {
      kept.push(rule);
    }
  }

  return { kept, stripped };
}

function isNetworkPath(p: string): boolean {
  return (
    p.startsWith('\\\\') ||
    /^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//.test(p) ||
    p.startsWith('smb://') ||
    p.startsWith('nfs://')
  );
}

function isAbsolutePath(p: string, platform: string): boolean {
  if (platform === 'win32') {
    return /^[a-zA-Z]:[/\\]/.test(p);
  }
  return p.startsWith(posix.sep);
}

// Returns kept MCP record and stripped server names.
// `platform` is the SOURCE machine's platform (from bundle.sourcePlatform), not the host.
export function stripLocalMcpServers(
  mcpRecord: unknown,
  sourceHomedir: string,
  scope: string,
  platform: string = process.platform,
): { kept: unknown; strippedNames: string[] } {
  if (!isPlainObject(mcpRecord)) return { kept: mcpRecord, strippedNames: [] };

  const kept: Record<string, unknown> = {};
  const strippedNames: string[] = [];

  for (const [name, value] of Object.entries(mcpRecord)) {
    const commandOrPath = extractMcpCommand(value);
    if (
      commandOrPath !== null &&
      isAbsolutePath(commandOrPath, platform) &&
      !isNetworkPath(commandOrPath) &&
      pathStartsWith(commandOrPath, sourceHomedir, platform)
    ) {
      strippedNames.push(scope !== '' ? `${scope}:${name}` : name);
    } else {
      kept[name] = value;
    }
  }

  return { kept, strippedNames };
}

function extractMcpCommand(value: unknown): string | null {
  if (!isPlainObject(value)) return null;
  const cmd = value.command;
  if (typeof cmd === 'string') return cmd;
  const path = value.path;
  if (typeof path === 'string') return path;
  return null;
}

// Returns kept claudeJson object (undefined if empty after stripping) and stripped field names.
export function stripClaudeJsonUserFields(claudeJson: unknown): {
  kept: Record<string, unknown> | undefined;
  strippedFields: string[];
} {
  if (!isPlainObject(claudeJson)) return { kept: undefined, strippedFields: [] };

  const kept: Record<string, unknown> = {};
  const strippedFields: string[] = [];

  for (const [key, val] of Object.entries(claudeJson)) {
    if (CLAUDE_JSON_TEAM_ALLOWLIST.includes(key)) {
      kept[key] = val;
    } else {
      strippedFields.push(key);
    }
  }

  return {
    kept: Object.keys(kept).length === 0 ? undefined : kept,
    strippedFields,
  };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// NFR6: credentials strip is invariant under 'strip-personal'; no caller-supplied option can bypass it.
export function applySanitization(bundle: Bundle, profile: SanitizationProfileName): Bundle {
  if (profile === 'redact-credentials') {
    if (!bundle.credentials) return bundle;
    return {
      ...bundle,
      credentials: { content: null, wasRedacted: true },
    };
  }

  // strip-personal profile
  return applyStripPersonal(bundle);
}

interface WasRedacted {
  credentials?: boolean;
  personalMemoryFiles?: string[];
  homeDirPermissionRules?: string[];
  localMcpServers?: string[];
  claudeJsonFields?: string[];
}

function applyStripPersonal(bundle: Bundle): Bundle {
  const sourceHomedir = bundle.sourceHomedir;
  const platform = bundle.sourcePlatform;
  const redacted: WasRedacted = {};

  // Credentials — unconditionally stripped (NFR6)
  let credentials = bundle.credentials;
  if (credentials !== undefined) {
    credentials = { content: null, wasRedacted: true };
    redacted.credentials = true;
  }

  // Global memories
  let globalMemories = bundle.global.memories;
  if (globalMemories !== undefined) {
    const result = stripPersonalMemories(globalMemories, 'global');
    globalMemories = result.kept;
    if (result.strippedFilenames.length > 0) {
      redacted.personalMemoryFiles = [
        ...(redacted.personalMemoryFiles ?? []),
        ...result.strippedFilenames,
      ];
    }
  }

  // Global settings permissions
  let globalSettings = bundle.global.settings;
  if (isPlainObject(globalSettings)) {
    const gs = globalSettings;
    const perms = gs.permissions;
    const result = stripHomedirPermissionRules(perms, sourceHomedir, '', platform);
    if (result.stripped.length > 0) {
      globalSettings = { ...gs, permissions: result.kept };
      redacted.homeDirPermissionRules = [
        ...(redacted.homeDirPermissionRules ?? []),
        ...result.stripped,
      ];
    }
  }

  // Global MCP config (standalone mcpConfig field)
  let mcpConfig = bundle.global.mcpConfig;
  if (mcpConfig !== undefined) {
    const result = stripLocalMcpServers(mcpConfig, sourceHomedir, '', platform);
    mcpConfig = result.kept;
    if (result.strippedNames.length > 0) {
      redacted.localMcpServers = [
        ...(redacted.localMcpServers ?? []),
        ...result.strippedNames,
      ];
    }
  }

  // MCP servers inside global settings (settings.mcpServers)
  if (isPlainObject(globalSettings)) {
    const gs = globalSettings;
    const mcpServers = gs.mcpServers;
    if (mcpServers !== undefined) {
      const result = stripLocalMcpServers(mcpServers, sourceHomedir, '', platform);
      if (result.strippedNames.length > 0) {
        globalSettings = { ...gs, mcpServers: result.kept };
        redacted.localMcpServers = [
          ...(redacted.localMcpServers ?? []),
          ...result.strippedNames,
        ];
      }
    }
  }

  // MCP servers inside claudeJson — process BEFORE allowlist strip so we can record them
  let claudeJson = bundle.global.claudeJson;
  if (isPlainObject(claudeJson)) {
    const innerMcp = claudeJson.mcpServers;
    if (innerMcp !== undefined) {
      const result = stripLocalMcpServers(innerMcp, sourceHomedir, 'claudeJson', platform);
      if (result.strippedNames.length > 0) {
        redacted.localMcpServers = [
          ...(redacted.localMcpServers ?? []),
          ...result.strippedNames,
        ];
      }
    }
  }

  // claudeJson user fields (allowlist filter — mcpServers not in allowlist, so removed here)
  const claudeJsonResult = stripClaudeJsonUserFields(claudeJson);
  claudeJson = claudeJsonResult.kept;
  if (claudeJsonResult.strippedFields.length > 0) {
    redacted.claudeJsonFields = [
      ...(redacted.claudeJsonFields ?? []),
      ...claudeJsonResult.strippedFields,
    ];
  }

  // Per-project filtering
  const projects: Project[] = bundle.projects.map((proj) => {
    let projMemories = proj.memories;
    if (projMemories !== undefined) {
      const result = stripPersonalMemories(projMemories, proj.slug);
      projMemories = result.kept;
      if (result.strippedFilenames.length > 0) {
        redacted.personalMemoryFiles = [
          ...(redacted.personalMemoryFiles ?? []),
          ...result.strippedFilenames,
        ];
      }
    }

    let projSettings = proj.settings;
    if (isPlainObject(projSettings)) {
      const ps = projSettings;
      const perms = ps.permissions;
      const result = stripHomedirPermissionRules(perms, sourceHomedir, proj.slug, platform);
      if (result.stripped.length > 0) {
        projSettings = { ...ps, permissions: result.kept };
        redacted.homeDirPermissionRules = [
          ...(redacted.homeDirPermissionRules ?? []),
          ...result.stripped,
        ];
      }
    }

    // Strip session history unconditionally (AC11)
    const { sessions: _dropped, ...projWithoutSessions } = proj;
    void _dropped;

    return {
      ...projWithoutSessions,
      ...(projMemories !== undefined ? { memories: projMemories } : {}),
      ...(projSettings !== undefined ? { settings: projSettings } : {}),
    };
  });

  // Build sanitized global
  const newGlobal = {
    ...bundle.global,
    ...(globalMemories !== undefined ? { memories: globalMemories } : { memories: undefined }),
    ...(globalSettings !== undefined ? { settings: globalSettings } : {}),
    ...(mcpConfig !== undefined ? { mcpConfig } : { mcpConfig: undefined }),
    ...(claudeJson !== undefined ? { claudeJson } : { claudeJson: undefined }),
  };

  // Remove undefined keys from global (Zod strict schema won't accept explicit undefined)
  const cleanGlobal = Object.fromEntries(
    Object.entries(newGlobal).filter(([, v]) => v !== undefined),
  );

  const hasRedacted = Object.keys(redacted).length > 0;

  return {
    ...bundle,
    projects,
    global: cleanGlobal,
    credentials,
    ...(hasRedacted ? { wasRedacted: redacted } : {}),
  };
}

// Verify at compile time that SanitizationProfile covers all canonical categories.
// This will fail to typecheck if a new category is added to ALL_CATEGORIES
// without updating SanitizationProfile.
const _allCategoriesCheck: readonly (keyof SanitizationProfile)[] = [
  ...ALL_CATEGORIES,
  'credentials',
  'claudeJson',
] as const;
void _allCategoriesCheck;
