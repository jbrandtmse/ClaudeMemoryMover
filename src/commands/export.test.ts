import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ClaudeSurface, OriginalPathResult } from '../services/claude-reader.js';

const state = vi.hoisted<{
  surface: ClaudeSurface;
  pathResults: Map<string, OriginalPathResult>;
  selectedCategories: string[];
  selectedProjectSlugs: string[];
  confirmCredentialsValue: boolean;
  promptOriginalPathValue: string | null;
  serializedBytes: Buffer;
  credentialsFileText: string;
  writeFileCalls: { path: string; bytes: Buffer }[];
  readFileCalls: string[];
  writeFileShouldThrow: Error | null;
}>(() => ({
  surface: {
    claudeDir: '/c',
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
  },
  pathResults: new Map(),
  selectedCategories: ['globalMemory'],
  selectedProjectSlugs: [],
  confirmCredentialsValue: false,
  promptOriginalPathValue: '/home/user/confirmed',
  serializedBytes: Buffer.from('{"fake":true}'),
  credentialsFileText: '{"token":"abc"}',
  writeFileCalls: [],
  readFileCalls: [],
  writeFileShouldThrow: null,
}));

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    writeFile: vi.fn((path: string, bytes: Buffer | string) => {
      if (state.writeFileShouldThrow) throw state.writeFileShouldThrow;
      const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
      state.writeFileCalls.push({ path, bytes: buf });
      return Promise.resolve();
    }),
  };
});

vi.mock('../services/claude-locator.js', () => ({
  locateClaude: vi.fn(() => ({ claudeDir: '/c', claudeJson: '/c.json' })),
}));

vi.mock('../services/claude-reader.js', () => ({
  readClaudeSurface: vi.fn(() => Promise.resolve(state.surface)),
  readClaudeJsonFile: vi.fn((path: string) => {
    state.readFileCalls.push(path);
    try {
      return Promise.resolve(JSON.parse(state.credentialsFileText) as unknown);
    } catch {
      return Promise.resolve(undefined);
    }
  }),
  resolveOriginalPath: vi.fn((slug: string) => {
    const r = state.pathResults.get(slug);
    if (r) return Promise.resolve(r);
    return Promise.resolve({ path: slug, source: null } as OriginalPathResult);
  }),
}));

vi.mock('../services/bundle-serializer.js', () => ({
  serializeBundle: vi.fn(() => state.serializedBytes),
}));

vi.mock('../ui/prompts.js', () => ({
  selectCategories: vi.fn(async () => Promise.resolve(state.selectedCategories)),
  selectProjects: vi.fn(async () => Promise.resolve(state.selectedProjectSlugs)),
  confirmCredentials: vi.fn(async () => Promise.resolve(state.confirmCredentialsValue)),
  promptOriginalPath: vi.fn(async (opts: { silent: boolean; value?: string; slug: string }) => {
    if (opts.silent) {
      if (opts.value === undefined) {
        const { CmemmovError } = await import('../core/error.js');
        throw new CmemmovError({
          code: 'PATH_REMAP_AMBIGUOUS',
          hint: `--project-path <slug>=<path> required for memory-only project ${opts.slug}`,
        });
      }
      return opts.value;
    }
    if (state.promptOriginalPathValue === null) {
      throw new Error('promptOriginalPath was not expected to be called');
    }
    return state.promptOriginalPathValue;
  }),
  createSpinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn(), fail: vi.fn() })),
}));

import { run } from './export.js';
import { CmemmovError } from '../core/error.js';
import { BundleSchema } from '../core/bundle-schema.js';
import * as fsPromises from 'node:fs/promises';
import * as serializer from '../services/bundle-serializer.js';
import * as prompts from '../ui/prompts.js';

function resetState(): void {
  state.surface = {
    claudeDir: '/c',
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
  };
  state.pathResults = new Map();
  state.selectedCategories = ['globalMemory'];
  state.selectedProjectSlugs = [];
  state.confirmCredentialsValue = false;
  state.promptOriginalPathValue = '/home/user/confirmed';
  state.serializedBytes = Buffer.from('{"fake":true}');
  state.credentialsFileText = '{"token":"abc"}';
  state.writeFileCalls = [];
  state.readFileCalls = [];
  state.writeFileShouldThrow = null;
}

