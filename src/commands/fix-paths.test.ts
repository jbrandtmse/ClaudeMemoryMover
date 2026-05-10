import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import type { promptRemapDecision } from '../ui/prompts.js';

interface FakeDirent {
  name: string;
  isDirectory: () => boolean;
}

interface FakeStats {
  isDirectory: () => boolean;
  isFile: () => boolean;
  mtimeMs: number;
}

const state = vi.hoisted<{
  // readdir(path, { withFileTypes: true }) → Dirent[]
  readdirDirent: Map<string, FakeDirent[]>;
  // ENOENT-throw set: any path in this set raises ENOENT regardless of the call form.
  enoentPaths: Set<string>;
  // stat(path) → present? then resolves with the value; absent → ENOENT.
  statPaths: Map<string, FakeStats>;
  // resolveOriginalPath(slug, claudeDir) → result by slug
  resolveBySlug: Map<string, { path: string; source: 'sessionCwd' | 'slugDecode' | null }>;
}>(() => ({
  readdirDirent: new Map(),
  enoentPaths: new Set(),
  statPaths: new Map(),
  resolveBySlug: new Map(),
}));

// Type the mock via `typeof promptRemapDecision` so any production-side
// signature change is caught at compile time.
const mockPromptRemapDecision = vi.hoisted(() =>
  vi.fn<typeof promptRemapDecision>(),
);

function enoent(path: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
}

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    readdir: vi.fn((p: string, opts?: { withFileTypes?: boolean }) => {
      if (state.enoentPaths.has(p)) {
        return Promise.reject(enoent(p));
      }
      // The production code in src/commands/fix-paths.ts always passes
      // `{ withFileTypes: true }`. Reject any unexpected call shape so a
      // future change that drops the flag fails loudly instead of silently
      // receiving Dirent objects from the dirent map.
      if (opts?.withFileTypes !== true) {
        return Promise.reject(
          new Error(
            `test setup error: readdir called without { withFileTypes: true } for ${p}`,
          ),
        );
      }
      const ents = state.readdirDirent.get(p);
      if (ents === undefined) {
        return Promise.reject(enoent(p));
      }
      return Promise.resolve(ents);
    }),
    stat: vi.fn((p: string) => {
      if (state.enoentPaths.has(p)) {
        return Promise.reject(enoent(p));
      }
      const s = state.statPaths.get(p);
      if (s === undefined) {
        return Promise.reject(enoent(p));
      }
      return Promise.resolve(s);
    }),
  };
});

const CLAUDE_DIR = join('/home', 'jordan', '.claude');
const CLAUDE_JSON = join('/home', 'jordan', '.claude.json');
const PROJECTS_DIR = join(CLAUDE_DIR, 'projects');
// Home directory derived from CLAUDE_DIR — same derivation used by fix-paths.ts
// (`dirname(claudeDir)`). Cached so tests can construct candidate paths via
// `join(HOME, ...)` and match the OS-native separators production code uses.
const HOME = join('/home', 'jordan');

vi.mock('../services/claude-locator.js', () => ({
  locateClaude: vi.fn(() => ({
    claudeDir: CLAUDE_DIR,
    claudeJson: CLAUDE_JSON,
  })),
}));

vi.mock('../services/claude-reader.js', () => ({
  resolveOriginalPath: vi.fn((slug: string) => {
    const r = state.resolveBySlug.get(slug);
    if (r === undefined) {
      return Promise.resolve({ path: slug, source: null });
    }
    return Promise.resolve(r);
  }),
}));

vi.mock('../ui/prompts.js', () => ({
  promptRemapDecision: mockPromptRemapDecision,
}));

import { collectRemapDecisions, run, scanProjects, type ProjectInventoryEntry } from './fix-paths.js';

function dir(name: string): FakeDirent {
  return { name, isDirectory: (): boolean => true };
}
function file(name: string): FakeDirent {
  return { name, isDirectory: (): boolean => false };
}

