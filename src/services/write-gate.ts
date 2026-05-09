import {
  writeFile as fsWriteFile,
  rename as fsRename,
  mkdir as fsMkdir,
  rm as fsRm,
  copyFile as fsCopyFile,
} from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import process from 'node:process';

export type WriteOp =
  | { kind: 'write'; path: string; bytes: number }
  | { kind: 'rename'; from: string; to: string }
  | { kind: 'mkdir'; path: string }
  | { kind: 'remove'; path: string };

export interface WriteGate {
  write(path: string, content: Buffer | string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  mkdir(path: string, opts?: { recursive?: boolean }): Promise<void>;
  remove(path: string): Promise<void>;
  recordedOps(): readonly WriteOp[];
}

export function makeLiveWriteGate(warn: (msg: string) => void = (): void => undefined): WriteGate {
  const ops: WriteOp[] = [];

  return {
    async write(path, content): Promise<void> {
      const tmp = `${path}.cmemmov-tmp-${process.pid.toString()}-${randomBytes(4).toString('hex')}`;
      await fsWriteFile(tmp, content);
      try {
        await fsRename(tmp, path);
      } catch (err) {
        // Best-effort cleanup of the temp file so a failed rename does not
        // leak a stale `.cmemmov-tmp-*` file next to the target.
        await fsRm(tmp, { force: true }).catch((): undefined => undefined);
        throw err;
      }
      ops.push({ kind: 'write', path, bytes: Buffer.byteLength(content) });
    },
    async rename(from, to): Promise<void> {
      try {
        await fsRename(from, to);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
          await fsCopyFile(from, to);
          await fsRm(from);
          warn(
            `cross-volume rename fallback engaged for ${from} -> ${to}: operation was completed via copy+unlink and is NOT atomic.`,
          );
        } else {
          throw err;
        }
      }
      ops.push({ kind: 'rename', from, to });
    },
    async mkdir(path, opts): Promise<void> {
      await fsMkdir(path, opts);
      ops.push({ kind: 'mkdir', path });
    },
    async remove(path): Promise<void> {
      await fsRm(path, { recursive: true });
      ops.push({ kind: 'remove', path });
    },
    recordedOps(): readonly WriteOp[] {
      return ops;
    },
  };
}

export function makeDryRunWriteGate(): WriteGate {
  const ops: WriteOp[] = [];

  return {
    write(path, content): Promise<void> {
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