beforeEach(() => {
  resetState();
  vi.mocked(fsPromises.writeFile).mockClear();
  vi.mocked(serializer.serializeBundle).mockClear();
  vi.mocked(prompts.selectCategories).mockClear();
  vi.mocked(prompts.selectProjects).mockClear();
  vi.mocked(prompts.confirmCredentials).mockClear();
  vi.mocked(prompts.promptOriginalPath).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AC1/AC2: interactive flow drives both prompts', () => {
  it('invokes selectCategories then selectProjects when no flags provided', async () => {
    state.surface.projects = [
      { slug: '-home-u-a', settings: undefined, memories: [], claudeMd: undefined, sessions: [] },
    ];
    state.pathResults.set('-home-u-a', { path: '/home/u/a', source: 'sessionCwd' });
    state.selectedCategories = ['globalMemory'];
    state.selectedProjectSlugs = ['-home-u-a'];
    await run({ output: '/tmp/x.cmemmov' });
    expect(prompts.selectCategories).toHaveBeenCalledTimes(1);
    expect(prompts.selectProjects).toHaveBeenCalledTimes(1);
    expect(state.writeFileCalls).toHaveLength(1);
  });
});

describe('AC3: sessionHistory is excluded by default; --include-sessions opts in', () => {
  it('does not pre-add sessionHistory when running without --include-sessions', async () => {
    state.surface.projects = [
      {
        slug: '-home-u-a',
        settings: undefined,
        memories: [],
        claudeMd: undefined,
        sessions: [{ filename: 's.jsonl', lines: ['{"version":"3"}'] }],
      },
    ];
    state.pathResults.set('-home-u-a', { path: '/home/u/a', source: 'sessionCwd' });
    state.selectedCategories = ['globalMemory'];
    state.selectedProjectSlugs = ['-home-u-a'];

    await run({ output: '/tmp/x.cmemmov' });
    const bundle = vi.mocked(serializer.serializeBundle).mock.calls[0]?.[0];
    expect(bundle?.projects[0]?.sessions).toBeUndefined();
  });

  it('includes sessionHistory when --include-sessions is set', async () => {
    state.surface.projects = [
      {
        slug: '-home-u-a',
        settings: undefined,
        memories: [],
        claudeMd: undefined,
        sessions: [{ filename: 's.jsonl', lines: ['{"version":"3"}'] }],
      },
    ];
    state.pathResults.set('-home-u-a', { path: '/home/u/a', source: 'sessionCwd' });

    await run({
      silent: true,
      categories: 'globalMemory',
      includeSessions: true,
      allProjects: true,
      output: '/tmp/x.cmemmov',
    });
    const bundle = vi.mocked(serializer.serializeBundle).mock.calls[0]?.[0];
    expect(bundle?.projects[0]?.sessions).toHaveLength(1);
  });
});

describe('AC4/AC5: credentials warning + bundle metadata', () => {
  it('warns to stderr BEFORE write and sets bundle.warning when --include-credentials', async () => {
    state.surface.credentialsRef = '/c/.credentials.json';
    state.credentialsFileText = '{"apiKey":"secret"}';

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await run({
      silent: true,
      categories: 'globalMemory',
      includeCredentials: true,
      allProjects: true,
      output: '/tmp/x.cmemmov',
    });

    const stderrText = stderrSpy.mock.calls
      .map((c) => (typeof c[0] === 'string' ? c[0] : Buffer.from(c[0]).toString('utf8')))
      .join('');
    expect(stderrText).toMatch(/credentials/i);

    const bundle = vi.mocked(serializer.serializeBundle).mock.calls[0]?.[0];
    expect(bundle?.warning).toMatch(/credentials/i);
    expect(bundle?.hasCredentials).toBe(true);
    expect(bundle?.credentials?.wasRedacted).toBe(false);

    stderrSpy.mockRestore();
  });

  it('does not include credentials by default; bundle.hasCredentials false; no warning field', async () => {
    state.surface.credentialsRef = '/c/.credentials.json';

    await run({
      silent: true,
      categories: 'globalMemory',
      allProjects: true,
      output: '/tmp/x.cmemmov',
    });

    const bundle = vi.mocked(serializer.serializeBundle).mock.calls[0]?.[0];
    expect(bundle?.hasCredentials).toBe(false);
    expect(bundle?.warning).toBeUndefined();
    expect(bundle?.credentials).toBeUndefined();
  });
});

