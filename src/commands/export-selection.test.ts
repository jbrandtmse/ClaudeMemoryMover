import { describe, it, expect } from 'vitest';
import {
  parseCategories,
  detectClaudeVersion,
  defaultOutputPath,
  buildBundle,
} from './export-selection.js';
import { CmemmovError } from '../core/error.js';
import { ALL_CATEGORIES } from '../core/decision-schema.js';
import { BUNDLE_FORMAT_VERSION } from '../core/bundle-schema.js';
import type { ClaudeSurface, ProjectSurface } from '../services/claude-reader.js';

function makeSurface(overrides: Partial<ClaudeSurface> = {}): ClaudeSurface {
  return {
    claudeDir: '/home/u/.claude',
    claudeJson: undefined,
    credentialsRef: undefined,
    globalSettings: undefined,
    globalMemory: [],
    claudeMd: undefined,
    mcpConfig: undefined,
    customCommands: [],
    teams: undefined,
    plugins: undefined,
    projects: [],
    ...overrides,
  };
}

function makeProject(overrides: Partial<ProjectSurface> = {}): ProjectSurface {
  return {
    slug: '-home-u-app',
    settings: undefined,
    memories: [],
    claudeMd: undefined,
    sessions: [],
    ...overrides,
  };
}

describe('parseCategories', () => {
  it('expands "all" to every category', () => {
    expect(parseCategories('all')).toEqual([...ALL_CATEGORIES]);
  });

  it('accepts camelCase aliases', () => {
    expect(parseCategories('globalMemory,projectMemory,sessionHistory')).toEqual([
      'globalMemory',
      'projectMemory',
      'sessionHistory',
    ]);
  });

  it('accepts kebab-case aliases', () => {
    expect(parseCategories('global-memory,project-memory,session-history')).toEqual([
      'globalMemory',
      'projectMemory',
      'sessionHistory',
    ]);
  });

  it('accepts shorthand aliases (settings, mcp, commands)', () => {
    expect(parseCategories('settings,mcp,commands')).toEqual([
      'globalSettings',
      'mcpConfig',
      'customCommands',
    ]);
  });

  it('deduplicates repeated aliases preserving first occurrence', () => {
    expect(parseCategories('claudeMd,claude-md,teams,teams')).toEqual(['claudeMd', 'teams']);
  });

  it('throws CmemmovError(INTERNAL) for unknown alias', () => {
    expect(() => parseCategories('not-a-category')).toThrow(CmemmovError);
    try {
      parseCategories('not-a-category');
    } catch (err) {
      expect(err).toMatchObject({ code: 'INTERNAL', hint: 'unknown category: not-a-category' });
    }
  });

  it('returns [] for empty string', () => {
    expect(parseCategories('')).toEqual([]);
  });

  it('trims whitespace around tokens', () => {
    expect(parseCategories(' globalMemory , teams ')).toEqual(['globalMemory', 'teams']);
  });
});

describe('detectClaudeVersion', () => {
  it('returns version from first session line that has one', () => {
    const projects: ProjectSurface[] = [
      makeProject({
        sessions: [
          {
            filename: 's.jsonl',
            lines: [JSON.stringify({ cwd: '/x' }), JSON.stringify({ version: '2.1.133', cwd: '/x' })],
          },
        ],
      }),
    ];
    expect(detectClaudeVersion(projects)).toBe('2.1.133');
  });

  it('falls back to "unknown" when no version found', () => {
    const projects: ProjectSurface[] = [
      makeProject({ sessions: [{ filename: 's.jsonl', lines: [JSON.stringify({ cwd: '/x' })] }] }),
    ];
    expect(detectClaudeVersion(projects)).toBe('unknown');
  });

  it('skips malformed lines and continues searching', () => {
    const projects: ProjectSurface[] = [
      makeProject({
        sessions: [
          {
            filename: 's.jsonl',
            lines: ['not-json', JSON.stringify({ version: '3.0.0' })],
          },
        ],
      }),
    ];
    expect(detectClaudeVersion(projects)).toBe('3.0.0');
  });

  it('returns "unknown" for empty projects array', () => {
    expect(detectClaudeVersion([])).toBe('unknown');
  });

  it('ignores non-object JSON lines', () => {
    const projects: ProjectSurface[] = [
      makeProject({ sessions: [{ filename: 's.jsonl', lines: ['"hello"', '42'] }] }),
    ];
    expect(detectClaudeVersion(projects)).toBe('unknown');
  });
});

