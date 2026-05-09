import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Bundle } from '../core/bundle-schema.js';
import type { ApplyCategoryOpts } from '../services/claude-writer.js';
import type { ProjectPathResult } from '../ui/prompts.js';

interface CapturedBackup {
  claudeDir: string;
  result: string;
}

interface FakeGate {
  write: ReturnType<typeof vi.fn>;
  rename: ReturnType<typeof vi.fn>;
  mkdir: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  recordedOps: ReturnType<typeof vi.fn>;
  __kind: 'live' | 'dry';
}

const state = vi.hoisted<{
  bundleBytes: Buffer;
  bundle: Bundle | null;
  parseShouldThrow: Error | null;
  parseShouldWarn: string | null;
  applyCalls: ApplyCategoryOpts[];
  applyShouldThrow: Error | null;
  backupCalls: CapturedBackup[];
  backupShouldThrow: Error | null;
  liveGates: FakeGate[];
  dryGates: FakeGate[];
  recordedOpsResult: { kind: 'write'; path: string; bytes: number }[];
  existingPaths: Set<string>;
  readdirResults: Map<string, string[]>;
  promptResults: ProjectPathResult[];
  promptCalls: { slug: string; originalPath: string; suggestion: string | null; silent: boolean }[];
  findMatchingDirResult: string | null;
}>(() => ({
  bundleBytes: Buffer.from('{}'),
  bundle: null,
  parseShouldThrow: null,
  parseShouldWarn: null,
  applyCalls: [],
  applyShouldThrow: null,
  backupCalls: [],
  backupShouldThrow: null,
  liveGates: [],
  dryGates: [],
  recordedOpsResult: [],
  existingPaths: new Set(),
  readdirResults: new Map(),
  promptResults: [],
  promptCalls: [],
  findMatchingDirResult: null,
}));

function makeFakeGate(kind: 'live' | 'dry'): FakeGate {
  return {
    write: vi.fn(() => Promise.resolve()),
    rename: vi.fn(() => Promise.resolve()),
    mkdir: vi.fn(() => Promise.resolve()),
    remove: vi.fn(() => Promise.resolve()),
    recordedOps: vi.fn(() => state.recordedOpsResult),
    __kind: kind,
  };
}

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    readFile: vi.fn(() => Promise.resolve(state.bundleBytes)),
    stat: vi.fn((p: string) => {
      if (state.existingPaths.has(p)) return Promise.resolve({} as { isDirectory: () => boolean });
      const err: NodeJS.ErrnoException = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return Promise.reject(err);
    }),
    readdir: vi.fn((p: string) => {
      const entries = state.readdirResults.get(p);
      if (entries === undefined) {
        const err: NodeJS.ErrnoException = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        return Promise.reject(err);
      }
      return Promise.resolve(
        entries.map((name) => ({
          name,
          isDirectory: (): boolean => true,
        })),
      );
    }),
  };
});

vi.mock('../services/claude-locator.js', () => ({
  locateClaude: vi.fn(() => ({ claudeDir: '/home/u/.claude', claudeJson: '/home/u/.claude.json' })),
}));

vi.mock('../services/bundle-parser.js', () => ({
  parseBundle: vi.fn((_bytes: Buffer, opts?: { warn?: (m: string) => void }) => {
    if (state.parseShouldThrow) throw state.parseShouldThrow;
    if (state.parseShouldWarn !== null && opts?.warn !== undefined) {
      opts.warn(state.parseShouldWarn);
    }
    if (state.bundle === null) throw new Error('test bundle not configured');
    return state.bundle;
  }),
}));

vi.mock('../services/claude-writer.js', () => ({
  applyCategory: vi.fn((opts: ApplyCategoryOpts) => {
    if (state.applyShouldThrow) throw state.applyShouldThrow;
    state.applyCalls.push(opts);
    return Promise.resolve();
  }),
}));

vi.mock('../services/backup-service.js', () => ({
  createBackup: vi.fn((claudeDir: string) => {
    if (state.backupShouldThrow) throw state.backupShouldThrow;
    const result = `${claudeDir}/backups/cmemmov/2026-05-09T10-00-00-000Z-1234`;
    state.backupCalls.push({ claudeDir, result });
    return Promise.resolve(result);
  }),
}));

vi.mock('../services/write-gate.js', () => ({
  makeLiveWriteGate: vi.fn(() => {
    const g = makeFakeGate('live');
    state.liveGates.push(g);
    return g;
  }),
  makeDryRunWriteGate: vi.fn(() => {
    const g = makeFakeGate('dry');
    state.dryGates.push(g);
    return g;
  }),
}));

