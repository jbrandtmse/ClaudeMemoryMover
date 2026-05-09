import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';

interface FakeGate {
  write: ReturnType<typeof vi.fn>;
  rename: ReturnType<typeof vi.fn>;
  mkdir: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  recordedOps: ReturnType<typeof vi.fn>;
  __kind: 'live' | 'dry';
}

interface FakeDirent {
  name: string;
  isDirectory: () => boolean;
}

interface FakeStats {
  isDirectory: () => boolean;
}

const state = vi.hoisted<{
  // readdir(path) → string[] for the plain (no withFileTypes) form.
  readdirPlain: Map<string, string[]>;
  // readdir(path, { withFileTypes: true }) → Dirent[] for walkDir + remove-list pre-scan.
  readdirDirent: Map<string, FakeDirent[]>;
  // ENOENT-throw set: any path in this set raises ENOENT regardless of which mode.
  enoentPaths: Set<string>;
  // stat(path) → { isDirectory } when path is in this map; absent → ENOENT.
  statPaths: Map<string, FakeStats>;
  // readFile(path) → Buffer (defaults to a small payload if absent).
  readFileMap: Map<string, Buffer>;
  liveGates: FakeGate[];
  dryGates: FakeGate[];
  recordedOpsResult: { kind: 'write'; path: string; bytes: number }[];
}>(() => ({
  readdirPlain: new Map(),
  readdirDirent: new Map(),
  enoentPaths: new Set(),
  statPaths: new Map(),
  readFileMap: new Map(),
  liveGates: [],
  dryGates: [],
  recordedOpsResult: [],
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
      if (opts?.withFileTypes === true) {
        const ents = state.readdirDirent.get(p);
        if (ents === undefined) {
          return Promise.reject(enoent(p));
        }
        return Promise.resolve(ents);
      }
      const list = state.readdirPlain.get(p);
      if (list === undefined) {
        return Promise.reject(enoent(p));
      }
      return Promise.resolve(list);
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
    // access() is used by rollback.ts as a pre-validation pass to prove every
    // backup file is readable BEFORE we delete any of the user's existing
    // ~/.claude/ state. The mock treats every path as accessible unless it is
    // explicitly listed in `enoentPaths`, mirroring the test's existing
    // ENOENT-injection convention for readdir/stat.
    access: vi.fn((p: string) => {
      if (state.enoentPaths.has(p)) {
        return Promise.reject(enoent(p));
      }
      return Promise.resolve();
    }),
    readFile: vi.fn((p: string) => {
      const b = state.readFileMap.get(p);
      if (b === undefined) {
        // Default: return a small buffer so the gate.write call has bytes.
        return Promise.resolve(Buffer.from(`content:${p}`));
      }
      return Promise.resolve(b);
    }),
  };
});