function existingFileStat(): FakeStats {
  return {
    isDirectory: (): boolean => false,
    isFile: (): boolean => true,
    mtimeMs: 0,
  };
}

// Story 3.2 buildSuggestion only accepts directories as remap candidates;
// `existingFileStat` returns `isDirectory: false`. Tests that register a
// candidate path must use this directory-stat shape instead.
function existingDirStat(): FakeStats {
  return {
    isDirectory: (): boolean => true,
    isFile: (): boolean => false,
    mtimeMs: 0,
  };
}

function resetState(): void {
  state.readdirDirent = new Map();
  state.enoentPaths = new Set();
  state.statPaths = new Map();
  state.resolveBySlug = new Map();
  mockPromptRemapDecision.mockReset();
}

beforeEach(() => {
  resetState();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AC1+AC9(a): empty projects directory → early exit', () => {
  it('readdir returns empty array → "No projects need fixing." and exit 0', async () => {
    state.readdirDirent.set(PROJECTS_DIR, []);
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await run({});

    const stdoutText = stdoutSpy.mock.calls
      .map((c) => (typeof c[0] === 'string' ? c[0] : Buffer.from(c[0]).toString('utf8')))
      .join('');
    const stderrText = stderrSpy.mock.calls
      .map((c) => (typeof c[0] === 'string' ? c[0] : Buffer.from(c[0]).toString('utf8')))
      .join('');
    // Summary line is emitted exactly once, on stdout via out.finish.
    expect(stdoutText).toContain('No projects need fixing.');
    // The "Scanning ..." preamble is on stderr; the summary is NOT duplicated to stderr.
    expect(stderrText).toContain('Scanning ~/.claude/projects/');
    expect(stderrText).not.toContain('No projects need fixing.');

    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });
});

describe('AC9(b): missing projects directory → treated as empty', () => {
  it('ENOENT on readdir → "No projects need fixing."', async () => {
    state.enoentPaths.add(PROJECTS_DIR);
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await run({});

    const stdoutText = stdoutSpy.mock.calls
      .map((c) => (typeof c[0] === 'string' ? c[0] : Buffer.from(c[0]).toString('utf8')))
      .join('');
    expect(stdoutText).toContain('No projects need fixing.');

    stdoutSpy.mockRestore();
  });
});

describe('AC2+AC4+AC9(c): one FOUND project via sessionCwd', () => {
  it('source: sessionCwd, exists: true', async () => {
    const slug = '-home-jordan-proj-a';
    const decoded = '/home/jordan/proj-a';
    state.readdirDirent.set(PROJECTS_DIR, [dir(slug)]);
    state.resolveBySlug.set(slug, { path: decoded, source: 'sessionCwd' });
    state.statPaths.set(decoded, existingFileStat());

    const inventory = await scanProjects(CLAUDE_DIR);

    expect(inventory).toEqual([
      { slug, decodedPath: decoded, exists: true, source: 'sessionCwd' },
    ]);
  });

  it('all-found run() emits "No projects need fixing." (early exit)', async () => {
    const slug = '-home-jordan-proj-a';
    const decoded = '/home/jordan/proj-a';
    state.readdirDirent.set(PROJECTS_DIR, [dir(slug)]);
    state.resolveBySlug.set(slug, { path: decoded, source: 'sessionCwd' });
    state.statPaths.set(decoded, existingFileStat());

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await run({});

    const stdoutText = stdoutSpy.mock.calls
      .map((c) => (typeof c[0] === 'string' ? c[0] : Buffer.from(c[0]).toString('utf8')))
      .join('');
    expect(stdoutText).toContain('No projects need fixing.');

    stdoutSpy.mockRestore();
  });
});