vi.mock('../ui/prompts.js', () => ({
  confirmProjectPath: vi.fn(
    (opts: { slug: string; originalPath: string; suggestion: string | null; silent: boolean }) => {
      state.promptCalls.push(opts);
      const next = state.promptResults.shift();
      if (next === undefined) {
        return Promise.resolve<ProjectPathResult>({ action: 'skip', path: opts.originalPath });
      }
      return Promise.resolve(next);
    },
  ),
}));

vi.mock('../core/path-engine.js', async () => {
  const actual =
    await vi.importActual<typeof import('../core/path-engine.js')>('../core/path-engine.js');
  return {
    ...actual,
    findMatchingDir: vi.fn(() => state.findMatchingDirResult),
  };
});

import { run } from './import.js';
import { CmemmovError } from '../core/error.js';
import * as backupSvc from '../services/backup-service.js';
import * as writerSvc from '../services/claude-writer.js';
import * as gateSvc from '../services/write-gate.js';
import * as parserSvc from '../services/bundle-parser.js';

function makeBundle(overrides: Partial<Bundle> = {}): Bundle {
  return {
    version: '1.0.0',
    exportedAt: '2026-05-09T10:00:00.000Z',
    sourcePlatform: 'linux',
    claudeVersion: 'unknown',
    hasCredentials: false,
    projects: [],
    global: {},
    ...overrides,
  };
}

function resetState(): void {
  state.bundleBytes = Buffer.from('{}');
  state.bundle = null;
  state.parseShouldThrow = null;
  state.parseShouldWarn = null;
  state.applyCalls = [];
  state.applyShouldThrow = null;
  state.backupCalls = [];
  state.backupShouldThrow = null;
  state.liveGates = [];
  state.dryGates = [];
  state.recordedOpsResult = [];
  state.existingPaths = new Set();
  state.readdirResults = new Map();
  state.promptResults = [];
  state.promptCalls = [];
  state.findMatchingDirResult = null;
}

beforeEach(() => {
  resetState();
  vi.mocked(backupSvc.createBackup).mockClear();
  vi.mocked(writerSvc.applyCategory).mockClear();
  vi.mocked(gateSvc.makeLiveWriteGate).mockClear();
  vi.mocked(gateSvc.makeDryRunWriteGate).mockClear();
  vi.mocked(parserSvc.parseBundle).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AC1: backup created BEFORE any applyCategory and reported to stderr', () => {
  it('createBackup called before any applyCategory call', async () => {
    state.bundle = makeBundle({
      global: { memories: [{ filename: 'a.md', content: 'a' }] },
    });
    state.findMatchingDirResult = null;

    let backupCallOrder = -1;
    let firstApplyCallOrder = -1;
    let order = 0;
    vi.mocked(backupSvc.createBackup).mockImplementationOnce((d: string) => {
      backupCallOrder = order++;
      return Promise.resolve(`${d}/backups/cmemmov/x`);
    });
    vi.mocked(writerSvc.applyCategory).mockImplementationOnce((opts) => {
      if (firstApplyCallOrder === -1) firstApplyCallOrder = order++;
      state.applyCalls.push(opts);
      return Promise.resolve();
    });

    await run('/tmp/bundle.cmemmov', {});

    expect(backupCallOrder).toBe(0);
    expect(firstApplyCallOrder).toBe(1);
  });

  it('reports backup path to stderr', async () => {
    state.bundle = makeBundle();
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await run('/tmp/bundle.cmemmov', {});

    const stderrText = stderrSpy.mock.calls
      .map((c) => (typeof c[0] === 'string' ? c[0] : Buffer.from(c[0]).toString('utf8')))
      .join('');
    expect(stderrText).toMatch(/Backup created at/);
    expect(stderrText).toContain('/home/u/.claude/backups/cmemmov/');
    stderrSpy.mockRestore();
  });
});

describe('AC2: project with existing originalPath is auto-confirmed', () => {
  it('does not call confirmProjectPath when target path exists', async () => {
    state.existingPaths.add('/home/u/proj-a');
    state.bundle = makeBundle({
      projects: [
        {
          slug: '-home-u-proj-a',
          originalPath: '/home/u/proj-a',
          memories: [{ filename: 'm.md', content: 'm' }],
        },
      ],
    });

    await run('/tmp/bundle.cmemmov', {});

    expect(state.promptCalls).toHaveLength(0);
    const projectMemoryApplied = state.applyCalls.some(
      (c) => c.category === 'projectMemory' && (c.data as { slug: string }).slug === '-home-u-proj-a',
    );
    expect(projectMemoryApplied).toBe(true);
  });
});