describe('defaultOutputPath', () => {
  it('returns a path containing the YYYY-MM-DD date and .cmemmov suffix', () => {
    const p = defaultOutputPath();
    expect(p).toMatch(/claude-export-\d{4}-\d{2}-\d{2}\.cmemmov$/);
  });
});

describe('buildBundle', () => {
  it('produces a Bundle with required top-level metadata', () => {
    const bundle = buildBundle({
      surface: makeSurface(),
      categories: [],
      includeCredentials: false,
      selectedSlugs: [],
      projectOriginalPaths: new Map(),
      claudeVersion: '2.1.133',
      credentialsContent: undefined,
    });
    expect(bundle.version).toBe(BUNDLE_FORMAT_VERSION);
    expect(bundle.claudeVersion).toBe('2.1.133');
    expect(bundle.hasCredentials).toBe(false);
    expect(bundle.projects).toEqual([]);
    expect(bundle.global).toEqual({});
    expect(bundle.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(['win32', 'darwin', 'linux']).toContain(bundle.sourcePlatform);
  });

  it('populates only globalMemory when only that category is selected', () => {
    const bundle = buildBundle({
      surface: makeSurface({
        globalMemory: [{ filename: 'MEMORY.md', content: '# Index' }],
        globalSettings: { model: 'sonnet' },
      }),
      categories: ['globalMemory'],
      includeCredentials: false,
      selectedSlugs: [],
      projectOriginalPaths: new Map(),
      claudeVersion: '2',
      credentialsContent: undefined,
    });
    expect(bundle.global.memories).toHaveLength(1);
    expect(bundle.global.settings).toBeUndefined();
  });

  it('uses originalPath from projectOriginalPaths map; falls back to slug', () => {
    const bundle = buildBundle({
      surface: makeSurface({
        projects: [makeProject({ slug: '-home-u-a' }), makeProject({ slug: '-home-u-b' })],
      }),
      categories: [],
      includeCredentials: false,
      selectedSlugs: ['-home-u-a', '-home-u-b'],
      projectOriginalPaths: new Map([['-home-u-a', '/home/u/a']]),
      claudeVersion: '2',
      credentialsContent: undefined,
    });
    expect(bundle.projects).toEqual([
      { slug: '-home-u-a', originalPath: '/home/u/a' },
      { slug: '-home-u-b', originalPath: '-home-u-b' },
    ]);
  });

  it('populates project memories only when projectMemory category is selected and memories exist', () => {
    const surface = makeSurface({
      projects: [
        makeProject({
          slug: '-home-u-app',
          memories: [{ filename: 'm.md', content: 'x' }],
          claudeMd: 'global-md',
        }),
      ],
    });
    const without = buildBundle({
      surface,
      categories: [],
      includeCredentials: false,
      selectedSlugs: ['-home-u-app'],
      projectOriginalPaths: new Map([['-home-u-app', '/home/u/app']]),
      claudeVersion: '2',
      credentialsContent: undefined,
    });
    expect(without.projects[0]?.memories).toBeUndefined();

    const withMem = buildBundle({
      surface,
      categories: ['projectMemory'],
      includeCredentials: false,
      selectedSlugs: ['-home-u-app'],
      projectOriginalPaths: new Map([['-home-u-app', '/home/u/app']]),
      claudeVersion: '2',
      credentialsContent: undefined,
    });
    expect(withMem.projects[0]?.memories).toHaveLength(1);
  });

  it('populates sessionHistory only when selected', () => {
    const surface = makeSurface({
      projects: [
        makeProject({
          slug: '-home-u-app',
          sessions: [{ filename: 's.jsonl', lines: ['x'] }],
        }),
      ],
    });
    const bundle = buildBundle({
      surface,
      categories: ['sessionHistory'],
      includeCredentials: false,
      selectedSlugs: ['-home-u-app'],
      projectOriginalPaths: new Map([['-home-u-app', '/home/u/app']]),
      claudeVersion: '2',
      credentialsContent: undefined,
    });
    expect(bundle.projects[0]?.sessions).toHaveLength(1);
  });

  it('mcpConfig populates global.mcpConfig only when globalSettings NOT selected', () => {
    const surface = makeSurface({
      mcpConfig: { servers: { x: { command: 'y' } } },
      globalSettings: { model: 'sonnet', mcpServers: { x: {} } },
    });
    const onlyMcp = buildBundle({
      surface,
      categories: ['mcpConfig'],
      includeCredentials: false,
      selectedSlugs: [],
      projectOriginalPaths: new Map(),
      claudeVersion: '2',
      credentialsContent: undefined,
    });
    expect(onlyMcp.global.mcpConfig).toEqual({ servers: { x: { command: 'y' } } });
    expect(onlyMcp.global.settings).toBeUndefined();

    const both = buildBundle({
      surface,
      categories: ['globalSettings', 'mcpConfig'],
      includeCredentials: false,
      selectedSlugs: [],
      projectOriginalPaths: new Map(),
      claudeVersion: '2',
      credentialsContent: undefined,
    });
    expect(both.global.settings).toBeDefined();
    expect(both.global.mcpConfig).toBeUndefined();
  });

  it('always includes claudeJson if present on surface (regardless of categories)', () => {
    const bundle = buildBundle({
      surface: makeSurface({ claudeJson: { firstStartTime: 'x' } }),
      categories: [],
      includeCredentials: false,
      selectedSlugs: [],
      projectOriginalPaths: new Map(),
      claudeVersion: '2',
      credentialsContent: undefined,
    });
    expect(bundle.global.claudeJson).toEqual({ firstStartTime: 'x' });
  });

  it('sets warning + credentials when includeCredentials true', () => {
    const bundle = buildBundle({
      surface: makeSurface(),
      categories: [],
      includeCredentials: true,
      selectedSlugs: [],
      projectOriginalPaths: new Map(),
      claudeVersion: '2',
      credentialsContent: { token: 'abc' },
    });
    expect(bundle.hasCredentials).toBe(true);
    expect(bundle.warning).toMatch(/credentials/i);
    expect(bundle.credentials).toEqual({ content: { token: 'abc' }, wasRedacted: false });
  });

  it('omits warning and credentials when includeCredentials false', () => {
    const bundle = buildBundle({
      surface: makeSurface(),
      categories: [],
      includeCredentials: false,
      selectedSlugs: [],
      projectOriginalPaths: new Map(),
      claudeVersion: '2',
      credentialsContent: undefined,
    });
    expect(bundle.warning).toBeUndefined();
    expect(bundle.credentials).toBeUndefined();
  });

  it('claudeMd populates both global.claudeMd and per-project claudeMd when selected', () => {
    const surface = makeSurface({
      claudeMd: 'global content',
      projects: [makeProject({ slug: 's', claudeMd: 'project content' })],
    });
    const bundle = buildBundle({
      surface,
      categories: ['claudeMd'],
      includeCredentials: false,
      selectedSlugs: ['s'],
      projectOriginalPaths: new Map([['s', '/p']]),
      claudeVersion: '2',
      credentialsContent: undefined,
    });
    expect(bundle.global.claudeMd).toBe('global content');
    expect(bundle.projects[0]?.claudeMd).toBe('project content');
  });

  it('customCommands and teams and plugins populate only when categories selected', () => {
    const surface = makeSurface({
      customCommands: [{ filename: 'c.md', content: '# cmd' }],
      teams: { t: {} },
      plugins: { p: {} },
    });
    const empty = buildBundle({
      surface,
      categories: ['globalMemory'],
      includeCredentials: false,
      selectedSlugs: [],
      projectOriginalPaths: new Map(),
      claudeVersion: '2',
      credentialsContent: undefined,
    });
    expect(empty.global.customCommands).toBeUndefined();
    expect(empty.global.teams).toBeUndefined();
    expect(empty.global.plugins).toBeUndefined();

    const full = buildBundle({
      surface,
      categories: ['customCommands', 'teams', 'plugins'],
      includeCredentials: false,
      selectedSlugs: [],
      projectOriginalPaths: new Map(),
      claudeVersion: '2',
      credentialsContent: undefined,
    });
    expect(full.global.customCommands).toHaveLength(1);
    expect(full.global.teams).toEqual({ t: {} });
    expect(full.global.plugins).toEqual({ p: {} });
  });
});