describe('AC4+AC9(d): one NOT FOUND project via sessionCwd', () => {
  // Story 3.2 update: run() now invokes the remap phase (collectRemapDecisions),
  // which calls promptRemapDecision. We mock it to return `skip` so the test
  // exercises the new code path without hanging on the interactive prompt.
  beforeEach(() => {
    mockPromptRemapDecision.mockResolvedValue({ action: 'skip', path: '/home/jordan/moved-app' });
  });

  it('source: sessionCwd, exists: false; command exits 0 with summary', async () => {
    const slug = '-home-jordan-moved-app';
    const decoded = '/home/jordan/moved-app';
    state.readdirDirent.set(PROJECTS_DIR, [dir(slug)]);
    state.resolveBySlug.set(slug, { path: decoded, source: 'sessionCwd' });
    // statPaths intentionally omits `decoded` → ENOENT → exists: false

    const inventory = await scanProjects(CLAUDE_DIR);

    expect(inventory).toEqual([
      { slug, decodedPath: decoded, exists: false, source: 'sessionCwd' },
    ]);

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    // run() should exit normally — prompt returns skip, no remaps proposed.
    await expect(run({})).resolves.toBeUndefined();

    const stdoutText = stdoutSpy.mock.calls
      .map((c) => (typeof c[0] === 'string' ? c[0] : Buffer.from(c[0]).toString('utf8')))
      .join('');
    // After Story 3.2: summary reflects collected decisions, not raw missing count.
    expect(stdoutText).toContain('0 project(s) will be renamed.');

    stdoutSpy.mockRestore();
  });
});

describe('AC3+AC9(e): memory-only project falls back to slugDecode', () => {
  it('source: slugDecode', async () => {
    const slug = '-home-jordan-my-app';
    const decoded = '/home/jordan/my-app';
    state.readdirDirent.set(PROJECTS_DIR, [dir(slug)]);
    state.resolveBySlug.set(slug, { path: decoded, source: 'slugDecode' });
    state.statPaths.set(decoded, existingFileStat());

    const inventory = await scanProjects(CLAUDE_DIR);

    expect(inventory[0]?.source).toBe('slugDecode');
    expect(inventory[0]?.exists).toBe(true);
    expect(inventory[0]?.decodedPath).toBe(decoded);
  });
});

describe('AC3+AC9(f): structurally invalid slug → source null, decodedPath = slug', () => {
  it('resolveOriginalPath returns { path: slug, source: null }', async () => {
    const slug = 'bad-slug';
    state.readdirDirent.set(PROJECTS_DIR, [dir(slug)]);
    state.resolveBySlug.set(slug, { path: slug, source: null });
    // No stat entry for "bad-slug" → ENOENT → exists: false

    const inventory = await scanProjects(CLAUDE_DIR);

    expect(inventory).toEqual([
      { slug, decodedPath: slug, exists: false, source: null },
    ]);
  });
});

describe('AC9(g): mixed tree (some FOUND, some NOT FOUND) — exits 0', () => {
  // Mock promptRemapDecision so the missing project's prompt does not hang.
  beforeEach(() => {
    mockPromptRemapDecision.mockResolvedValue({
      action: 'skip',
      path: '/home/jordan/missing-1',
    });
  });

  it('inventory has correct exists values; command returns normally', async () => {
    const found1 = '-home-jordan-found-1';
    const found2 = '-home-jordan-found-2';
    const missing1 = '-home-jordan-missing-1';
    const found1Path = '/home/jordan/found-1';
    const found2Path = '/home/jordan/found-2';
    const missing1Path = '/home/jordan/missing-1';

    state.readdirDirent.set(PROJECTS_DIR, [
      dir(found1),
      dir(found2),
      dir(missing1),
      // A non-directory entry should be skipped:
      file('readme.txt'),
    ]);
    state.resolveBySlug.set(found1, { path: found1Path, source: 'sessionCwd' });
    state.resolveBySlug.set(found2, { path: found2Path, source: 'slugDecode' });
    state.resolveBySlug.set(missing1, { path: missing1Path, source: 'sessionCwd' });
    state.statPaths.set(found1Path, existingFileStat());
    state.statPaths.set(found2Path, existingFileStat());
    // missing1Path NOT registered → ENOENT → exists: false

    const inventory = await scanProjects(CLAUDE_DIR);

    expect(inventory).toHaveLength(3);
    const byMSlug = new Map(inventory.map((e) => [e.slug, e]));
    expect(byMSlug.get(found1)?.exists).toBe(true);
    expect(byMSlug.get(found2)?.exists).toBe(true);
    expect(byMSlug.get(missing1)?.exists).toBe(false);

    // Command exits normally — prompt returns skip, no remaps proposed.
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await expect(run({})).resolves.toBeUndefined();

    const stdoutText = stdoutSpy.mock.calls
      .map((c) => (typeof c[0] === 'string' ? c[0] : Buffer.from(c[0]).toString('utf8')))
      .join('');
    expect(stdoutText).toContain('0 project(s) will be renamed.');

    stdoutSpy.mockRestore();
  });
});

