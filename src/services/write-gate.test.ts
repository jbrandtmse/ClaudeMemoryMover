import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn(),
  rename: vi.fn(),
  mkdir: vi.fn(),
  rm: vi.fn(),
  copyFile: vi.fn(),
}));

import {
  writeFile as fsWriteFile,
  rename as fsRename,
  mkdir as fsMkdir,
  rm as fsRm,
  copyFile as fsCopyFile,
} from 'node:fs/promises';
import { makeLiveWriteGate, makeDryRunWriteGate } from './write-gate.js';

const mockedWriteFile = vi.mocked(fsWriteFile);
const mockedRename = vi.mocked(fsRename);
const mockedMkdir = vi.mocked(fsMkdir);
const mockedRm = vi.mocked(fsRm);
const mockedCopyFile = vi.mocked(fsCopyFile);

beforeEach(() => {
  mockedWriteFile.mockReset();
  mockedRename.mockReset();
  mockedMkdir.mockReset();
  mockedRm.mockReset();
  mockedCopyFile.mockReset();
  mockedWriteFile.mockResolvedValue(undefined);
  mockedRename.mockResolvedValue(undefined);
  mockedMkdir.mockResolvedValue(undefined);
  mockedRm.mockResolvedValue(undefined);
  mockedCopyFile.mockResolvedValue(undefined);
});

describe('makeLiveWriteGate', () => {
  describe('write', () => {
    it('writes content to a temp path and atomically renames to the target', async () => {
      const gate = makeLiveWriteGate();
      await gate.write('/tmp/target.txt', 'hello');

      expect(mockedWriteFile).toHaveBeenCalledTimes(1);
      const tmpPath = mockedWriteFile.mock.calls[0]?.[0] as string;
      expect(tmpPath.startsWith('/tmp/target.txt.cmemmov-tmp-')).toBe(true);
      expect(mockedWriteFile.mock.calls[0]?.[1]).toBe('hello');

      expect(mockedRename).toHaveBeenCalledTimes(1);
      expect(mockedRename).toHaveBeenCalledWith(tmpPath, '/tmp/target.txt');
    });

    it('records a write op with the byte length of the content', async () => {
      const gate = makeLiveWriteGate();
      await gate.write('/tmp/a.txt', 'hello');
      const buffer = Buffer.from('binary-payload');
      await gate.write('/tmp/b.bin', buffer);

      const ops = gate.recordedOps();
      expect(ops).toHaveLength(2);
      expect(ops[0]).toEqual({ kind: 'write', path: '/tmp/a.txt', bytes: 5 });
      expect(ops[1]).toEqual({
        kind: 'write',
        path: '/tmp/b.bin',
        bytes: Buffer.byteLength(buffer),
      });
    });

    it('uses a unique temp suffix on each invocation (process.pid + random)', async () => {
      const gate = makeLiveWriteGate();
      await gate.write('/tmp/x.txt', 'a');
      await gate.write('/tmp/x.txt', 'b');

      const first = mockedWriteFile.mock.calls[0]?.[0] as string;
      const second = mockedWriteFile.mock.calls[1]?.[0] as string;
      expect(first).not.toBe(second);
      expect(first).toMatch(/\.cmemmov-tmp-\d+-[0-9a-f]{8}$/);
      expect(second).toMatch(/\.cmemmov-tmp-\d+-[0-9a-f]{8}$/);
    });

    it('cleans up the temp file when rename fails and rethrows the original error', async () => {
      const renameErr = Object.assign(new Error('permission denied'), { code: 'EPERM' });
      mockedRename.mockRejectedValueOnce(renameErr);

      const gate = makeLiveWriteGate();
      await expect(gate.write('/tmp/target.txt', 'hello')).rejects.toThrow('permission denied');

      const tmpPath = mockedWriteFile.mock.calls[0]?.[0] as string;
      expect(mockedRm).toHaveBeenCalledWith(tmpPath, { force: true });
      // Op must NOT be recorded when the write ultimately failed.
      expect(gate.recordedOps()).toEqual([]);
    });

    it('still rethrows the rename error even if temp-file cleanup fails', async () => {
      const renameErr = Object.assign(new Error('permission denied'), { code: 'EPERM' });
      const rmErr = Object.assign(new Error('rm failed'), { code: 'EACCES' });
      mockedRename.mockRejectedValueOnce(renameErr);
      mockedRm.mockRejectedValueOnce(rmErr);

      const gate = makeLiveWriteGate();
      // The original rename error should surface, not the cleanup failure.
      await expect(gate.write('/tmp/target.txt', 'hello')).rejects.toThrow('permission denied');
    });
  });

  describe('rename', () => {
    it('calls fs.rename and records a rename op on success', async () => {
      const gate = makeLiveWriteGate();
      await gate.rename('/tmp/a', '/tmp/b');

      expect(mockedRename).toHaveBeenCalledWith('/tmp/a', '/tmp/b');
      expect(mockedCopyFile).not.toHaveBeenCalled();
      expect(gate.recordedOps()).toEqual([{ kind: 'rename', from: '/tmp/a', to: '/tmp/b' }]);
    });

    it('falls back to copyFile + rm and emits a warning when rename throws EXDEV', async () => {
      const exdev = Object.assign(new Error('cross-device link'), { code: 'EXDEV' });
      mockedRename.mockRejectedValueOnce(exdev);
      const warn = vi.fn();

      const gate = makeLiveWriteGate(warn);
      await gate.rename('/vol1/a', '/vol2/b');

      expect(mockedCopyFile).toHaveBeenCalledWith('/vol1/a', '/vol2/b');
      expect(mockedRm).toHaveBeenCalledWith('/vol1/a');
      expect(warn).toHaveBeenCalledTimes(1);
      const warnMsg = warn.mock.calls[0]?.[0] as string;
      expect(warnMsg).toMatch(/cross-volume/i);
      expect(warnMsg).toMatch(/NOT atomic/i);

      expect(gate.recordedOps()).toEqual([
        { kind: 'rename', from: '/vol1/a', to: '/vol2/b' },
      ]);
    });

    it('rethrows non-EXDEV errors without invoking the fallback', async () => {
      const eperm = Object.assign(new Error('permission denied'), { code: 'EPERM' });
      mockedRename.mockRejectedValueOnce(eperm);
      const warn = vi.fn();
      const gate = makeLiveWriteGate(warn);

      await expect(gate.rename('/a', '/b')).rejects.toThrow('permission denied');
      expect(mockedCopyFile).not.toHaveBeenCalled();
      expect(mockedRm).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      expect(gate.recordedOps()).toEqual([]);
    });
  });

  describe('mkdir', () => {
    it('forwards opts and records the op', async () => {
      const gate = makeLiveWriteGate();
      await gate.mkdir('/tmp/newdir', { recursive: true });

      expect(mockedMkdir).toHaveBeenCalledWith('/tmp/newdir', { recursive: true });
      expect(gate.recordedOps()).toEqual([{ kind: 'mkdir', path: '/tmp/newdir' }]);
    });
  });

  describe('remove', () => {
    it('removes recursively and records the op', async () => {
      const gate = makeLiveWriteGate();
      await gate.remove('/tmp/old');

      expect(mockedRm).toHaveBeenCalledWith('/tmp/old', { recursive: true });
      expect(gate.recordedOps()).toEqual([{ kind: 'remove', path: '/tmp/old' }]);
    });
  });
});

