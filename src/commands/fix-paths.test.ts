import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';

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

import { run, scanProjects } from './fix-paths.js';

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

function resetState(): void {
  state.readdirDirent = new Map();
  state.enoentPaths = new Set();
  state.statPaths = new Map();
  state.resolveBySlug = new Map();
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

    // run() should exit normally (Story 3.1 stops here; remap phase deferred).
    await expect(run({})).resolves.toBeUndefined();

    const stdoutText = stdoutSpy.mock.calls
      .map((c) => (typeof c[0] === 'string' ? c[0] : Buffer.from(c[0]).toString('utf8')))
      .join('');
    expect(stdoutText).toContain('1 project(s) need path repair.');

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

    // Command exits normally (exit 0 in Story 3.1)
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await expect(run({})).resolves.toBeUndefined();

    const stdoutText = stdoutSpy.mock.calls
      .map((c) => (typeof c[0] === 'string' ? c[0] : Buffer.from(c[0]).toString('utf8')))
      .join('');
    expect(stdoutText).toContain('1 project(s) need path repair.');

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
    expect(parsed.summary.text).toContain('1 project(s) need path repair.');

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