describe('AC6+AC9(h): --json mode → out.finish receives extra.projects', () => {
  it('stdout JSON contains summary.projects with the inventory', async () => {
    const slug = '-home-jordan-proj-a';
    const decoded = '/home/jordan/proj-a';
    state.readdirDirent.set(PROJECTS_DIR, [dir(slug)]);
    state.resolveBySlug.set(slug, { path: decoded, source: 'sessionCwd' });
    state.statPaths.set(decoded, existingFileStat());

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await run({ json: true });

    const stdoutText = stdoutSpy.mock.calls
      .map((c) => (typeof c[0] === 'string' ? c[0] : Buffer.from(c[0]).toString('utf8')))
      .join('');
    const stderrText = stderrSpy.mock.calls
      .map((c) => (typeof c[0] === 'string' ? c[0] : Buffer.from(c[0]).toString('utf8')))
      .join('');

    // Progress on stderr in JSON mode
    expect(stderrText).toContain('Scanning ~/.claude/projects/');

    const lastLine = stdoutText.split('\n').filter((l) => l.length > 0).pop() ?? '';
    const parsed = JSON.parse(lastLine) as {
      success: boolean;
      command: string;
      summary: { text: string; projects: unknown[] };
    };
    expect(parsed.success).toBe(true);
    expect(parsed.command).toBe('fix-paths');
    expect(parsed.summary.text).toBe('No projects need fixing.');
    expect(Array.isArray(parsed.summary.projects)).toBe(true);
    expect(parsed.summary.projects).toHaveLength(1);

    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it('--json with missing projects: summary.projects still includes inventory', async () => {
    const slug = '-home-jordan-moved-app';
    const decoded = '/home/jordan/moved-app';
    state.readdirDirent.set(PROJECTS_DIR, [dir(slug)]);
    state.resolveBySlug.set(slug, { path: decoded, source: 'sessionCwd' });
    // No stat entry → ENOENT → exists: false
    // Mock prompt → skip so the remap phase completes without hanging.
    mockPromptRemapDecision.mockResolvedValue({ action: 'skip', path: decoded });

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await run({ json: true });

    const stdoutText = stdoutSpy.mock.calls
      .map((c) => (typeof c[0] === 'string' ? c[0] : Buffer.from(c[0]).toString('utf8')))
      .join('');
    const lastLine = stdoutText.split('\n').filter((l) => l.length > 0).pop() ?? '';
    const parsed = JSON.parse(lastLine) as {
      success: boolean;
      summary: { text: string; projects: { exists: boolean }[] };
    };
    expect(parsed.summary.projects).toHaveLength(1);
    expect(parsed.summary.projects[0]?.exists).toBe(false);
    // Story 3.2: summary text reflects collected remap decisions, not raw missing count.
    expect(parsed.summary.text).toContain('0 project(s) will be renamed.');

    stdoutSpy.mockRestore();
  });
});

describe('AC7: --dry-run is identical to live scan (no writes either way at scan time)', () => {
  it('--dry-run with all-found scan emits "No projects need fixing."', async () => {
    const slug = '-home-jordan-proj-a';
    const decoded = '/home/jordan/proj-a';
    state.readdirDirent.set(PROJECTS_DIR, [dir(slug)]);
    state.resolveBySlug.set(slug, { path: decoded, source: 'sessionCwd' });
    state.statPaths.set(decoded, existingFileStat());

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await run({ dryRun: true });

    const stdoutText = stdoutSpy.mock.calls
      .map((c) => (typeof c[0] === 'string' ? c[0] : Buffer.from(c[0]).toString('utf8')))
      .join('');
    expect(stdoutText).toContain('No projects need fixing.');

    stdoutSpy.mockRestore();
  });
});

// -----------------------------------------------------------------------------
// Story 3.2: Auto-suggestion & interactive remap flow
// -----------------------------------------------------------------------------

describe('AC1(a): missing project with candidate on disk → auto-suggestion, accepted', () => {
  it('collectRemapDecisions returns remap decision with targetPath', async () => {
    const slug = '-home-jordan-moved-app';
    const decoded = '/home/jordan/moved-app';
    // Candidate <HOME>/dev/moved-app exists on disk (basename match).
    // Build the candidate key with `join` so the separator matches the
    // OS-native path production code constructs internally.
    const candidate = join(HOME, 'dev', 'moved-app');
    state.statPaths.set(candidate, existingDirStat());
    mockPromptRemapDecision.mockResolvedValue({
      action: 'accept',
      path: candidate,
    });

    const missing: ProjectInventoryEntry[] = [
      { slug, decodedPath: decoded, exists: false, source: 'sessionCwd' },
    ];
    const decisions = await collectRemapDecisions(missing, {}, CLAUDE_DIR);

    expect(mockPromptRemapDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        slug,
        originalPath: decoded,
        suggestion: candidate,
      }),
    );
    expect(decisions).toEqual([
      {
        slug,
        originalPath: decoded,
        targetPath: candidate,
        action: 'remap',
      },
    ]);
  });
});