describe('makeDryRunWriteGate', () => {
  it('performs zero filesystem operations on write', async () => {
    const gate = makeDryRunWriteGate();
    await gate.write('/tmp/target', 'hello');

    expect(mockedWriteFile).not.toHaveBeenCalled();
    expect(mockedRename).not.toHaveBeenCalled();
  });

  it('performs zero filesystem operations on rename', async () => {
    const gate = makeDryRunWriteGate();
    await gate.rename('/a', '/b');

    expect(mockedRename).not.toHaveBeenCalled();
    expect(mockedCopyFile).not.toHaveBeenCalled();
  });

  it('performs zero filesystem operations on mkdir and remove', async () => {
    const gate = makeDryRunWriteGate();
    await gate.mkdir('/x', { recursive: true });
    await gate.remove('/y');

    expect(mockedMkdir).not.toHaveBeenCalled();
    expect(mockedRm).not.toHaveBeenCalled();
  });

  it('records all operations in invocation order with correct shapes', async () => {
    const gate = makeDryRunWriteGate();
    await gate.write('/p/a.txt', 'hello');
    await gate.rename('/p/a.txt', '/p/b.txt');
    await gate.mkdir('/p/sub');
    await gate.remove('/p/old');

    const ops = gate.recordedOps();
    expect(ops).toEqual([
      { kind: 'write', path: '/p/a.txt', bytes: 5 },
      { kind: 'rename', from: '/p/a.txt', to: '/p/b.txt' },
      { kind: 'mkdir', path: '/p/sub' },
      { kind: 'remove', path: '/p/old' },
    ]);
  });

  it('reports byte length for Buffer content correctly', async () => {
    const gate = makeDryRunWriteGate();
    const utf8 = 'héllo'; // 6 bytes in UTF-8
    await gate.write('/p/x.txt', utf8);
    await gate.write('/p/y.bin', Buffer.from([1, 2, 3, 4]));

    const ops = gate.recordedOps();
    expect(ops[0]).toMatchObject({ kind: 'write', bytes: Buffer.byteLength(utf8) });
    expect(ops[1]).toMatchObject({ kind: 'write', bytes: 4 });
  });
});