describe('AC6: output path is --output or default', () => {
  it('writes to --output path when provided', async () => {
    await run({
      silent: true,
      categories: 'globalMemory',
      allProjects: true,
      output: '/tmp/explicit.cmemmov',
    });
    expect(state.writeFileCalls[0]?.path).toBe('/tmp/explicit.cmemmov');
  });

  it('writes to default path when --output omitted', async () => {
    await run({
      silent: true,
      categories: 'globalMemory',
      allProjects: true,
    });
    expect(state.writeFileCalls[0]?.path).toMatch(/claude-export-\d{4}-\d{2}-\d{2}\.cmemmov$/);
  });
});

describe('AC7: bundle metadata is correct', () => {
  it('bundle has claudeVersion fingerprint and per-project originalPath', async () => {
    state.surface.projects = [
      {
        slug: '-home-u-a',
        settings: undefined,
        memories: [],
        claudeMd: undefined,
        sessions: [{ filename: 's.jsonl', lines: ['{"version":"2.5.0"}'] }],
      },
    ];
    state.pathResults.set('-home-u-a', { path: '/home/u/a', source: 'sessionCwd' });

    await run({
      silent: true,
      categories: 'globalMemory',
      allProjects: true,
      output: '/tmp/x.cmemmov',
    });

    const bundle = vi.mocked(serializer.serializeBundle).mock.calls[0]?.[0];
    expect(bundle?.claudeVersion).toBe('2.5.0');
    expect(bundle?.projects[0]?.originalPath).toBe('/home/u/a');
    expect(BundleSchema.safeParse(bundle).success).toBe(true);
  });
});

describe('AC8: silent mode behavior', () => {
  it('silent + --categories + --output runs without prompts', async () => {
    await run({
      silent: true,
      categories: 'globalMemory,globalSettings',
      projects: 'all',
      output: '/tmp/silent.cmemmov',
    });
    expect(prompts.selectCategories).not.toHaveBeenCalled();
    expect(prompts.selectProjects).not.toHaveBeenCalled();
    expect(prompts.confirmCredentials).not.toHaveBeenCalled();
    expect(state.writeFileCalls).toHaveLength(1);
  });

  it('silent without --categories throws CmemmovError(INTERNAL)', async () => {
    await expect(run({ silent: true, allProjects: true })).rejects.toMatchObject({
      code: 'INTERNAL',
      hint: '--categories required in silent mode',
    });
  });
});

describe('AC11: empty categories', () => {
  it('throws EXPORT_NOTHING_SELECTED when interactive selection returns []', async () => {
    state.selectedCategories = [];
    await expect(run({ output: '/tmp/x.cmemmov' })).rejects.toBeInstanceOf(CmemmovError);
    await expect(run({ output: '/tmp/x.cmemmov' })).rejects.toMatchObject({
      code: 'EXPORT_NOTHING_SELECTED',
    });
  });
});

