import { access, readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { locateClaude } from '../services/claude-locator.js';
import {
  makeLiveWriteGate,
  makeDryRunWriteGate,
  type WriteGate,
} from '../services/write-gate.js';
import { Output } from '../ui/output.js';
import { CmemmovError } from '../core/error.js';

export interface RollbackOpts {
  backup?: string;
  dryRun?: boolean;
  silent?: boolean;
  json?: boolean;
}

interface WalkEntry {
  absPath: string;
  relPath: string;
  isDir: boolean;
}

async function* walkDir(root: string, prefix = ''): AsyncGenerator<WalkEntry> {
  const entries = await readdir(root, { withFileTypes: true });
  for (const e of entries) {
    const abs = join(root, e.name);
    const rel = prefix.length > 0 ? join(prefix, e.name) : e.name;
    if (e.isDirectory()) {
      yield { absPath: abs, relPath: rel, isDir: true };
      yield* walkDir(abs, rel);
    } else {
      yield { absPath: abs, relPath: rel, isDir: false };
    }
  }
}

// readdir wrapper that translates ENOENT to the structured rollback error.
// Other I/O errors propagate so callers do not silently mask permission or
// disk faults as "no backups found".
async function readdirOrThrowRollbackNotAvailable(
  path: string,
  hint: string,
): Promise<string[]> {
  try {
    return await readdir(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new CmemmovError({ code: 'ROLLBACK_NOT_AVAILABLE', hint });
    }
    throw err;
  }
}

async function statOrThrowRollbackNotAvailable(
  path: string,
  hint: string,
): Promise<void> {
  try {
    const s = await stat(path);
    if (!s.isDirectory()) {
      throw new CmemmovError({ code: 'ROLLBACK_NOT_AVAILABLE', hint });
    }
  } catch (err) {
    if (err instanceof CmemmovError) throw err;
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new CmemmovError({ code: 'ROLLBACK_NOT_AVAILABLE', hint });
    }
    throw err;
  }
}

