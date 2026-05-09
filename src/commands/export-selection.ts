import { join } from 'node:path';
import process from 'node:process';
import {
  type Bundle,
  type Global,
  type Project,
  BUNDLE_FORMAT_VERSION,
} from '../core/bundle-schema.js';
import { type ClaudeCategory, ALL_CATEGORIES } from '../core/decision-schema.js';
import { CmemmovError } from '../core/error.js';
import type { ClaudeSurface, ProjectSurface } from '../services/claude-reader.js';

type SupportedPlatform = 'win32' | 'darwin' | 'linux';

function assertSupportedPlatform(platform: NodeJS.Platform): SupportedPlatform {
  if (platform === 'win32' || platform === 'darwin' || platform === 'linux') {
    return platform;
  }
  throw new CmemmovError({
    code: 'INTERNAL',
    hint: `unsupported platform '${platform}'; cmemmov supports win32, darwin, linux`,
  });
}

const CATEGORY_ALIASES: Record<string, ClaudeCategory> = {
  globalMemory: 'globalMemory',
  'global-memory': 'globalMemory',
  projectMemory: 'projectMemory',
  'project-memory': 'projectMemory',
  globalSettings: 'globalSettings',
  'global-settings': 'globalSettings',
  settings: 'globalSettings',
  projectSettings: 'projectSettings',
  'project-settings': 'projectSettings',
  claudeMd: 'claudeMd',
  'claude-md': 'claudeMd',
  mcpConfig: 'mcpConfig',
  'mcp-config': 'mcpConfig',
  mcp: 'mcpConfig',
  customCommands: 'customCommands',
  'custom-commands': 'customCommands',
  commands: 'customCommands',
  teams: 'teams',
  plugins: 'plugins',
  sessionHistory: 'sessionHistory',
  'session-history': 'sessionHistory',
};

export function parseCategories(raw: string): ClaudeCategory[] {
  const tokens = raw.split(',').map((t) => t.trim()).filter((t) => t.length > 0);
  if (tokens.length === 0) return [];

  if (tokens.includes('all')) {
    return [...ALL_CATEGORIES];
  }

  const seen = new Set<ClaudeCategory>();
  const result: ClaudeCategory[] = [];
  for (const token of tokens) {
    const cat = CATEGORY_ALIASES[token];
    if (cat === undefined) {
      throw new CmemmovError({
        code: 'INTERNAL',
        hint: `unknown category: ${token}`,
      });
    }
    if (!seen.has(cat)) {
      seen.add(cat);
      result.push(cat);
    }
  }
  return result;
}

export function detectClaudeVersion(projects: ProjectSurface[]): string {
  for (const project of projects) {
    for (const session of project.sessions) {
      for (const line of session.lines) {
        try {
          const obj = JSON.parse(line) as unknown;
          if (typeof obj === 'object' && obj !== null) {
            const ver = (obj as Record<string, unknown>).version;
            if (typeof ver === 'string' && ver.length > 0) {
              return ver;
            }
          }
        } catch {
          // skip malformed line
        }
      }
    }
  }
  return 'unknown';
}

export function defaultOutputPath(): string {
  const date = new Date().toISOString().slice(0, 10);
  return join(process.cwd(), `claude-export-${date}.cmemmov`);
}

interface BuildBundleOpts {
  surface: ClaudeSurface;
  categories: ClaudeCategory[];
  includeCredentials: boolean;
  selectedSlugs: string[];
  projectOriginalPaths: Map<string, string>;
  claudeVersion: string;
  credentialsContent: unknown;
}

export function buildBundle(opts: BuildBundleOpts): Bundle {
  const cats = new Set(opts.categories);

  const projects: Project[] = opts.selectedSlugs.map((slug) => {
    const proj = opts.surface.projects.find((p) => p.slug === slug);
    const originalPath = opts.projectOriginalPaths.get(slug) ?? slug;
    const entry: Project = { slug, originalPath };
    if (cats.has('projectSettings') && proj?.settings !== undefined) {
      entry.settings = proj.settings;
    }
    if (cats.has('projectMemory') && proj && proj.memories.length > 0) {
      entry.memories = proj.memories;
    }
    if (cats.has('claudeMd') && proj?.claudeMd !== undefined) {
      entry.claudeMd = proj.claudeMd;
    }
    if (cats.has('sessionHistory') && proj && proj.sessions.length > 0) {
      entry.sessions = proj.sessions;
    }
    return entry;
  });

  const global: Global = {};
  if (cats.has('globalSettings') && opts.surface.globalSettings !== undefined) {
    global.settings = opts.surface.globalSettings;
  }
  if (cats.has('globalMemory') && opts.surface.globalMemory.length > 0) {
    global.memories = opts.surface.globalMemory;
  }
  if (cats.has('claudeMd') && opts.surface.claudeMd !== undefined) {
    global.claudeMd = opts.surface.claudeMd;
  }
  if (cats.has('customCommands') && opts.surface.customCommands.length > 0) {
    global.customCommands = opts.surface.customCommands;
  }
  if (cats.has('teams') && opts.surface.teams !== undefined) {
    global.teams = opts.surface.teams;
  }
  if (cats.has('plugins') && opts.surface.plugins !== undefined) {
    global.plugins = opts.surface.plugins;
  }
  if (
    cats.has('mcpConfig') &&
    !cats.has('globalSettings') &&
    opts.surface.mcpConfig !== undefined
  ) {
    global.mcpConfig = opts.surface.mcpConfig;
  }
  if (opts.surface.claudeJson !== undefined) {
    global.claudeJson = opts.surface.claudeJson;
  }

  const bundle: Bundle = {
    version: BUNDLE_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    sourcePlatform: assertSupportedPlatform(process.platform),
    claudeVersion: opts.claudeVersion,
    hasCredentials: opts.includeCredentials,
    projects,
    global,
  };

  if (opts.includeCredentials) {
    bundle.warning = 'This bundle contains credentials. Do not share publicly.';
    bundle.credentials = { content: opts.credentialsContent ?? null, wasRedacted: false };
  }

  return bundle;
}
