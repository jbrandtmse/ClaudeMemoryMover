import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

/**
 * Byte-for-byte snapshot of every file under `dir` keyed by relative path.
 * Returns `null` if `dir` does not exist. Used by dry-run tests to assert
 * NFR12 (zero filesystem changes) holds across the whole subtree.
 */
export async function snapshotTree(dir: string): Promise<Record<string, string> | null> {
  if (!(await pathExists(dir))) return null;
  const out: Record<string, string> = {};
  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        const buf = await readFile(full);
        out[relative(dir, full)] = buf.toString('base64');
      }
    }
  }
  await walk(dir);
  return out;
}