vi.mock('../services/claude-locator.js', () => ({
  locateClaude: vi.fn(() => ({
    claudeDir: CLAUDE_DIR,
    claudeJson: CLAUDE_JSON,
  })),
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

import { run } from './rollback.js';
import { CmemmovError } from '../core/error.js';
import * as gateSvc from '../services/write-gate.js';

// Use the platform's path.join so test fixture keys match what production
// code produces from join(claudeDir, ...). On Windows this is backslashes.
const CLAUDE_DIR = join('/home', 'u', '.claude');
const CLAUDE_JSON = join('/home', 'u', '.claude.json');
const BACKUP_ROOT = join(CLAUDE_DIR, 'backups', 'cmemmov');
const BACKUP_NAME = '2026-05-09T17-21-33-289Z-12345-a1b2c3d4';
const BACKUP_DIR = join(BACKUP_ROOT, BACKUP_NAME);

function file(name: string): FakeDirent {
  return { name, isDirectory: (): boolean => false };
}
function dir(name: string): FakeDirent {
  return { name, isDirectory: (): boolean => true };
}

function resetState(): void {
  state.readdirPlain = new Map();
  state.readdirDirent = new Map();
  state.enoentPaths = new Set();
  state.statPaths = new Map();
  state.readFileMap = new Map();
  state.liveGates = [];
  state.dryGates = [];
  state.recordedOpsResult = [];
}

// Convenience: arrange a backup with a fixed shape.
//   ~/.claude/.../<BACKUP_DIR>/
//     .claude.json
//     settings.json
//     memory/MEMORY.md
//   ~/.claude/ children: settings.json, memory, backups
function arrangeNominalBackup(): void {
  state.readdirPlain.set(BACKUP_ROOT, [BACKUP_NAME]);
  state.readdirPlain.set(BACKUP_DIR, ['.claude.json', 'settings.json', 'memory']);

  state.readdirDirent.set(BACKUP_DIR, [
    file('.claude.json'),
    file('settings.json'),
    dir('memory'),
  ]);
  state.readdirDirent.set(join(BACKUP_DIR, 'memory'), [file('MEMORY.md')]);

  state.readdirPlain.set(CLAUDE_DIR, ['settings.json', 'memory', 'backups']);
}

beforeEach(() => {
  resetState();
  vi.mocked(gateSvc.makeLiveWriteGate).mockClear();
  vi.mocked(gateSvc.makeDryRunWriteGate).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AC1: most recent backup is restored via WriteGate', () => {
  it('removes non-backup children of claudeDir, writes backup contents, restores .claude.json adjacent', async () => {
    arrangeNominalBackup();

    await run({});

    expect(gateSvc.makeLiveWriteGate).toHaveBeenCalledTimes(1);
    const gate = state.liveGates[0];
    expect(gate).toBeDefined();

    // Non-backup children removed; 'backups' must NOT be removed.
    const removedPaths = (gate?.remove.mock.calls ?? []).map(
      (c: unknown[]) => c[0] as string,
    );
    expect(removedPaths).toContain(join(CLAUDE_DIR, 'settings.json'));
    expect(removedPaths).toContain(join(CLAUDE_DIR, 'memory'));
    expect(removedPaths).not.toContain(join(CLAUDE_DIR, 'backups'));

    // .claude.json restored to ~/.claude.json (NOT ~/.claude/.claude.json).
    const writePaths = (gate?.write.mock.calls ?? []).map(
      (c: unknown[]) => c[0] as string,
    );
    expect(writePaths).toContain(CLAUDE_JSON);
    expect(writePaths).not.toContain(join(CLAUDE_DIR, '.claude.json'));

    // Other backup files restored under claudeDir at the same relative path.
    expect(writePaths).toContain(join(CLAUDE_DIR, 'settings.json'));
    expect(writePaths).toContain(join(CLAUDE_DIR, 'memory', 'MEMORY.md'));
  });
});

describe('AC2: ROLLBACK_NOT_AVAILABLE when no backup directory exists', () => {
  it('BACKUP_ROOT missing → ROLLBACK_NOT_AVAILABLE with helpful hint and exitCode 2', async () => {
    state.enoentPaths.add(BACKUP_ROOT);

    let caught: unknown;
    try {
      await run({});
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(CmemmovError);
    const err = caught as CmemmovError;
    expect(err.code).toBe('ROLLBACK_NOT_AVAILABLE');
    expect(err.exitCode).toBe(2);
    expect(err.hint).toContain('no backups found under');
    expect(err.hint).toContain(BACKUP_ROOT);
  });

  it('BACKUP_ROOT exists but contains zero entries → ROLLBACK_NOT_AVAILABLE', async () => {
    state.readdirPlain.set(BACKUP_ROOT, []);

    await expect(run({})).rejects.toMatchObject({
      code: 'ROLLBACK_NOT_AVAILABLE',
    });
  });
});

describe('AC3/AC4: success summary names the restored backup', () => {
  it('out.finish summary includes the backupDir path', async () => {
    arrangeNominalBackup();

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await run({});

    const stdoutText = stdoutSpy.mock.calls
      .map((c) => (typeof c[0] === 'string' ? c[0] : Buffer.from(c[0]).toString('utf8')))
      .join('');
    expect(stdoutText).toContain(BACKUP_DIR);
    expect(stdoutText).toMatch(/Rollback complete/);
    stdoutSpy.mockRestore();
  });

  it('--json: progress on stderr; final JSON on stdout includes restored backup path', async () => {
    arrangeNominalBackup();
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await run({ json: true });

    const stdoutText = stdoutSpy.mock.calls
      .map((c) => (typeof c[0] === 'string' ? c[0] : Buffer.from(c[0]).toString('utf8')))
      .join('');
    const stderrText = stderrSpy.mock.calls
      .map((c) => (typeof c[0] === 'string' ? c[0] : Buffer.from(c[0]).toString('utf8')))
      .join('');

    // Progress goes to stderr in JSON mode.
    expect(stderrText).toContain('Restoring backup');

    const lastLine = stdoutText.split('\n').filter((l) => l.length > 0).pop() ?? '';
    const parsed = JSON.parse(lastLine) as {
      success: boolean;
      command: string;
      summary: string;
    };
    expect(parsed.success).toBe(true);
    expect(parsed.command).toBe('rollback');
    expect(parsed.summary).toContain(BACKUP_DIR);

    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });
});

describe('AC5: corrupted (empty) backup throws ROLLBACK_NOT_AVAILABLE; no fallback', () => {
  it('most-recent backup dir empty → throw; older backup is NOT used', async () => {
    const olderName = '2026-05-08T10-00-00-000Z-99999-deadbeef';
    state.readdirPlain.set(BACKUP_ROOT, [olderName, BACKUP_NAME]); // unsorted
    // Most-recent (lexicographically last) backup is empty → corruption.
    state.readdirPlain.set(BACKUP_DIR, []);

    let caught: unknown;
    try {
      await run({});
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(CmemmovError);
    expect((caught as CmemmovError).code).toBe('ROLLBACK_NOT_AVAILABLE');
    expect((caught as CmemmovError).hint).toContain('--backup <path>');

    // No write gate ever constructed (we threw before announcing).
    expect(gateSvc.makeLiveWriteGate).not.toHaveBeenCalled();
    expect(gateSvc.makeDryRunWriteGate).not.toHaveBeenCalled();
  });
});

describe('AC6: --dry-run uses dry-run gate; no live writes', () => {
  it('makeDryRunWriteGate used; gate.write recorded but live gate not constructed', async () => {
    arrangeNominalBackup();
    state.recordedOpsResult = [
      { kind: 'write', path: `${CLAUDE_DIR}/settings.json`, bytes: 10 },
      { kind: 'write', path: '/home/u/.claude.json', bytes: 5 },
      { kind: 'write', path: `${CLAUDE_DIR}/memory/MEMORY.md`, bytes: 20 },
    ];

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await run({ dryRun: true });

    expect(gateSvc.makeDryRunWriteGate).toHaveBeenCalledTimes(1);
    expect(gateSvc.makeLiveWriteGate).not.toHaveBeenCalled();

    // Dry-run gate STILL records the conceptual writes.
    const gate = state.dryGates[0];
    expect(gate).toBeDefined();
    expect(gate?.write).toHaveBeenCalled();

    const stdoutText = stdoutSpy.mock.calls
      .map((c) => (typeof c[0] === 'string' ? c[0] : Buffer.from(c[0]).toString('utf8')))
      .join('');
    expect(stdoutText).toMatch(/Dry run/);
    expect(stdoutText).toContain(BACKUP_DIR);
    expect(stdoutText).toMatch(/3 write op/);

    stdoutSpy.mockRestore();
  });
});

describe('--backup <path> selects an explicit backup', () => {
  it('uses the provided path instead of scanning BACKUP_ROOT for the most recent', async () => {
    const explicit = join(BACKUP_ROOT, 'older-explicit-backup');

    // Most-recent scan should NOT happen — but if it accidentally does, make
    // it produce a different value so the test would notice.
    state.readdirPlain.set(BACKUP_ROOT, ['some-other-backup']);
    state.statPaths.set(explicit, { isDirectory: (): boolean => true });
    state.readdirPlain.set(explicit, ['settings.json']);
    state.readdirDirent.set(explicit, [file('settings.json')]);
    state.readdirPlain.set(CLAUDE_DIR, ['settings.json', 'backups']);

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await run({ backup: explicit });

    const stdoutText = stdoutSpy.mock.calls
      .map((c) => (typeof c[0] === 'string' ? c[0] : Buffer.from(c[0]).toString('utf8')))
      .join('');
    expect(stdoutText).toContain(explicit);
    expect(stdoutText).not.toContain('some-other-backup');

    stdoutSpy.mockRestore();
  });

  it('explicit --backup path missing → ROLLBACK_NOT_AVAILABLE with that path in hint', async () => {
    const missing = '/no/such/backup/here';
    state.enoentPaths.add(missing);

    let caught: unknown;
    try {
      await run({ backup: missing });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(CmemmovError);
    expect((caught as CmemmovError).code).toBe('ROLLBACK_NOT_AVAILABLE');
    expect((caught as CmemmovError).hint).toContain(missing);
  });
});

describe('most-recent selection: lexicographically last backup is chosen', () => {
  it('picks the lexicographically last entry from BACKUP_ROOT', async () => {
    const oldest = '2026-05-01T00-00-00-000Z-1-aaaa';
    const middle = '2026-05-05T00-00-00-000Z-2-bbbb';
    const newest = '2026-05-09T17-21-33-289Z-3-cccc';

    // Provide them out of order to verify sort() is what selects newest.
    state.readdirPlain.set(BACKUP_ROOT, [middle, oldest, newest]);

    const newestDir = join(BACKUP_ROOT, newest);
    state.readdirPlain.set(newestDir, ['settings.json']);
    state.readdirDirent.set(newestDir, [file('settings.json')]);
    state.readdirPlain.set(CLAUDE_DIR, ['settings.json', 'backups']);

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await run({});

    const stdoutText = stdoutSpy.mock.calls
      .map((c) => (typeof c[0] === 'string' ? c[0] : Buffer.from(c[0]).toString('utf8')))
      .join('');
    expect(stdoutText).toContain(newest);
    expect(stdoutText).not.toContain(oldest);
    expect(stdoutText).not.toContain(middle);

    stdoutSpy.mockRestore();
  });
});

describe('preserves backups/ subtree during restore', () => {
  it('gate.remove is never called for ~/.claude/backups', async () => {
    arrangeNominalBackup();

    await run({});

    const gate = state.liveGates[0];
    expect(gate).toBeDefined();
    const removed = (gate?.remove.mock.calls ?? []).map(
      (c: unknown[]) => c[0] as string,
    );
    expect(removed).not.toContain(join(CLAUDE_DIR, 'backups'));
  });
});

describe('AC1 safety: validates backup readability before any destruction', () => {
  it('unreadable backup file aborts BEFORE clearing ~/.claude/ contents', async () => {
    arrangeNominalBackup();
    // Mark one backup file as unreadable. The pre-validation pass MUST fail
    // before any gate.remove call destroys the user's existing state.
    const unreadable = join(BACKUP_DIR, 'memory', 'MEMORY.md');
    state.enoentPaths.add(unreadable);

    let caught: unknown;
    try {
      await run({});
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(CmemmovError);
    expect((caught as CmemmovError).code).toBe('ROLLBACK_NOT_AVAILABLE');
    expect((caught as CmemmovError).hint).toContain('unreadable');

    // CRITICAL: no gate was constructed and therefore no destruction occurred.
    // The user's existing ~/.claude/ is left intact when the backup we were
    // about to restore from turns out to be unreadable.
    expect(gateSvc.makeLiveWriteGate).not.toHaveBeenCalled();
    expect(gateSvc.makeDryRunWriteGate).not.toHaveBeenCalled();
  });
});

describe('AC1: when backup lacks .claude.json, existing ~/.claude.json is removed', () => {
  it('removes existing ~/.claude.json so post-state matches the backup', async () => {
    // Backup contains ONLY settings.json (no .claude.json at top level).
    state.readdirPlain.set(BACKUP_ROOT, [BACKUP_NAME]);
    state.readdirPlain.set(BACKUP_DIR, ['settings.json']);
    state.readdirDirent.set(BACKUP_DIR, [file('settings.json')]);
    state.readdirPlain.set(CLAUDE_DIR, ['settings.json', 'backups']);
    // Existing ~/.claude.json on disk.
    state.statPaths.set(CLAUDE_JSON, { isDirectory: (): boolean => false });

    await run({});

    const gate = state.liveGates[0];
    expect(gate).toBeDefined();
    const removedPaths = (gate?.remove.mock.calls ?? []).map(
      (c: unknown[]) => c[0] as string,
    );
    expect(removedPaths).toContain(CLAUDE_JSON);
  });

  it('does NOT call gate.remove on ~/.claude.json when it does not exist', async () => {
    // Backup without .claude.json AND no existing ~/.claude.json on disk.
    state.readdirPlain.set(BACKUP_ROOT, [BACKUP_NAME]);
    state.readdirPlain.set(BACKUP_DIR, ['settings.json']);
    state.readdirDirent.set(BACKUP_DIR, [file('settings.json')]);
    state.readdirPlain.set(CLAUDE_DIR, ['settings.json', 'backups']);
    // CLAUDE_JSON intentionally NOT in statPaths → stat() rejects ENOENT.

    await run({});

    const gate = state.liveGates[0];
    expect(gate).toBeDefined();
    const removedPaths = (gate?.remove.mock.calls ?? []).map(
      (c: unknown[]) => c[0] as string,
    );
    expect(removedPaths).not.toContain(CLAUDE_JSON);
  });
});