describe('AC3: missing originalPath triggers confirmProjectPath with suggestion', () => {
  it('calls confirmProjectPath with the suggestion from findMatchingDir', async () => {
    state.findMatchingDirResult = '/home/u/dev/proj-a';
    state.readdirResults.set('/home/u', ['proj-a']);
    state.promptResults.push({ action: 'accept', path: '/home/u/dev/proj-a' });
    state.bundle = makeBundle({
      projects: [
        {
          slug: '-home-u-proj-a',
          originalPath: '/old/host/proj-a',
          memories: [{ filename: 'm.md', content: 'm' }],
        },
      ],
    });

    await run('/tmp/bundle.cmemmov', {});

    expect(state.promptCalls).toHaveLength(1);
    expect(state.promptCalls[0]).toEqual({
      slug: '-home-u-proj-a',
      originalPath: '/old/host/proj-a',
      suggestion: '/home/u/dev/proj-a',
      silent: false,
    });
  });
});

describe('AC4: skip action lists project in IMPORT_PARTIAL hint and skips applyCategory', () => {
  it('skipped project: no applyCategory calls for it; throws IMPORT_PARTIAL with slug in hint', async () => {
    state.bundle = makeBundle({
      projects: [
        {
          slug: '-home-u-skipme',
          originalPath: '/missing/skipme',
          memories: [{ filename: 'm.md', content: 'm' }],
        },
      ],
    });
    state.promptResults.push({ action: 'skip', path: '/missing/skipme' });

    await expect(run('/tmp/bundle.cmemmov', {})).rejects.toMatchObject({
      code: 'IMPORT_PARTIAL',
      hint: expect.stringContaining('-home-u-skipme') as unknown,
    });

    const skippedApplied = state.applyCalls.some(
      (c) =>
        (c.category === 'projectMemory' || c.category === 'projectSettings') &&
        (c.data as { slug: string }).slug === '-home-u-skipme',
    );
    expect(skippedApplied).toBe(false);
  });

  it('IMPORT_PARTIAL is exit code 1 (not 2)', async () => {
    state.bundle = makeBundle({
      projects: [
        {
          slug: '-home-u-skipme',
          originalPath: '/missing/skipme',
          memories: [{ filename: 'm.md', content: 'm' }],
        },
      ],
    });
    state.promptResults.push({ action: 'skip', path: '/missing/skipme' });

    let caught: unknown;
    try {
      await run('/tmp/bundle.cmemmov', {});
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(CmemmovError);
    expect((caught as CmemmovError).exitCode).toBe(1);
  });
});

describe('AC5: --mode merge applies categories with mode=merge', () => {
  it('default mode is merge; applyCategory called with mode merge', async () => {
    state.bundle = makeBundle({
      global: {
        memories: [{ filename: 'a.md', content: 'a' }],
        settings: { x: 1 },
      },
    });

    await run('/tmp/bundle.cmemmov', {});

    for (const c of state.applyCalls) {
      expect(c.mode).toBe('merge');
    }
  });
});

describe('AC6: --mode overwrite=globalSettings only overrides that category', () => {
  it('globalSettings is overwrite; other categories merge', async () => {
    state.bundle = makeBundle({
      global: {
        memories: [{ filename: 'a.md', content: 'a' }],
        settings: { x: 1 },
        claudeMd: '# global',
      },
    });

    await run('/tmp/bundle.cmemmov', { mode: 'overwrite=globalSettings' });

    const byCat = new Map<string, ApplyCategoryOpts>();
    for (const c of state.applyCalls) byCat.set(c.category, c);
    expect(byCat.get('globalSettings')?.mode).toBe('overwrite');
    expect(byCat.get('globalMemory')?.mode).toBe('merge');
    expect(byCat.get('claudeMd')?.mode).toBe('merge');
  });
});

describe('AC6 extension: --mode overwrite applies overwrite to ALL categories', () => {
  it('every applyCategory call has mode=overwrite', async () => {
    state.bundle = makeBundle({
      global: {
        memories: [{ filename: 'a.md', content: 'a' }],
        settings: { x: 1 },
      },
    });

    await run('/tmp/bundle.cmemmov', { mode: 'overwrite' });

    for (const c of state.applyCalls) {
      expect(c.mode).toBe('overwrite');
    }
  });
});

describe('AC7: --dry-run uses dry-run gate, no backup, no fs writes', () => {
  it('makeDryRunWriteGate used; createBackup NOT called', async () => {
    state.bundle = makeBundle({
      global: { memories: [{ filename: 'a.md', content: 'a' }] },
    });

    await run('/tmp/bundle.cmemmov', { dryRun: true });

    expect(gateSvc.makeDryRunWriteGate).toHaveBeenCalledTimes(1);
    expect(gateSvc.makeLiveWriteGate).not.toHaveBeenCalled();
    expect(backupSvc.createBackup).not.toHaveBeenCalled();
  });

  it('summary mentions dry run and recorded ops count', async () => {
    state.bundle = makeBundle({
      global: { memories: [{ filename: 'a.md', content: 'a' }] },
    });
    state.recordedOpsResult = [
      { kind: 'write', path: '/home/u/.claude/memory/a.md', bytes: 1 },
      { kind: 'write', path: '/home/u/.claude/memory/MEMORY.md', bytes: 20 },
    ];

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await run('/tmp/bundle.cmemmov', { dryRun: true });

    const stdoutText = stdoutSpy.mock.calls
      .map((c) => (typeof c[0] === 'string' ? c[0] : Buffer.from(c[0]).toString('utf8')))
      .join('');
    expect(stdoutText).toMatch(/Dry run/);
    expect(stdoutText).toMatch(/2 write op/);
    // The dry-run summary must mention the would-be backup path (Dev Notes:
    // "the backup that WOULD have been created"). The path is generated from
    // claudeDir; we only assert the prefix and a recognizable token.
    expect(stdoutText).toMatch(/Backup would be:/);
    expect(stdoutText).toMatch(/backups[\\/]cmemmov/);
    stdoutSpy.mockRestore();
  });

  it('createBackup is NOT called even when dry-run summary mentions a would-be backup path', async () => {
    state.bundle = makeBundle({
      global: { memories: [{ filename: 'a.md', content: 'a' }] },
    });

    await run('/tmp/bundle.cmemmov', { dryRun: true });

    expect(backupSvc.createBackup).not.toHaveBeenCalled();
  });
});

describe('AC8: bundle version mismatch warns but does not block', () => {
  it('warn callback emits version mismatch warning; import completes', async () => {
    state.bundle = makeBundle();
    state.parseShouldWarn = "Bundle format version '0.9.0' differs from expected '1.0.0'.";

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await run('/tmp/bundle.cmemmov', {});
    const stderrText = stderrSpy.mock.calls
      .map((c) => (typeof c[0] === 'string' ? c[0] : Buffer.from(c[0]).toString('utf8')))
      .join('');
    expect(stderrText).toMatch(/version/);
    stderrSpy.mockRestore();
  });
});

describe('AC9: BUNDLE_CHECKSUM_MISMATCH thrown before any backup or apply', () => {
  it('createBackup NOT called and applyCategory NOT called when parse throws checksum mismatch', async () => {
    state.parseShouldThrow = new CmemmovError({
      code: 'BUNDLE_CHECKSUM_MISMATCH',
      hint: 'corrupted',
    });

    await expect(run('/tmp/bundle.cmemmov', {})).rejects.toMatchObject({
      code: 'BUNDLE_CHECKSUM_MISMATCH',
    });

    expect(backupSvc.createBackup).not.toHaveBeenCalled();
    expect(writerSvc.applyCategory).not.toHaveBeenCalled();
  });
});

describe('AC12: full success exits 0 (no error thrown) and applies all categories', () => {
  it('returns normally with all bundle categories applied', async () => {
    state.existingPaths.add('/home/u/proj-a');
    state.bundle = makeBundle({
      global: {
        memories: [{ filename: 'a.md', content: 'a' }],
        settings: { x: 1 },
        claudeMd: '# global',
      },
      projects: [
        {
          slug: '-home-u-proj-a',
          originalPath: '/home/u/proj-a',
          memories: [{ filename: 'm.md', content: 'm' }],
          settings: { y: 2 },
          claudeMd: '# project',
        },
      ],
    });

    await expect(run('/tmp/bundle.cmemmov', {})).resolves.toBeUndefined();

    const cats = state.applyCalls.map((c) => c.category);
    expect(cats).toContain('globalMemory');
    expect(cats).toContain('globalSettings');
    expect(cats).toContain('claudeMd');
    expect(cats).toContain('projectMemory');
    expect(cats).toContain('projectSettings');
  });
});

describe('parseMode: invalid mode throws INTERNAL', () => {
  it('rejects an unknown mode value', async () => {
    await expect(
      run('/tmp/bundle.cmemmov', { mode: 'bogus' }),
    ).rejects.toMatchObject({ code: 'INTERNAL' });
  });

  it('rejects overwrite= with unknown category', async () => {
    await expect(
      run('/tmp/bundle.cmemmov', { mode: 'overwrite=notACategory' }),
    ).rejects.toMatchObject({ code: 'INTERNAL' });
  });
});

describe('applyCategory slug uses bundle slug, not confirmedPath', () => {
  it('overrides path is recorded but slug stays the bundle slug', async () => {
    state.promptResults.push({ action: 'override', path: '/new/host/proj-a' });
    state.bundle = makeBundle({
      projects: [
        {
          slug: '-home-u-proj-a',
          originalPath: '/old/host/proj-a',
          memories: [{ filename: 'm.md', content: 'm' }],
        },
      ],
    });

    await run('/tmp/bundle.cmemmov', {});

    const projectMem = state.applyCalls.find(
      (c): c is Extract<ApplyCategoryOpts, { category: 'projectMemory' }> =>
        c.category === 'projectMemory',
    );
    expect(projectMem).toBeDefined();
    expect(projectMem?.data.slug).toBe('-home-u-proj-a');
  });
});

describe('silent mode: missing path → automatic skip → IMPORT_PARTIAL', () => {
  it('silent flag forwarded to confirmProjectPath; skipped slugs in IMPORT_PARTIAL hint', async () => {
    state.bundle = makeBundle({
      projects: [
        {
          slug: '-home-u-x',
          originalPath: '/missing/x',
          memories: [{ filename: 'm.md', content: 'm' }],
        },
      ],
    });
    // The mocked confirmProjectPath defaults to 'skip' when no result is queued.

    await expect(
      run('/tmp/bundle.cmemmov', { silent: true }),
    ).rejects.toMatchObject({
      code: 'IMPORT_PARTIAL',
      hint: expect.stringContaining('-home-u-x') as unknown,
    });

    expect(state.promptCalls[0]?.silent).toBe(true);
  });
});

describe('--no-integrity-check forwards noIntegrityCheck=true to parseBundle', () => {
  it('passes noIntegrityCheck flag through', async () => {
    state.bundle = makeBundle();

    await run('/tmp/bundle.cmemmov', { integrityCheck: false });

    const parseCall = vi.mocked(parserSvc.parseBundle).mock.calls[0];
    expect(parseCall?.[1]?.noIntegrityCheck).toBe(true);
  });

  it('default (flag absent) → noIntegrityCheck=false', async () => {
    state.bundle = makeBundle();

    await run('/tmp/bundle.cmemmov', {});

    const parseCall = vi.mocked(parserSvc.parseBundle).mock.calls[0];
    expect(parseCall?.[1]?.noIntegrityCheck).toBe(false);
  });
});

describe('bundle.global.claudeJson is currently unapplied; user is warned', () => {
  it('emits a stderr warning when bundle.global.claudeJson is present', async () => {
    state.bundle = makeBundle({
      global: {
        memories: [{ filename: 'a.md', content: 'a' }],
        claudeJson: { firstStartTime: '2026-01-01' },
      },
    });
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await run('/tmp/bundle.cmemmov', {});

    const stderrText = stderrSpy.mock.calls
      .map((c) => (typeof c[0] === 'string' ? c[0] : Buffer.from(c[0]).toString('utf8')))
      .join('');
    expect(stderrText).toMatch(/\.claude\.json/);
    stderrSpy.mockRestore();

    // applyCategory was NOT called for any "claudeJson" category — that
    // category does not exist on the writer surface.
    const claudeJsonApplied = state.applyCalls.some(
      (c) => (c.category as string) === 'claudeJson',
    );
    expect(claudeJsonApplied).toBe(false);
  });

  it('does NOT warn when bundle.global.claudeJson is absent', async () => {
    state.bundle = makeBundle({
      global: { memories: [{ filename: 'a.md', content: 'a' }] },
    });
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await run('/tmp/bundle.cmemmov', {});

    const stderrText = stderrSpy.mock.calls
      .map((c) => (typeof c[0] === 'string' ? c[0] : Buffer.from(c[0]).toString('utf8')))
      .join('');
    expect(stderrText).not.toMatch(/\.claude\.json/);
    stderrSpy.mockRestore();
  });
});
