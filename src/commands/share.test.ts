import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ClaudeSurface } from '../services/claude-reader.js';

const state = vi.hoisted<{
  surface: ClaudeSurface;
  serializedBytes: Buffer;
  writeFileCalls: { path: string; bytes: Buffer }[];
  readCount: number;
  confirmShareWriteResult: 'yes' | 'no' | 'edit';
  promptOverridePatternsResult: { includePattern: string[]; excludePattern: string[] };
  selectShareCategoriesResult: string[];
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
  serializedBytes: Buffer.from('{"fake":true}'),
  writeFileCalls: [],
  readCount: 0,
  confirmShareWriteResult: 'yes',
  promptOverridePatternsResult: { includePattern: [], excludePattern: [] },
  selectShareCategoriesResult: ['claudeMd', 'customCommands', 'mcpConfig', 'globalSettings', 'teams', 'plugins'],
}));

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    writeFile: vi.fn((path: string, bytes: Buffer | string) => {
      const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
      state.writeFileCalls.push({ path, bytes: buf });
      return Promise.resolve();
    }),
  };
});

vi.mock('../services/claude-locator.js', () => ({
  locateClaude: vi.fn(() => ({ claudeDir: '/c', claudeJson: '/c.json' })),
  getSourceHomedir: vi.fn(() => '/home/user'),
}));

vi.mock('../services/claude-reader.js', () => ({
  readClaudeSurface: vi.fn(() => {
    state.readCount++;
    return Promise.resolve(state.surface);
  }),
  readClaudeJsonFile: vi.fn(() => Promise.resolve(undefined)),
  resolveOriginalPath: vi.fn((slug: string) => Promise.resolve({ path: slug, source: null })),
}));

vi.mock('../services/bundle-serializer.js', () => ({
  serializeBundle: vi.fn(() => state.serializedBytes),
}));

vi.mock('../ui/prompts.js', () => ({
  selectShareCategories: vi.fn(async () => Promise.resolve(state.selectShareCategoriesResult)),
  confirmShareWrite: vi.fn(async () => Promise.resolve(state.confirmShareWriteResult)),
  promptOverridePatterns: vi.fn(async () => Promise.resolve(state.promptOverridePatternsResult)),
  selectCategories: vi.fn(async () => Promise.resolve([])),
  createSpinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn(), fail: vi.fn() })),
}));

import {
  run,
  buildShareDecision,
  parseShareCategories,
  SHARE_CATEGORIES,
} from './share.js';
import { CmemmovError } from '../core/error.js';
import * as fsPromises from 'node:fs/promises';
import * as prompts from '../ui/prompts.js';
import * as reader from '../services/claude-reader.js';

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
  state.serializedBytes = Buffer.from('{"fake":true}');
  state.writeFileCalls = [];
  state.readCount = 0;
  state.confirmShareWriteResult = 'yes';
  state.promptOverridePatternsResult = { includePattern: [], excludePattern: [] };
  state.selectShareCategoriesResult = ['claudeMd', 'customCommands', 'mcpConfig', 'globalSettings', 'teams', 'plugins'];
}

beforeEach(() => {
  resetState();
  vi.mocked(fsPromises.writeFile).mockClear();
  vi.mocked(prompts.selectShareCategories).mockClear();
  vi.mocked(prompts.confirmShareWrite).mockClear();
  vi.mocked(prompts.promptOverridePatterns).mockClear();
  vi.mocked(reader.readClaudeSurface).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SHARE_CATEGORIES constant', () => {
  it('contains exactly the expected team-relevant categories', () => {
    expect(SHARE_CATEGORIES).toContain('claudeMd');
    expect(SHARE_CATEGORIES).toContain('customCommands');
    expect(SHARE_CATEGORIES).toContain('mcpConfig');
    expect(SHARE_CATEGORIES).toContain('globalSettings');
    expect(SHARE_CATEGORIES).toContain('teams');
    expect(SHARE_CATEGORIES).toContain('plugins');
    expect(SHARE_CATEGORIES).toHaveLength(6);
  });

  it('does NOT contain sessionHistory, globalMemory, projectMemory, projectSettings, claudeJson', () => {
    expect(SHARE_CATEGORIES).not.toContain('sessionHistory');
    expect(SHARE_CATEGORIES).not.toContain('globalMemory');
    expect(SHARE_CATEGORIES).not.toContain('projectMemory');
    expect(SHARE_CATEGORIES).not.toContain('projectSettings');
    expect(SHARE_CATEGORIES).not.toContain('claudeJson');
  });
});