describe('AC1(b): no candidate on disk → prompt called with suggestion: null', () => {
  it('suggestion is null when no candidate path exists', async () => {
    const slug = '-home-jordan-ghost-app';
    const decoded = '/home/jordan/ghost-app';
    // No statPaths entries → all candidate paths ENOENT → suggestion = null
    mockPromptRemapDecision.mockResolvedValue({ action: 'skip', path: decoded });

    const missing: ProjectInventoryEntry[] = [
      { slug, decodedPath: decoded, exists: false, source: 'sessionCwd' },
    ];
    const decisions = await collectRemapDecisions(missing, {}, CLAUDE_DIR);

    expect(mockPromptRemapDecision).toHaveBeenCalledWith(
      expect.objectContaining({ suggestion: null }),
    );
    // The mock returned `skip`, so the recorded decision must be a skip too —
    // ensures the prompt's return value flows through to the decision record.
    expect(decisions[0]?.action).toBe('skip');
    expect(decisions[0]?.targetPath).toBeNull();
  });
});

describe('AC4(c): scripted --remap prefix substitution', () => {
  it('prefix match → remap action with substituted targetPath', async () => {
    const slug = '-home-jordan-old-dev-myapp';
    const decoded = '/home/jordan/old-dev/myapp';
    const missing: ProjectInventoryEntry[] = [
      { slug, decodedPath: decoded, exists: false, source: 'sessionCwd' },
    ];

    const decisions = await collectRemapDecisions(
      missing,
      { silent: true, remap: ['/home/jordan/old-dev=/home/jordan/new-dev'] },
      CLAUDE_DIR,
    );

    expect(decisions).toEqual([
      {
        slug,
        originalPath: decoded,
        targetPath: '/home/jordan/new-dev/myapp',
        action: 'remap',
      },
    ]);
    expect(mockPromptRemapDecision).not.toHaveBeenCalled();
  });

  it('longest-prefix wins when multiple --remap rules match', async () => {
    const slug = '-home-jordan-old-dev-deep-app';
    const decoded = '/home/jordan/old-dev/deep/app';
    const missing: ProjectInventoryEntry[] = [
      { slug, decodedPath: decoded, exists: false, source: 'sessionCwd' },
    ];

    const decisions = await collectRemapDecisions(
      missing,
      {
        silent: true,
        remap: [
          '/home/jordan=/elsewhere/jordan',
          '/home/jordan/old-dev=/home/jordan/new-dev',
        ],
      },
      CLAUDE_DIR,
    );

    // Longest prefix (the second rule) wins → /home/jordan/new-dev/deep/app
    expect(decisions[0]?.targetPath).toBe('/home/jordan/new-dev/deep/app');
    expect(decisions[0]?.action).toBe('remap');
  });

  it('win32-shaped decodedPath: backslash separator boundary matches', async () => {
    // Verifies matchRemapSpec accepts win32.sep boundaries, not just posix.sep.
    // decodedPath comes from a session JSONL `cwd` recorded on Windows; it
    // has backslash separators regardless of the runtime OS this test runs on.
    const slug = 'C--Users-Joe-old-app-proj';
    const decoded = 'C:\\Users\\Joe\\old-app\\proj';
    const missing: ProjectInventoryEntry[] = [
      { slug, decodedPath: decoded, exists: false, source: 'sessionCwd' },
    ];

    const decisions = await collectRemapDecisions(
      missing,
      { silent: true, remap: ['C:\\Users\\Joe\\old-app=D:\\new-app'] },
      CLAUDE_DIR,
    );

    expect(decisions[0]?.targetPath).toBe('D:\\new-app\\proj');
    expect(decisions[0]?.action).toBe('remap');
  });
});