export async function run(opts: RollbackOpts = {}): Promise<void> {
  const out = new Output('rollback', { json: opts.json === true });

  const loc = locateClaude();
  const backupRoot = join(loc.claudeDir, 'backups', 'cmemmov');

  let backupDir: string;
  if (opts.backup !== undefined) {
    backupDir = opts.backup;
    await statOrThrowRollbackNotAvailable(
      backupDir,
      `backup not found: ${backupDir}`,
    );
  } else {
    const entries = await readdirOrThrowRollbackNotAvailable(
      backupRoot,
      `no backups found under ${backupRoot}`,
    );
    if (entries.length === 0) {
      throw new CmemmovError({
        code: 'ROLLBACK_NOT_AVAILABLE',
        hint: `no backups found under ${backupRoot}`,
      });
    }
    const sorted = [...entries].sort();
    const latest = sorted.at(-1);
    // sorted.length > 0 (entries.length > 0 above), so .at(-1) is defined.
    // The `?? ''` keeps the type narrow without changing runtime behavior.
    backupDir = join(backupRoot, latest ?? '');
  }

  // Reject empty/corrupted backup directories up-front so a caller never
  // silently "restores" nothing. AC5: no fallback to the next-most-recent.
  const backupContents = await readdirOrThrowRollbackNotAvailable(
    backupDir,
    `Backup at ${backupDir} appears empty or corrupted. Use --backup <path> to choose a different backup.`,
  );
  if (backupContents.length === 0) {
    throw new CmemmovError({
      code: 'ROLLBACK_NOT_AVAILABLE',
      hint: `Backup at ${backupDir} appears empty or corrupted. Use --backup <path> to choose a different backup.`,
    });
  }

  out.progress(`Restoring backup: ${backupDir}`);

  // Pre-validation pass: walk the backup once and prove every file is readable
  // BEFORE we delete any of the user's existing ~/.claude/ state. AC1's
  // "atomic where possible" intent — a permission error or partially missing
  // file mid-restore would otherwise leave the user with a half-deleted
  // ~/.claude/ and no way to recover except re-running rollback against a
  // different backup (which AC5 forbids without an explicit --backup flag).
  // `access()` catches ENOENT/EACCES on each backup file; truncated reads
  // surface during the actual restore but at least the catastrophic "missing
  // file" case is prevented from being half-applied.
  interface PlannedEntry {
    target: string;
    absPath: string;
    isDir: boolean;
  }
  const planned: PlannedEntry[] = [];
  let backupHasClaudeJson = false;
  for await (const entry of walkDir(backupDir)) {
    // .claude.json sits at the top level of the backup directory and must
    // restore to ~/.claude.json (the path returned by locateClaude), NOT
    // to ~/.claude/.claude.json. The walk's relPath equals the file name
    // exactly when the file is at the backup root, so an equality check is
    // sufficient (no separator membership check needed).
    const isAdjacentClaudeJson = entry.relPath === '.claude.json' && !entry.isDir;
    if (isAdjacentClaudeJson) backupHasClaudeJson = true;
    const target = isAdjacentClaudeJson
      ? loc.claudeJson
      : join(loc.claudeDir, entry.relPath);
    if (!entry.isDir) {
      try {
        await access(entry.absPath);
      } catch (err) {
        throw new CmemmovError({
          code: 'ROLLBACK_NOT_AVAILABLE',
          hint: `Backup file unreadable: ${entry.absPath}. Use --backup <path> to choose a different backup.`,
          cause: err,
        });
      }
    }
    planned.push({ target, absPath: entry.absPath, isDir: entry.isDir });
  }

  let gate: WriteGate;
  if (opts.dryRun === true) {
    gate = makeDryRunWriteGate();
    out.progress('Dry run — no files will be written.');
  } else {
    gate = makeLiveWriteGate((msg) => {
      out.warn(msg);
    });
  }

  // Clear existing claudeDir contents EXCEPT the backups/ subtree, so that
  // rollback never deletes the very backup we are restoring from (or any
  // sibling backups the user may want later).
  let claudeChildren: string[];
  try {
    claudeChildren = await readdir(loc.claudeDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      claudeChildren = [];
    } else {
      throw err;
    }
  }
  for (const child of claudeChildren) {
    if (child === 'backups') continue;
    await gate.remove(join(loc.claudeDir, child));
  }

  // If the backup does not contain .claude.json, remove the existing
  // ~/.claude.json so the post-rollback state matches the backup (rather
  // than leaving a stale .claude.json adjacent to a freshly-restored
  // ~/.claude/). AC1 ("restored over ~/.claude/ AND ~/.claude.json").
  if (!backupHasClaudeJson) {
    let claudeJsonExists = true;
    try {
      await stat(loc.claudeJson);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        claudeJsonExists = false;
      } else {
        throw err;
      }
    }
    if (claudeJsonExists) {
      await gate.remove(loc.claudeJson);
    }
  }

  let restoredCount = 0;
  for (const entry of planned) {
    if (entry.isDir) {
      // Directory entries themselves do not need to be created when the
      // first child write happens through gate.write — but we still record
      // an explicit mkdir to keep dry-run reporting honest.
      await gate.mkdir(entry.target, { recursive: true });
      continue;
    }
    const content = await readFile(entry.absPath);
    await gate.write(entry.target, content);
    restoredCount++;
  }

  out.progress(
    `Restored ${restoredCount.toString()} file(s) from ${backupDir}`,
  );

  const summaryParts: string[] = [];
  if (opts.dryRun === true) {
    summaryParts.push('Dry run — no files written.');
    summaryParts.push(`Would restore from: ${backupDir}.`);
    const ops = gate.recordedOps();
    const writeOpCount = ops.filter((op) => op.kind === 'write').length;
    summaryParts.push(
      `${writeOpCount.toString()} write op(s) recorded (${ops.length.toString()} total fs op(s)).`,
    );
  } else {
    summaryParts.push(`Rollback complete. Restored from: ${backupDir}.`);
    summaryParts.push(
      `Restored ${restoredCount.toString()} file(s).`,
    );
  }

  out.finish(summaryParts.join(' '), true);
}