describe('AC3 — --include-credentials throws SHARE_INVALID_SOURCE', () => {
  it('throws SHARE_INVALID_SOURCE BEFORE any filesystem read when --include-credentials is set', () => {
    let caught: unknown;
    try {
      buildShareDecision({ includeCredentials: true });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    expect(caught).toMatchObject({
      name: 'CmemmovError',
      code: 'SHARE_INVALID_SOURCE',
    });
    expect((caught as CmemmovError).exitCode).toBe(2);
    expect(state.readCount).toBe(0);
  });

  it('throws SHARE_INVALID_SOURCE via run() before any read', async () => {
    let caught: unknown;
    try {
      await run({ includeCredentials: true, silent: true, categories: 'claudeMd', output: '/tmp/out.cmemmov' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toMatchObject({ code: 'SHARE_INVALID_SOURCE' });
    expect(state.readCount).toBe(0);
  });

  it('throws SHARE_INVALID_SOURCE even in --silent mode', () => {
    let caught: unknown;
    try {
      buildShareDecision({ includeCredentials: true, silent: true });
    } catch (e) {
      caught = e;
    }
    expect(caught).toMatchObject({ code: 'SHARE_INVALID_SOURCE' });
  });
});

describe('AC2 — profile: team-baseline set on bundle', () => {
  it('bundle written to disk has profile field team-baseline via buildBundle', async () => {
    let capturedBundle: unknown;
    vi.mocked(fsPromises.writeFile).mockImplementation((path: unknown, bytes: unknown) => {
      void path;
      void bytes;
      return Promise.resolve();
    });
    const { serializeBundle } = await import('../services/bundle-serializer.js');
    vi.mocked(serializeBundle).mockImplementation((b) => {
      capturedBundle = b;
      return Buffer.from('{}');
    });

    await run({
      silent: true,
      categories: 'claudeMd',
      output: '/tmp/out.cmemmov',
    });

    const bundle = capturedBundle as Record<string, unknown>;
    expect(bundle).toBeDefined();
    expect(bundle.profile).toBe('team-baseline');
  });
});

describe('AC5 — silent happy path', () => {
  it('writes bundle when --silent with explicit categories and output', async () => {
    await run({
      silent: true,
      categories: 'claudeMd',
      output: '/tmp/baseline.cmemmov',
    });

    expect(state.writeFileCalls).toHaveLength(1);
    expect(state.writeFileCalls[0]?.path).toBe('/tmp/baseline.cmemmov');
  });

  it('silent mode exits 2 with --include-credentials (AC3 enforced in silent too)', async () => {
    let caught: unknown;
    try {
      await run({ silent: true, includeCredentials: true, categories: 'claudeMd', output: '/tmp/out.cmemmov' });
    } catch (e) {
      caught = e;
    }
    expect((caught as CmemmovError).code).toBe('SHARE_INVALID_SOURCE');
  });
});

describe('AC6 — JSON mode summary structure', () => {
  it('finish() receives expected summary shape in JSON mode', async () => {
    const stdoutWrites: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      if (typeof chunk === 'string') stdoutWrites.push(chunk);
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await run({
      json: true,
      silent: true,
      categories: 'claudeMd,settings',
      output: '/tmp/baseline.cmemmov',
    });

    vi.restoreAllMocks();

    const outputLine = stdoutWrites.join('');
    const parsed = JSON.parse(outputLine) as Record<string, unknown>;
    expect(parsed.success).toBe(true);
    expect(parsed.command).toBe('share');
    expect(parsed.warnings).toBeInstanceOf(Array);

    const summary = parsed.summary as Record<string, unknown>;
    expect(summary.categoriesIncluded).toBeInstanceOf(Array);
    expect(summary.outputPath).toBe('/tmp/baseline.cmemmov');
    expect(typeof summary.bundleBytes).toBe('number');
    expect(typeof summary.itemsStripped).toBe('number');
    expect(summary.wasRedacted).toBeDefined();
    void origWrite;
  });
});

describe('AC7 — --dry-run writes nothing', () => {
  it('does not write bundle when --dry-run', async () => {
    state.confirmShareWriteResult = 'yes';
    await run({
      dryRun: true,
      silent: true,
      categories: 'claudeMd',
      output: '/tmp/baseline.cmemmov',
    });

    expect(state.writeFileCalls).toHaveLength(0);
  });

  it('JSON summary still includes outputPath and dryRun: true in summary when --dry-run --json', async () => {
    const stdoutWrites: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      if (typeof chunk === 'string') stdoutWrites.push(chunk);
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await run({
      dryRun: true,
      json: true,
      silent: true,
      categories: 'claudeMd',
      output: '/tmp/baseline.cmemmov',
    });

    vi.restoreAllMocks();

    const parsed = JSON.parse(stdoutWrites.join('')) as Record<string, unknown>;
    const summary = parsed.summary as Record<string, unknown>;
    expect(summary.dryRun).toBe(true);
    expect(summary.outputPath).toBe('/tmp/baseline.cmemmov');
    expect(state.writeFileCalls).toHaveLength(0);
  });
});

describe('AC8 — interactive preview and Y/N/E flow', () => {
  it('[N] cancel throws INTERNAL with "share cancelled by user" and writes no bundle', async () => {
    state.confirmShareWriteResult = 'no';
    let caught: unknown;
    try {
      await run({
        categories: 'claudeMd',
        output: '/tmp/baseline.cmemmov',
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toMatchObject({ code: 'INTERNAL', hint: 'share cancelled by user' });
    expect(state.writeFileCalls).toHaveLength(0);
  });

  it('[E] edit cycle: prompts for overrides, re-sanitizes, surface is NOT re-read', async () => {
    let callCount = 0;
    state.confirmShareWriteResult = 'yes';
    vi.mocked(prompts.confirmShareWrite).mockImplementationOnce(() => {
      callCount++;
      return Promise.resolve('edit' as const);
    });
    vi.mocked(prompts.confirmShareWrite).mockImplementationOnce(() => Promise.resolve('yes' as const));
    state.promptOverridePatternsResult = { includePattern: ['todo2*'], excludePattern: [] };

    await run({
      categories: 'claudeMd',
      output: '/tmp/baseline.cmemmov',
    });

    expect(vi.mocked(prompts.promptOverridePatterns)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(reader.readClaudeSurface)).toHaveBeenCalledTimes(1);
    expect(state.writeFileCalls).toHaveLength(1);
    void callCount;
  });
});

describe('AC9 — pattern composition', () => {
  it('stock patterns apply by default', () => {
    const decision = buildShareDecision({
      silent: true,
      categories: 'claudeMd',
      output: '/tmp/out.cmemmov',
    });
    const sources = decision.personalPatterns.map((p) => p.source);
    expect(sources).toContain('^todo');
    expect(sources).toContain('^personal');
  });

  it('--include-pattern adds a new pattern', () => {
    const decision = buildShareDecision({
      silent: true,
      categories: 'claudeMd',
      output: '/tmp/out.cmemmov',
      includePattern: ['todo2*'],
    });
    const sources = decision.personalPatterns.map((p) => p.source);
    expect(sources).toContain('^todo2.*');
  });

  it('--exclude-pattern removes a stock pattern', () => {
    const decision = buildShareDecision({
      silent: true,
      categories: 'claudeMd',
      output: '/tmp/out.cmemmov',
      excludePattern: ['todo*'],
    });
    const sources = decision.personalPatterns.map((p) => p.source);
    expect(sources).not.toContain('^todo');
    expect(sources).toContain('^personal');
  });

  it('stock + include(todo2*) - exclude(todo*) is correct (AC9 example)', () => {
    const decision = buildShareDecision({
      silent: true,
      categories: 'claudeMd',
      output: '/tmp/out.cmemmov',
      includePattern: ['todo2*'],
      excludePattern: ['todo*'],
    });
    const sources = decision.personalPatterns.map((p) => p.source);
    expect(sources).not.toContain('^todo');
    expect(sources).toContain('^todo2.*');
  });
});

describe('AC10 — unsupported categories rejected', () => {
  it('throws INTERNAL when sessionHistory is requested', () => {
    let caught: unknown;
    try { parseShareCategories('sessionHistory'); } catch (e) { caught = e; }
    expect(caught).toMatchObject({ code: 'INTERNAL' });
    expect((caught as CmemmovError).hint).toContain('sessionHistory');
  });

  it('throws INTERNAL when globalMemory is requested', () => {
    let caught: unknown;
    try { parseShareCategories('globalMemory'); } catch (e) { caught = e; }
    expect(caught).toMatchObject({ code: 'INTERNAL' });
  });

  it('throws INTERNAL when projectMemory is requested', () => {
    let caught: unknown;
    try { parseShareCategories('projectMemory'); } catch (e) { caught = e; }
    expect(caught).toMatchObject({ code: 'INTERNAL' });
  });

  it('accepts valid share categories', () => {
    const cats = parseShareCategories('claudeMd,mcp,settings,custom-commands,teams,plugins');
    expect(cats).toContain('claudeMd');
    expect(cats).toContain('mcpConfig');
    expect(cats).toContain('globalSettings');
    expect(cats).toContain('customCommands');
    expect(cats).toContain('teams');
    expect(cats).toContain('plugins');
  });
});

describe('AC1 — silent mode requires --categories', () => {
  it('throws INTERNAL when --silent without --categories', () => {
    let caught: unknown;
    try { buildShareDecision({ silent: true }); } catch (e) { caught = e; }
    expect(caught).toMatchObject({ code: 'INTERNAL', hint: '--categories required in silent mode' });
  });

  it('uses selectShareCategories in interactive mode when no categories provided', async () => {
    state.selectShareCategoriesResult = ['claudeMd'];
    state.confirmShareWriteResult = 'yes';

    await run({
      output: '/tmp/baseline.cmemmov',
    });

    expect(vi.mocked(prompts.selectShareCategories)).toHaveBeenCalledWith({
      silent: false,
      defaults: SHARE_CATEGORIES,
    });
    expect(state.writeFileCalls).toHaveLength(1);
  });
});

describe('preview and warnings — buildPreviewLines coverage', () => {
  it('emits claudeJson field warnings when claudeJson has user-identifying fields', async () => {
    state.surface = {
      claudeDir: '/c',
      claudeJson: { email: 'user@example.com', theme: 'dark' },
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

    const stderrWrites: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      if (typeof chunk === 'string') stderrWrites.push(chunk);
      return true;
    });
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await run({
      silent: true,
      categories: 'claudeMd',
      output: '/tmp/baseline.cmemmov',
      json: true,
    });

    vi.restoreAllMocks();

    const stderrText = stderrWrites.join('');
    expect(stderrText).toContain('claudeJson: user-identifying field');
  });

  it('emits homeDirPermissionRules and localMcpServers warnings with windows-style paths', async () => {
    const { getSourceHomedir } = await import('../services/claude-locator.js');
    vi.mocked(getSourceHomedir).mockReturnValue('C:\\Users\\test');

    state.surface = {
      claudeDir: 'C:\\Users\\test\\.claude',
      claudeJson: undefined,
      credentialsRef: undefined,
      globalSettings: {
        permissions: ['Read(C:\\Users\\test\\secrets)'],
      },
      globalMemory: [],
      claudeMd: undefined,
      mcpConfig: { localTool: { command: 'C:\\Users\\test\\agents\\tool.exe' } },
      customCommands: [],
      teams: undefined,
      plugins: undefined,
      projects: [],
    };

    const stderrWrites: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      if (typeof chunk === 'string') stderrWrites.push(chunk);
      return true;
    });
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await run({
      silent: true,
      categories: 'mcp',
      output: 'C:\\tmp\\baseline.cmemmov',
      json: true,
    });

    vi.restoreAllMocks();
    vi.mocked(getSourceHomedir).mockReturnValue('/home/user');

    const stderrText = stderrWrites.join('');
    expect(stderrText).toContain('local MCP server');
  });

  it('emits homeDirPermissionRules warnings with windows-style settings permissions', async () => {
    const { getSourceHomedir } = await import('../services/claude-locator.js');
    vi.mocked(getSourceHomedir).mockReturnValue('C:\\Users\\test');

    state.surface = {
      claudeDir: 'C:\\Users\\test\\.claude',
      claudeJson: undefined,
      credentialsRef: undefined,
      globalSettings: {
        permissions: ['Read(C:\\Users\\test\\private\\notes)'],
      },
      globalMemory: [],
      claudeMd: undefined,
      mcpConfig: undefined,
      customCommands: [],
      teams: undefined,
      plugins: undefined,
      projects: [],
    };

    const stderrWrites: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      if (typeof chunk === 'string') stderrWrites.push(chunk);
      return true;
    });
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await run({
      silent: true,
      categories: 'settings',
      output: 'C:\\tmp\\baseline.cmemmov',
      json: true,
    });

    vi.restoreAllMocks();
    vi.mocked(getSourceHomedir).mockReturnValue('/home/user');

    const stderrText = stderrWrites.join('');
    expect(stderrText).toContain('home-directory absolute path');
  });

  it('displays stripped items list in interactive non-JSON mode when items exist', async () => {
    const { getSourceHomedir } = await import('../services/claude-locator.js');
    vi.mocked(getSourceHomedir).mockReturnValue('C:\\Users\\test');

    state.surface = {
      claudeDir: 'C:\\Users\\test\\.claude',
      claudeJson: { email: 'user@example.com', theme: 'dark' },
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

    state.confirmShareWriteResult = 'yes';

    const stderrWrites: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      if (typeof chunk === 'string') stderrWrites.push(chunk);
      return true;
    });
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await run({
      categories: 'claudeMd',
      output: '/tmp/baseline.cmemmov',
    });

    vi.restoreAllMocks();
    vi.mocked(getSourceHomedir).mockReturnValue('/home/user');

    const stderrText = stderrWrites.join('');
    expect(stderrText).toContain('Items that will be stripped');
  });
});