describe('AC4(d)+AC5: --silent + no matching --remap → PATH_REMAP_AMBIGUOUS', () => {
  it('throws PATH_REMAP_AMBIGUOUS when no spec matches', async () => {
    const decoded = '/home/jordan/unknown-app';
    const missing: ProjectInventoryEntry[] = [
      {
        slug: '-home-jordan-unknown-app',
        decodedPath: decoded,
        exists: false,
        source: 'sessionCwd',
      },
    ];

    await expect(
      collectRemapDecisions(
        missing,
        { silent: true, remap: ['/other/prefix=/somewhere'] },
        CLAUDE_DIR,
      ),
    ).rejects.toMatchObject({ code: 'PATH_REMAP_AMBIGUOUS' });
  });

  it('throws PATH_REMAP_AMBIGUOUS when no --remap flag at all', async () => {
    const decoded = '/home/jordan/unknown-app';
    const missing: ProjectInventoryEntry[] = [
      {
        slug: '-home-jordan-unknown-app',
        decodedPath: decoded,
        exists: false,
        source: 'sessionCwd',
      },
    ];

    await expect(
      collectRemapDecisions(missing, { silent: true }, CLAUDE_DIR),
    ).rejects.toMatchObject({ code: 'PATH_REMAP_AMBIGUOUS' });
  });
});

describe('AC6(f): no-op — suggestion equals originalPath', () => {
  it('action: no-op when targetPath would be the same as originalPath', async () => {
    const slug = '-home-jordan-myapp';
    // Use a join-built path so candidate-key matches OS-native separators.
    const decoded = join(HOME, 'myapp');
    // Candidate <HOME>/myapp exists (the home root candidate) → matches basename → suggestion = decoded
    state.statPaths.set(decoded, existingDirStat());
    mockPromptRemapDecision.mockResolvedValue({ action: 'accept', path: decoded });

    const missing: ProjectInventoryEntry[] = [
      { slug, decodedPath: decoded, exists: false, source: 'sessionCwd' },
    ];
    const decisions = await collectRemapDecisions(missing, {}, CLAUDE_DIR);

    expect(decisions[0]?.action).toBe('no-op');
    expect(decisions[0]?.targetPath).toBeNull();
  });

  it('silent --remap that resolves to the same path → no-op', async () => {
    const slug = '-home-jordan-myapp';
    const decoded = '/home/jordan/myapp';
    const missing: ProjectInventoryEntry[] = [
      { slug, decodedPath: decoded, exists: false, source: 'sessionCwd' },
    ];

    const decisions = await collectRemapDecisions(
      missing,
      { silent: true, remap: ['/home/jordan=/home/jordan'] },
      CLAUDE_DIR,
    );

    expect(decisions[0]?.action).toBe('no-op');
    expect(decisions[0]?.targetPath).toBeNull();
  });
});

