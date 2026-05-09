import { cp, rm, readdir, copyFile, access, mkdtemp, mkdir, rename } from 'node:fs/promises';
import { join, dirname, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import process from 'node:process';

export interface CreateBackupOptions {
  keepBackups?: number;
}

// Node's fs.cp rejects with EINVAL when the destination is a subdirectory of
// the source, even with a filter. To back up claudeDir into claudeDir/backups/...
// we stage the copy in os.tmpdir() and then rename it into place.
async function stageClaudeCopy(claudeDir: string): Promise<string> {
  const stagingParent = await mkdtemp(join(tmpdir(), 'cmemmov-backup-stage-'));
  const stagingClaude = join(stagingParent, 'claude');

  // Exclude pre-existing backups so a new backup never contains older backups.
  const claudeBackupsExact = join(claudeDir, 'backups');
  const excludePrefix = claudeBackupsExact + sep;
  await cp(claudeDir, stagingClaude, {
    recursive: true,
    filter: (src): boolean =>
      src !== claudeBackupsExact && !src.startsWith(excludePrefix),
  });

  return stagingParent;
}

export async function createBackup(
  claudeDir: string,
  opts?: CreateBackupOptions,
): Promise<string> {
  const keepBackups = opts?.keepBackups ?? 10;
  const backupRoot = join(claudeDir, 'backups', 'cmemmov');

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const suffix = `${process.pid.toString()}-${randomBytes(4).toString('hex')}`;
  const backupDir = join(backupRoot, `${ts}-${suffix}`);

  // Stage the claudeDir copy in os.tmpdir() to avoid the dest-inside-src issue.
  const staging = await stageClaudeCopy(claudeDir);

  // Move staging into the final backup location atomically (when same volume).
  await mkdir(backupRoot, { recursive: true });
  try {
    await rename(staging, backupDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
      // Cross-volume: tmpdir is on a different filesystem. Fall back to recursive cp + rm.
      await cp(staging, backupDir, { recursive: true });
      await rm(staging, { recursive: true, force: true });
    } else {
      // Best-effort cleanup of the staging dir; rethrow original error.
      await rm(staging, { recursive: true, force: true }).catch(() => undefined);
      throw err;
    }
  }

  // Copy adjacent .claude.json — skip ONLY if absent (ENOENT). Any other
  // error (permission denied, disk full mid-copy, etc.) must propagate so
  // callers do not silently get a backup with a missing .claude.json.
  const claudeJsonSrc = join(dirname(claudeDir), '.claude.json');
  try {
    await access(claudeJsonSrc);
    await copyFile(claudeJsonSrc, join(backupDir, '.claude.json'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
    // .claude.json absent — not an error
  }

  // Prune oldest backups beyond keepBackups limit. Always exclude the backup
  // we just created from the prune list — keepBackups<1 would otherwise
  // destroy a backup the caller has not yet had a chance to use, breaking
  // the function's contract that the returned path points at a real backup.
  const justCreated = backupDir.slice(backupRoot.length + 1);
  const entries = await readdir(backupRoot);
  const sorted = [...entries].sort();
  const toRemove = sorted
    .slice(0, Math.max(0, sorted.length - keepBackups))
    .filter((entry) => entry !== justCreated);
  await Promise.all(
    toRemove.map((entry) => rm(join(backupRoot, entry), { recursive: true })),
  );

  return backupDir;
}
