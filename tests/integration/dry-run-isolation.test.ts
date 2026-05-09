import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { makeDryRunWriteGate } from '../../src/services/write-gate.js';

interface FileFingerprint {
  size: number;
  contentSha: string;
}

async function fingerprint(filePath: string): Promise<FileFingerprint> {
  const buf = await readFile(filePath);
  // Use a simple deterministic identity (full content + size). For larger trees a
  // crypto hash would be more efficient; bytes-equality is sufficient here.
  return {
    size: buf.byteLength,
    contentSha: buf.toString('base64'),
  };
}

async function snapshot(dir: string): Promise<Record<string, FileFingerprint>> {
  const result: Record<string, FileFingerprint> = {};
  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        const rel = relative(dir, full);
        result[rel] = await fingerprint(full);
      }
    }
  }
  await walk(dir);
  return result;
}

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'cmemmov-dry-run-iso-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('dry-run WriteGate isolation (NFR12)', () => {
  it('leaves the filesystem byte-for-byte identical after dry-run write/rename/mkdir/remove', async () => {
    // Seed a small tree with diverse content
    await writeFile(join(tmpDir, 'seed.txt'), 'hello');
    await mkdir(join(tmpDir, 'nested'), { recursive: true });
    await writeFile(join(tmpDir, 'nested', 'inner.bin'), Buffer.from([1, 2, 3, 4, 5]));

    const before = await snapshot(tmpDir);

    const gate = makeDryRunWriteGate();
    await gate.write(join(tmpDir, 'new.txt'), 'world');
    await gate.rename(join(tmpDir, 'seed.txt'), join(tmpDir, 'renamed.txt'));
    await gate.mkdir(join(tmpDir, 'subdir'), { recursive: true });
    await gate.remove(join(tmpDir, 'seed.txt'));

    const after = await snapshot(tmpDir);
    expect(after).toEqual(before);
  });

  it('returns recordedOps reflecting the four invocations in order', async () => {
    const gate = makeDryRunWriteGate();
    const utf8Content = 'world';

    await gate.write(join(tmpDir, 'new.txt'), utf8Content);
    await gate.rename(join(tmpDir, 'seed.txt'), join(tmpDir, 'renamed.txt'));
    await gate.mkdir(join(tmpDir, 'subdir'));
    await gate.remove(join(tmpDir, 'seed.txt'));

    const ops = gate.recordedOps();
    expect(ops).toHaveLength(4);
    expect(ops[0]).toEqual({
      kind: 'write',
      path: join(tmpDir, 'new.txt'),
      bytes: Buffer.byteLength(utf8Content),
    });
    expect(ops[1]).toEqual({
      kind: 'rename',
      from: join(tmpDir, 'seed.txt'),
      to: join(tmpDir, 'renamed.txt'),
    });
    expect(ops[2]).toEqual({ kind: 'mkdir', path: join(tmpDir, 'subdir') });
    expect(ops[3]).toEqual({ kind: 'remove', path: join(tmpDir, 'seed.txt') });
  });

  it('does not create any of the paths referenced by recorded ops', async () => {
    const gate = makeDryRunWriteGate();
    const newPath = join(tmpDir, 'never-created.txt');
    const subdirPath = join(tmpDir, 'never-mkdir');

    await gate.write(newPath, 'content');
    await gate.mkdir(subdirPath);

    await expect(stat(newPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(subdirPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
