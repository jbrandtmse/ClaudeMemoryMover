import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyCategory } from './claude-writer.js';
import { makeDryRunWriteGate } from './write-gate.js';
import type { WriteOp } from './write-gate.js';

// Each test gets its own temp claudeDir so existing-on-disk state is isolated.
let claudeDir: string;

beforeEach(async () => {
  claudeDir = await mkdtemp(join(tmpdir(), 'cmemmov-writer-test-'));
});

afterEach(async () => {
  await rm(claudeDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function findWrite(ops: readonly WriteOp[], suffix: string): WriteOp | undefined {
  return ops.find((op) => op.kind === 'write' && op.path.endsWith(suffix));
}

function writePathsEnding(ops: readonly WriteOp[], suffix: string): string[] {
  return ops
    .filter((op): op is Extract<WriteOp, { kind: 'write' }> => op.kind === 'write')
    .map((op) => op.path)
    .filter((p) => p.endsWith(suffix));
}

function getCapturedContent(
  captured: { path: string; content: string }[],
  pathPredicate: (p: string) => boolean,
): string {
  const entry = captured.find((c) => pathPredicate(c.path));
  if (entry === undefined) {
    throw new Error(`No captured write matched the predicate; captured paths: ${captured.map((c) => c.path).join(', ')}`);
  }
  return entry.content;
}

describe('applyCategory — globalMemory', () => {
  it('merge: existing file kept, new file written, MEMORY.md rebuilt', async () => {
    const memoryDir = join(claudeDir, 'memory');
    await mkdir(memoryDir, { recursive: true });
    await writeFile(
      join(memoryDir, 'existing.md'),
      '# Existing\n\nDescription line.\n',
      'utf8',
    );
    await writeFile(
      join(memoryDir, 'MEMORY.md'),
      '# Memory Index\n\n- [Existing](existing.md) — description\n',
      'utf8',
    );

    const gate = makeDryRunWriteGate();
    await applyCategory({
      category: 'globalMemory',
      mode: 'merge',
      targetDir: claudeDir,
      gate,
      data: [
        { filename: 'new.md', content: '# New\n\nA new note line.\n' },
        // attempt to overwrite existing — should be skipped
        { filename: 'existing.md', content: '# CHANGED\n\nshould-not-write\n' },
      ],
    });

    const ops = gate.recordedOps();
    const newWrite = findWrite(ops, 'new.md');
    expect(newWrite).toBeDefined();
    // existing.md must NOT be rewritten (existing wins)
    expect(writePathsEnding(ops, 'existing.md')).toHaveLength(0);
    // MEMORY.md must be rebuilt and include both files
    const indexWrite = ops.find(
      (op): op is Extract<WriteOp, { kind: 'write' }> =>
        op.kind === 'write' && op.path.endsWith('MEMORY.md'),
    );
    expect(indexWrite).toBeDefined();
  });

  it('overwrite: removes memory dir then writes all files including rebuilt MEMORY.md', async () => {
    const memoryDir = join(claudeDir, 'memory');
    await mkdir(memoryDir, { recursive: true });
    await writeFile(join(memoryDir, 'old.md'), 'old', 'utf8');

    const gate = makeDryRunWriteGate();
    await applyCategory({
      category: 'globalMemory',
      mode: 'overwrite',
      targetDir: claudeDir,
      gate,
      data: [{ filename: 'a.md', content: '# A\n\nBody\n' }],
    });

    const ops = gate.recordedOps();
    const removeOp = ops.find((op) => op.kind === 'remove');
    expect(removeOp).toBeDefined();
    expect(findWrite(ops, 'a.md')).toBeDefined();
    expect(findWrite(ops, 'MEMORY.md')).toBeDefined();
  });
});

describe('applyCategory — globalSettings', () => {
  it('merge: incoming fields merged, existing fields preserved', async () => {
    await writeFile(
      join(claudeDir, 'settings.json'),
      JSON.stringify({ existing: 'value', shared: 'old' }),
      'utf8',
    );

    const gate = makeDryRunWriteGate();
    await applyCategory({
      category: 'globalSettings',
      mode: 'merge',
      targetDir: claudeDir,
      gate,
      data: { added: 'new', shared: 'new' },
    });

    const writeOp = findWrite(gate.recordedOps(), 'settings.json') as
      | Extract<WriteOp, { kind: 'write' }>
      | undefined;
    expect(writeOp).toBeDefined();
    // The dry-run gate doesn't capture the bytes — re-run on a fresh gate
    // capturing content via a custom WriteGate.
    const captured: { path: string; content: string }[] = [];
    const captureGate = makeCapturingGate(captured);
    await applyCategory({
      category: 'globalSettings',
      mode: 'merge',
      targetDir: claudeDir,
      gate: captureGate,
      data: { added: 'new', shared: 'new' },
    });
    const mergedRaw = getCapturedContent(captured, (p) => p.endsWith('settings.json'));
    const merged = JSON.parse(mergedRaw) as Record<string, unknown>;
    expect(merged.existing).toBe('value');
    expect(merged.added).toBe('new');
    expect(merged.shared).toBe('new');
  });

  it('overwrite: replaces existing settings.json wholesale', async () => {
    await writeFile(
      join(claudeDir, 'settings.json'),
      JSON.stringify({ stale: true }),
      'utf8',
    );
    const captured: { path: string; content: string }[] = [];
    await applyCategory({
      category: 'globalSettings',
      mode: 'overwrite',
      targetDir: claudeDir,
      gate: makeCapturingGate(captured),
      data: { fresh: true },
    });
    const writtenRaw = getCapturedContent(captured, (p) => p.endsWith('settings.json'));
    const written = JSON.parse(writtenRaw) as Record<string, unknown>;
    expect(written).toEqual({ fresh: true });
  });
});

describe('applyCategory — claudeMd', () => {
  it('merge: existing CLAUDE.md kept, no write recorded', async () => {
    await writeFile(join(claudeDir, 'CLAUDE.md'), 'existing', 'utf8');
    const gate = makeDryRunWriteGate();
    await applyCategory({
      category: 'claudeMd',
      mode: 'merge',
      targetDir: claudeDir,
      gate,
      data: { content: 'incoming' },
    });
    expect(gate.recordedOps().filter((op) => op.kind === 'write')).toHaveLength(0);
  });

  it('merge: writes CLAUDE.md when none exists', async () => {
    const gate = makeDryRunWriteGate();
    await applyCategory({
      category: 'claudeMd',
      mode: 'merge',
      targetDir: claudeDir,
      gate,
      data: { content: 'incoming' },
    });
    const writes = gate.recordedOps().filter((op) => op.kind === 'write');
    expect(writes).toHaveLength(1);
    expect(writes[0]?.path).toMatch(/CLAUDE\.md$/);
  });

  it('overwrite: writes CLAUDE.md regardless of existing', async () => {
    await writeFile(join(claudeDir, 'CLAUDE.md'), 'existing', 'utf8');
    const captured: { path: string; content: string }[] = [];
    await applyCategory({
      category: 'claudeMd',
      mode: 'overwrite',
      targetDir: claudeDir,
      gate: makeCapturingGate(captured),
      data: { content: 'incoming' },
    });
    expect(captured.find((c) => c.path.endsWith('CLAUDE.md'))?.content).toBe('incoming');
  });
});

describe('applyCategory — mcpConfig', () => {
  it('merge: union by name, existing entry kept on collision', async () => {
    await writeFile(
      join(claudeDir, 'settings.json'),
      JSON.stringify({
        mcpServers: {
          existing: { command: 'old' },
          shared: { command: 'old-shared' },
        },
      }),
      'utf8',
    );
    const captured: { path: string; content: string }[] = [];
    await applyCategory({
      category: 'mcpConfig',
      mode: 'merge',
      targetDir: claudeDir,
      gate: makeCapturingGate(captured),
      data: {
        added: { command: 'new' },
        shared: { command: 'new-shared' }, // collision: existing wins
      },
    });
    const updatedRaw = getCapturedContent(captured, (p) => p.endsWith('settings.json'));
    const updated = JSON.parse(updatedRaw) as Record<string, unknown>;
    const mcp = updated.mcpServers as Record<string, unknown>;
    expect(mcp.existing).toEqual({ command: 'old' });
    expect(mcp.added).toEqual({ command: 'new' });
    // collision: existing wins
    expect(mcp.shared).toEqual({ command: 'old-shared' });
  });

  it('overwrite: replaces mcpServers wholesale, preserving other settings keys', async () => {
    await writeFile(
      join(claudeDir, 'settings.json'),
      JSON.stringify({
        mcpServers: { old: { command: 'old' } },
        permissions: { allow: ['Bash(npm:*)'] },
      }),
      'utf8',
    );
    const captured: { path: string; content: string }[] = [];
    await applyCategory({
      category: 'mcpConfig',
      mode: 'overwrite',
      targetDir: claudeDir,
      gate: makeCapturingGate(captured),
      data: { fresh: { command: 'fresh' } },
    });
    const updatedRaw = getCapturedContent(captured, (p) => p.endsWith('settings.json'));
    const updated = JSON.parse(updatedRaw) as Record<string, unknown>;
    expect(updated.mcpServers).toEqual({ fresh: { command: 'fresh' } });
    // unrelated permissions key is preserved
    expect(updated.permissions).toBeDefined();
  });
});

describe('applyCategory — sessionHistory', () => {
  it('merge: existing JSONL not overwritten, new JSONL written', async () => {
    const slug = '-home-user-myproject';
    const sessionsDir = join(claudeDir, 'projects', slug, 'sessions');
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(join(sessionsDir, 'old-session.jsonl'), 'pre-existing', 'utf8');

    const gate = makeDryRunWriteGate();
    await applyCategory({
      category: 'sessionHistory',
      mode: 'merge',
      targetDir: claudeDir,
      gate,
      data: {
        slug,
        files: [
          { filename: 'old-session.jsonl', lines: ['{"new":true}'] },
          { filename: 'fresh-session.jsonl', lines: ['{"line":1}', '{"line":2}'] },
        ],
      },
    });
    const ops = gate.recordedOps();
    expect(writePathsEnding(ops, 'old-session.jsonl')).toHaveLength(0);
    expect(writePathsEnding(ops, 'fresh-session.jsonl')).toHaveLength(1);
  });

  it('overwrite: removes sessions dir and writes all incoming JSONL', async () => {
    const slug = '-home-user-myproject';
    const sessionsDir = join(claudeDir, 'projects', slug, 'sessions');
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(join(sessionsDir, 'old.jsonl'), 'old', 'utf8');

    const gate = makeDryRunWriteGate();
    await applyCategory({
      category: 'sessionHistory',
      mode: 'overwrite',
      targetDir: claudeDir,
      gate,
      data: {
        slug,
        files: [{ filename: 'new.jsonl', lines: ['{"a":1}'] }],
      },
    });
    const ops = gate.recordedOps();
    expect(ops.some((op) => op.kind === 'remove')).toBe(true);
    expect(writePathsEnding(ops, 'new.jsonl')).toHaveLength(1);
  });
});

describe('applyCategory — customCommands', () => {
  it('merge: existing filenames kept, new filenames written', async () => {
    const cmdDir = join(claudeDir, 'commands');
    await mkdir(cmdDir, { recursive: true });
    await writeFile(join(cmdDir, 'kept.md'), 'old', 'utf8');

    const gate = makeDryRunWriteGate();
    await applyCategory({
      category: 'customCommands',
      mode: 'merge',
      targetDir: claudeDir,
      gate,
      data: [
        { filename: 'kept.md', content: 'incoming' },
        { filename: 'new-cmd.md', content: 'new' },
      ],
    });
    const ops = gate.recordedOps();
    expect(writePathsEnding(ops, 'kept.md')).toHaveLength(0);
    expect(writePathsEnding(ops, 'new-cmd.md')).toHaveLength(1);
  });

  it('overwrite: removes commands dir and writes all incoming', async () => {
    const cmdDir = join(claudeDir, 'commands');
    await mkdir(cmdDir, { recursive: true });
    await writeFile(join(cmdDir, 'stale.md'), 'stale', 'utf8');
    const gate = makeDryRunWriteGate();
    await applyCategory({
      category: 'customCommands',
      mode: 'overwrite',
      targetDir: claudeDir,
      gate,
      data: [{ filename: 'cmd.md', content: 'body' }],
    });
    const ops = gate.recordedOps();
    expect(ops.some((op) => op.kind === 'remove')).toBe(true);
    expect(writePathsEnding(ops, 'cmd.md')).toHaveLength(1);
  });

  it('overwrite: skips remove when commands dir does not exist (fresh install)', async () => {
    const gate = makeDryRunWriteGate();
    await applyCategory({
      category: 'customCommands',
      mode: 'overwrite',
      targetDir: claudeDir,
      gate,
      data: [{ filename: 'cmd.md', content: 'body' }],
    });
    const ops = gate.recordedOps();
    // No prior commands dir → no remove op should be recorded.
    expect(ops.some((op) => op.kind === 'remove')).toBe(false);
    // mkdir + write still happen.
    expect(ops.some((op) => op.kind === 'mkdir')).toBe(true);
    expect(writePathsEnding(ops, 'cmd.md')).toHaveLength(1);
  });
});

describe('applyCategory — teams', () => {
  it('merge: union by team id; existing kept on id collision', async () => {
    const teamsDir = join(claudeDir, 'teams');
    await mkdir(join(teamsDir, 'old-team'), { recursive: true });
    await writeFile(
      join(teamsDir, 'old-team', 'config.json'),
      JSON.stringify({ id: 'team-1', name: 'Old' }),
      'utf8',
    );

    const captured: { path: string; content: string }[] = [];
    await applyCategory({
      category: 'teams',
      mode: 'merge',
      targetDir: claudeDir,
      gate: makeCapturingGate(captured),
      data: {
        // Same id as existing — must be skipped
        'colliding-team': { id: 'team-1', name: 'Incoming' },
        // New id — must be written
        'fresh-team': { id: 'team-2', name: 'Fresh' },
      },
    });
    expect(
      captured.find((c) => c.path.endsWith(join('colliding-team', 'config.json'))),
    ).toBeUndefined();
    const freshContent = getCapturedContent(captured, (p) =>
      p.endsWith(join('fresh-team', 'config.json')),
    );
    const cfg = JSON.parse(freshContent) as Record<string, unknown>;
    expect(cfg.id).toBe('team-2');
  });

  it('overwrite: removes teams dir and writes all incoming', async () => {
    const teamsDir = join(claudeDir, 'teams');
    await mkdir(join(teamsDir, 'stale'), { recursive: true });
    await writeFile(
      join(teamsDir, 'stale', 'config.json'),
      JSON.stringify({ id: 'stale' }),
      'utf8',
    );
    const gate = makeDryRunWriteGate();
    await applyCategory({
      category: 'teams',
      mode: 'overwrite',
      targetDir: claudeDir,
      gate,
      data: { 'a-team': { id: 'a', members: [] } },
    });
    const ops = gate.recordedOps();
    expect(ops.some((op) => op.kind === 'remove')).toBe(true);
    const teamWrites = writePathsEnding(ops, join('a-team', 'config.json'));
    expect(teamWrites).toHaveLength(1);
  });
});

describe('applyCategory — plugins', () => {
  it('merge: union by name; existing kept on collision', async () => {
    await writeFile(
      join(claudeDir, 'plugins.json'),
      JSON.stringify({ existing: { v: 1 }, shared: { v: 'old' } }),
      'utf8',
    );
    const captured: { path: string; content: string }[] = [];
    await applyCategory({
      category: 'plugins',
      mode: 'merge',
      targetDir: claudeDir,
      gate: makeCapturingGate(captured),
      data: { added: { v: 2 }, shared: { v: 'new' } },
    });
    const mergedRaw = getCapturedContent(captured, (p) => p.endsWith('plugins.json'));
    const merged = JSON.parse(mergedRaw) as Record<string, unknown>;
    expect(merged.existing).toEqual({ v: 1 });
    expect(merged.added).toEqual({ v: 2 });
    expect(merged.shared).toEqual({ v: 'old' });
  });

  it('overwrite: replaces plugins.json wholesale', async () => {
    await writeFile(join(claudeDir, 'plugins.json'), JSON.stringify({ stale: true }), 'utf8');
    const captured: { path: string; content: string }[] = [];
    await applyCategory({
      category: 'plugins',
      mode: 'overwrite',
      targetDir: claudeDir,
      gate: makeCapturingGate(captured),
      data: { fresh: { v: 1 } },
    });
    const writtenRaw = getCapturedContent(captured, (p) => p.endsWith('plugins.json'));
    const written = JSON.parse(writtenRaw) as Record<string, unknown>;
    expect(written).toEqual({ fresh: { v: 1 } });
  });
});

describe('applyCategory — fresh-install parent-dir creation', () => {
  it('claudeMd merge with slug: creates project parent dir before writing CLAUDE.md', async () => {
    const slug = '-home-user-newproj';
    const gate = makeDryRunWriteGate();
    await applyCategory({
      category: 'claudeMd',
      mode: 'merge',
      targetDir: claudeDir,
      gate,
      data: { content: '# New Project Rules', slug },
    });
    const ops = gate.recordedOps();
    // mkdir for the project dir must precede the CLAUDE.md write.
    const mkdirIdx = ops.findIndex(
      (op) => op.kind === 'mkdir' && op.path.endsWith(slug),
    );
    const writeIdx = ops.findIndex(
      (op) => op.kind === 'write' && op.path.endsWith('CLAUDE.md'),
    );
    expect(mkdirIdx).toBeGreaterThanOrEqual(0);
    expect(writeIdx).toBeGreaterThan(mkdirIdx);
  });

  it('projectSettings overwrite: creates project parent dir before writing settings.json', async () => {
    const slug = '-home-user-newproj';
    const gate = makeDryRunWriteGate();
    await applyCategory({
      category: 'projectSettings',
      mode: 'overwrite',
      targetDir: claudeDir,
      gate,
      data: { slug, settings: { permissions: { allow: [] } } },
    });
    const ops = gate.recordedOps();
    const mkdirIdx = ops.findIndex(
      (op) => op.kind === 'mkdir' && op.path.endsWith(slug),
    );
    const writeIdx = ops.findIndex(
      (op) => op.kind === 'write' && op.path.endsWith('settings.json'),
    );
    expect(mkdirIdx).toBeGreaterThanOrEqual(0);
    expect(writeIdx).toBeGreaterThan(mkdirIdx);
  });
});

describe('applyCategory — projectMemory & projectSettings', () => {
  it('projectMemory merge: routes through projects/<slug>/memory/', async () => {
    const slug = '-home-user-myproject';
    const gate = makeDryRunWriteGate();
    await applyCategory({
      category: 'projectMemory',
      mode: 'merge',
      targetDir: claudeDir,
      gate,
      data: { slug, files: [{ filename: 'p.md', content: '# P\n\nbody\n' }] },
    });
    const ops = gate.recordedOps();
    const pWrite = ops.find(
      (op) =>
        op.kind === 'write' && op.path.includes(slug) && op.path.endsWith('p.md'),
    );
    expect(pWrite).toBeDefined();
  });

  it('projectSettings merge: routes through projects/<slug>/settings.json', async () => {
    const slug = '-home-user-myproject';
    const captured: { path: string; content: string }[] = [];
    await applyCategory({
      category: 'projectSettings',
      mode: 'merge',
      targetDir: claudeDir,
      gate: makeCapturingGate(captured),
      data: { slug, settings: { permissions: { allow: ['X'] } } },
    });
    const cap = captured.find((c) => c.path.includes(slug) && c.path.endsWith('settings.json'));
    expect(cap).toBeDefined();
  });
});

// Lightweight gate that captures content alongside the op trace, used by tests
// asserting on serialized output. It mirrors makeDryRunWriteGate's no-fs
// semantics for safety.
function makeCapturingGate(
  captured: { path: string; content: string }[],
): import('./write-gate.js').WriteGate {
  const ops: WriteOp[] = [];
  return {
    write(path, content): Promise<void> {
      const text = typeof content === 'string' ? content : content.toString('utf8');
      captured.push({ path, content: text });
      ops.push({ kind: 'write', path, bytes: Buffer.byteLength(content) });
      return Promise.resolve();
    },
    rename(from, to): Promise<void> {
      ops.push({ kind: 'rename', from, to });
      return Promise.resolve();
    },
    mkdir(path): Promise<void> {
      ops.push({ kind: 'mkdir', path });
      return Promise.resolve();
    },
    remove(path): Promise<void> {
      ops.push({ kind: 'remove', path });
      return Promise.resolve();
    },
    recordedOps(): readonly WriteOp[] {
      return ops;
    },
  };
}