describe('AC12 (NFR8): bundle contents match selection only', () => {
  it('omits unselected categories from bundle', async () => {
    state.surface = {
      claudeDir: '/c',
      claudeJson: { x: 1 },
      credentialsRef: undefined,
      globalSettings: { model: 'sonnet' },
      globalMemory: [{ filename: 'm.md', content: '#' }],
      claudeMd: 'global-md',
      mcpConfig: { servers: {} },
      customCommands: [{ filename: 'c.md', content: '#' }],
      teams: { t: {} },
      plugins: { p: {} },
      projects: [
        {
          slug: '-home-u-a',
          settings: { x: 1 },
          memories: [{ filename: 'm.md', content: 'm' }],
          claudeMd: 'project-md',
          sessions: [{ filename: 's.jsonl', lines: ['{"version":"3"}'] }],
        },
      ],
    };
    state.pathResults.set('-home-u-a', { path: '/home/u/a', source: 'sessionCwd' });

    await run({
      silent: true,
      categories: 'globalMemory',
      allProjects: true,
      output: '/tmp/x.cmemmov',
    });

    const bundle = vi.mocked(serializer.serializeBundle).mock.calls[0]?.[0];
    expect(bundle?.global.memories).toHaveLength(1);
    expect(bundle?.global.settings).toBeUndefined();
    expect(bundle?.global.claudeMd).toBeUndefined();
    expect(bundle?.global.mcpConfig).toBeUndefined();
    expect(bundle?.global.customCommands).toBeUndefined();
    expect(bundle?.global.teams).toBeUndefined();
    expect(bundle?.global.plugins).toBeUndefined();
    expect(bundle?.projects[0]?.settings).toBeUndefined();
    expect(bundle?.projects[0]?.memories).toBeUndefined();
    expect(bundle?.projects[0]?.claudeMd).toBeUndefined();
    expect(bundle?.projects[0]?.sessions).toBeUndefined();
    expect(bundle?.global.claudeJson).toEqual({ x: 1 });
  });
});

describe('AC13: slugDecode project triggers path confirmation', () => {
  it('calls promptOriginalPath for slugDecode source and uses confirmed path in bundle', async () => {
    state.surface.projects = [
      { slug: '-home-u-a', settings: undefined, memories: [], claudeMd: undefined, sessions: [] },
    ];
    state.pathResults.set('-home-u-a', { path: '/home/u/a-decoded', source: 'slugDecode' });
    state.selectedCategories = ['globalMemory'];
    state.selectedProjectSlugs = ['-home-u-a'];
    state.promptOriginalPathValue = '/home/u/corrected';

    await run({ output: '/tmp/x.cmemmov' });

    expect(prompts.promptOriginalPath).toHaveBeenCalledWith(
      expect.objectContaining({ slug: '-home-u-a', suggestedPath: '/home/u/a-decoded', silent: false }),
    );
    const bundle = vi.mocked(serializer.serializeBundle).mock.calls[0]?.[0];
    expect(bundle?.projects[0]?.originalPath).toBe('/home/u/corrected');
  });
});

describe('AC14: memory-only project in silent mode without --project-path', () => {
  it('throws PATH_REMAP_AMBIGUOUS', async () => {
    state.surface.projects = [
      { slug: '-home-u-a', settings: undefined, memories: [], claudeMd: undefined, sessions: [] },
    ];
    state.pathResults.set('-home-u-a', { path: '/home/u/a', source: 'slugDecode' });

    await expect(
      run({
        silent: true,
        categories: 'projectMemory',
        allProjects: true,
        output: '/tmp/x.cmemmov',
      }),
    ).rejects.toMatchObject({
      code: 'PATH_REMAP_AMBIGUOUS',
      hint: expect.stringContaining('--project-path') as unknown,
    });
  });

  it('uses --project-path override without prompting', async () => {
    state.surface.projects = [
      { slug: '-home-u-a', settings: undefined, memories: [], claudeMd: undefined, sessions: [] },
    ];
    state.pathResults.set('-home-u-a', { path: '/home/u/a', source: 'slugDecode' });

    await run({
      silent: true,
      categories: 'projectMemory',
      allProjects: true,
      output: '/tmp/x.cmemmov',
      projectPath: { '-home-u-a': '/explicit/path' },
    });

    const bundle = vi.mocked(serializer.serializeBundle).mock.calls[0]?.[0];
    expect(bundle?.projects[0]?.originalPath).toBe('/explicit/path');
  });
});