describe('AC1(g): skip from prompt → action: skip, targetPath: null', () => {
  it('skip decision recorded correctly', async () => {
    const slug = '-home-jordan-gone-app';
    const decoded = '/home/jordan/gone-app';
    mockPromptRemapDecision.mockResolvedValue({ action: 'skip', path: decoded });

    const missing: ProjectInventoryEntry[] = [
      { slug, decodedPath: decoded, exists: false, source: 'sessionCwd' },
    ];
    const decisions = await collectRemapDecisions(missing, {}, CLAUDE_DIR);

    expect(decisions).toEqual([
      {
        slug,
        originalPath: decoded,
        targetPath: null,
        action: 'skip',
      },
    ]);
  });
});

describe('AC8(h): --json mode includes summary.remappings', () => {
  it('stdout JSON has remappings array from decisions', async () => {
    const slug = '-home-jordan-moved-app';
    const decoded = '/home/jordan/moved-app';
    state.readdirDirent.set(PROJECTS_DIR, [dir(slug)]);
    state.resolveBySlug.set(slug, { path: decoded, source: 'sessionCwd' });
    // No stat for `decoded` → exists: false (project missing).
    // Candidate <HOME>/dev/moved-app exists → suggestion populated.
    const candidate = join(HOME, 'dev', 'moved-app');
    state.statPaths.set(candidate, existingDirStat());
    mockPromptRemapDecision.mockResolvedValue({
      action: 'accept',
      path: candidate,
    });

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await run({ json: true });

    const stdoutText = stdoutSpy.mock.calls
      .map((c) => (typeof c[0] === 'string' ? c[0] : Buffer.from(c[0]).toString('utf8')))
      .join('');
    const lastLine = stdoutText.split('\n').filter((l) => l.length > 0).pop() ?? '';
    const parsed = JSON.parse(lastLine) as {
      success: boolean;
      summary: { text: string; projects: unknown[]; remappings: { action: string }[] };
    };

    expect(parsed.success).toBe(true);
    expect(Array.isArray(parsed.summary.remappings)).toBe(true);
    expect(parsed.summary.remappings).toHaveLength(1);
    expect(parsed.summary.remappings[0]?.action).toBe('remap');
    expect(parsed.summary.text).toContain('1 project(s) will be renamed.');

    stdoutSpy.mockRestore();
  });
});

describe('AC7: --dry-run collects decisions but emits dry-run notice', () => {
  it('dry-run with missing project returns normally and prints notice', async () => {
    const slug = '-home-jordan-moved-app';
    const decoded = '/home/jordan/moved-app';
    state.readdirDirent.set(PROJECTS_DIR, [dir(slug)]);
    state.resolveBySlug.set(slug, { path: decoded, source: 'sessionCwd' });
    const candidate = join(HOME, 'dev', 'moved-app');
    state.statPaths.set(candidate, existingDirStat());
    mockPromptRemapDecision.mockResolvedValue({
      action: 'accept',
      path: candidate,
    });

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await expect(run({ dryRun: true })).resolves.toBeUndefined();

    const stderrText = stderrSpy.mock.calls
      .map((c) => (typeof c[0] === 'string' ? c[0] : Buffer.from(c[0]).toString('utf8')))
      .join('');
    expect(stderrText).toContain('[dry-run] No changes applied.');

    const stdoutText = stdoutSpy.mock.calls
      .map((c) => (typeof c[0] === 'string' ? c[0] : Buffer.from(c[0]).toString('utf8')))
      .join('');
    expect(stdoutText).toContain('1 project(s) will be renamed.');

    stderrSpy.mockRestore();
    stdoutSpy.mockRestore();
  });
});