describe('AC9 (--json) and AC10 (progress)', () => {
  it('--json: progress to stderr, single JSON line on stdout', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await run({
      silent: true,
      json: true,
      categories: 'globalMemory',
      allProjects: true,
      output: '/tmp/x.cmemmov',
    });

    const stdoutText = stdoutSpy.mock.calls
      .map((c) => (typeof c[0] === 'string' ? c[0] : Buffer.from(c[0]).toString('utf8')))
      .join('');
    const lines = stdoutText.split('\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0] ?? '') as {
      success: boolean;
      command: string;
      summary: string;
      errors: unknown[];
      warnings: string[];
    };
    expect(parsed.success).toBe(true);
    expect(parsed.command).toBe('export');

    const stderrText = stderrSpy.mock.calls
      .map((c) => (typeof c[0] === 'string' ? c[0] : Buffer.from(c[0]).toString('utf8')))
      .join('');
    expect(stderrText.length).toBeGreaterThan(0);

    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });
});

describe('parseCategories flag normalization', () => {
  it('accepts kebab-case and camelCase mixed', async () => {
    await run({
      silent: true,
      categories: 'global-memory,projectMemory',
      allProjects: true,
      output: '/tmp/x.cmemmov',
    });
    const bundle = vi.mocked(serializer.serializeBundle).mock.calls[0]?.[0];
    expect(bundle?.hasCredentials).toBe(false);
  });
});

describe('credentials file content', () => {
  it('reads credentials file when --include-credentials and credentialsRef present', async () => {
    state.surface.credentialsRef = '/c/.credentials.json';
    state.credentialsFileText = '{"apiKey":"abc"}';

    await run({
      silent: true,
      categories: 'globalMemory',
      includeCredentials: true,
      allProjects: true,
      output: '/tmp/x.cmemmov',
    });

    expect(state.readFileCalls).toContain('/c/.credentials.json');
    const bundle = vi.mocked(serializer.serializeBundle).mock.calls[0]?.[0];
    expect(bundle?.credentials?.content).toEqual({ apiKey: 'abc' });
  });

  it('credentials.content is null when credentials file is not valid JSON', async () => {
    state.surface.credentialsRef = '/c/.credentials.json';
    state.credentialsFileText = 'not json';

    await run({
      silent: true,
      categories: 'globalMemory',
      includeCredentials: true,
      allProjects: true,
      output: '/tmp/x.cmemmov',
    });

    const bundle = vi.mocked(serializer.serializeBundle).mock.calls[0]?.[0];
    expect(bundle?.credentials?.content).toBeNull();
  });

  it('warns when --include-credentials requested but no credentials file present', async () => {
    state.surface.credentialsRef = undefined;
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await run({
      silent: true,
      categories: 'globalMemory',
      includeCredentials: true,
      allProjects: true,
      output: '/tmp/x.cmemmov',
    });

    const stderrText = stderrSpy.mock.calls
      .map((c) => (typeof c[0] === 'string' ? c[0] : Buffer.from(c[0]).toString('utf8')))
      .join('');
    expect(stderrText).toMatch(/no credentials file/i);
    stderrSpy.mockRestore();
  });
});

describe('regression: --include-sessions interactive without --categories shows multi-select', () => {
  it('still calls selectCategories when only --include-sessions is passed (no --categories)', async () => {
    state.surface.projects = [
      {
        slug: '-home-u-a',
        settings: undefined,
        memories: [],
        claudeMd: undefined,
        sessions: [{ filename: 's.jsonl', lines: ['{"version":"3"}'] }],
      },
    ];
    state.pathResults.set('-home-u-a', { path: '/home/u/a', source: 'sessionCwd' });
    state.selectedCategories = ['globalMemory'];
    state.selectedProjectSlugs = ['-home-u-a'];

    await run({ includeSessions: true, output: '/tmp/x.cmemmov' });

    expect(prompts.selectCategories).toHaveBeenCalledTimes(1);
    const bundle = vi.mocked(serializer.serializeBundle).mock.calls[0]?.[0];
    // sessionHistory should still be added because --include-sessions was passed,
    // even though the user did not pick it from the multi-select.
    expect(bundle?.projects[0]?.sessions).toHaveLength(1);
  });
});

describe('regression: silent --projects validates slug existence', () => {
  it('throws CmemmovError(INTERNAL) for unknown slug in silent mode', async () => {
    state.surface.projects = [
      { slug: '-home-u-real', settings: undefined, memories: [], claudeMd: undefined, sessions: [] },
    ];
    state.pathResults.set('-home-u-real', { path: '/home/u/real', source: 'sessionCwd' });

    await expect(
      run({
        silent: true,
        categories: 'globalMemory',
        projects: '-home-u-phantom',
        output: '/tmp/x.cmemmov',
      }),
    ).rejects.toMatchObject({
      code: 'INTERNAL',
      hint: expect.stringContaining('-home-u-phantom') as unknown,
    });
  });
});

describe('regression: --project-path is honored even when source is sessionCwd', () => {
  it('uses --project-path override over session-derived path', async () => {
    state.surface.projects = [
      { slug: '-home-u-a', settings: undefined, memories: [], claudeMd: undefined, sessions: [] },
    ];
    state.pathResults.set('-home-u-a', { path: '/session/cwd/path', source: 'sessionCwd' });

    await run({
      silent: true,
      categories: 'globalMemory',
      allProjects: true,
      output: '/tmp/x.cmemmov',
      projectPath: { '-home-u-a': '/explicit/override' },
    });

    const bundle = vi.mocked(serializer.serializeBundle).mock.calls[0]?.[0];
    expect(bundle?.projects[0]?.originalPath).toBe('/explicit/override');
  });

  it('rejects empty --project-path value with PATH_REMAP_AMBIGUOUS', async () => {
    state.surface.projects = [
      { slug: '-home-u-a', settings: undefined, memories: [], claudeMd: undefined, sessions: [] },
    ];
    state.pathResults.set('-home-u-a', { path: '/home/u/a', source: 'sessionCwd' });

    await expect(
      run({
        silent: true,
        categories: 'globalMemory',
        allProjects: true,
        output: '/tmp/x.cmemmov',
        projectPath: { '-home-u-a': '' },
      }),
    ).rejects.toMatchObject({ code: 'PATH_REMAP_AMBIGUOUS' });
  });
});

describe('regression: --all-projects + --projects warns and uses all', () => {
  it('emits stderr warning and includes all projects', async () => {
    state.surface.projects = [
      { slug: '-home-u-a', settings: undefined, memories: [], claudeMd: undefined, sessions: [] },
      { slug: '-home-u-b', settings: undefined, memories: [], claudeMd: undefined, sessions: [] },
    ];
    state.pathResults.set('-home-u-a', { path: '/home/u/a', source: 'sessionCwd' });
    state.pathResults.set('-home-u-b', { path: '/home/u/b', source: 'sessionCwd' });

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await run({
      silent: true,
      categories: 'globalMemory',
      allProjects: true,
      projects: '-home-u-a',
      output: '/tmp/x.cmemmov',
    });

    const stderrText = stderrSpy.mock.calls
      .map((c) => (typeof c[0] === 'string' ? c[0] : Buffer.from(c[0]).toString('utf8')))
      .join('');
    expect(stderrText).toMatch(/--projects.+ignored/);

    const bundle = vi.mocked(serializer.serializeBundle).mock.calls[0]?.[0];
    expect(bundle?.projects).toHaveLength(2);
    stderrSpy.mockRestore();
  });
});

describe('regression: duplicate --projects slugs are deduped', () => {
  it('a,a in --projects yields one bundle entry', async () => {
    state.surface.projects = [
      { slug: '-home-u-a', settings: undefined, memories: [], claudeMd: undefined, sessions: [] },
    ];
    state.pathResults.set('-home-u-a', { path: '/home/u/a', source: 'sessionCwd' });

    await run({
      silent: true,
      categories: 'globalMemory',
      projects: '-home-u-a,-home-u-a',
      output: '/tmp/x.cmemmov',
    });

    const bundle = vi.mocked(serializer.serializeBundle).mock.calls[0]?.[0];
    expect(bundle?.projects).toHaveLength(1);
  });
});
