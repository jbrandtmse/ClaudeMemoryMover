import { readdir, stat } from 'node:fs/promises';
import { basename, dirname, join, posix, win32 } from 'node:path';
import { CmemmovError } from '../core/error.js';
import { findMatchingDir, pathToSlug } from '../core/path-engine.js';
import { createBackup } from '../services/backup-service.js';
import { locateClaude } from '../services/claude-locator.js';
import { readSettingsFileStrict, resolveOriginalPath } from '../services/claude-reader.js';
import { applyCategory } from '../services/claude-writer.js';
import { makeDryRunWriteGate, makeLiveWriteGate } from '../services/write-gate.js';
import { Output } from '../ui/output.js';
import { promptRemapDecision } from '../ui/prompts.js';

export interface FixPathsOpts {
  silent?: boolean;
  json?: boolean;
  dryRun?: boolean;
  remap?: string[];
}

export interface ProjectInventoryEntry {
  slug: string;
  decodedPath: string;
  exists: boolean;
  source: 'sessionCwd' | 'slugDecode' | null;
}

export interface RemapDecision {
  slug: string;
  originalPath: string;
  targetPath: string | null;
  action: 'remap' | 'skip' | 'no-op';
}

export async function scanProjects(claudeDir: string): Promise<ProjectInventoryEntry[]> {
  const projectsDir = join(claudeDir, 'projects');

  let entries: Awaited<ReturnType<typeof readdir>>;
  try {
    entries = await readdir(projectsDir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }

  const inventory: ProjectInventoryEntry[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const slug = entry.name;
    const resolved = await resolveOriginalPath(slug, claudeDir);
    let exists: boolean;
    try {
      await stat(resolved.path);
      exists = true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        exists = false;
      } else {
        throw err;
      }
    }
    inventory.push({
      slug,
      decodedPath: resolved.path,
      exists,
      source: resolved.source,
    });
  }

  return inventory;
}

interface RemapSpec {
  lhs: string;
  rhs: string;
}

function parseRemapSpecs(specs: string[]): RemapSpec[] {
  return specs.map((spec) => {
    const eqIdx = spec.indexOf('=');
    // Reject malformed specs: missing `=`, empty lhs (`=foo`), or empty rhs
    // (`foo=`). An empty rhs would silently produce relative-path targets
    // (e.g., decodedPath `/old/proj` → targetPath `/proj`).
    if (eqIdx < 1 || eqIdx === spec.length - 1) {
      throw new CmemmovError({
        code: 'INTERNAL',
        hint: `Invalid --remap format: "${spec}". Use "source-prefix=target-prefix"`,
      });
    }
    return { lhs: spec.slice(0, eqIdx), rhs: spec.slice(eqIdx + 1) };
  });
}

function matchRemapSpec(decodedPath: string, specs: RemapSpec[]): RemapSpec | null {
  let match: RemapSpec | null = null;
  for (const spec of specs) {
    if (
      decodedPath === spec.lhs ||
      decodedPath.startsWith(spec.lhs + posix.sep) ||
      decodedPath.startsWith(spec.lhs + win32.sep)
    ) {
      if (match === null || spec.lhs.length > match.lhs.length) {
        match = spec;
      }
    }
  }
  return match;
}

async function buildSuggestion(decodedPath: string, claudeDir: string): Promise<string | null> {
  // Derive the user's home directory from the located Claude dir to avoid
  // pulling in os.homedir() (ESLint reserves that import for claude-locator.ts).
  const home = dirname(claudeDir);
  const projectName = basename(decodedPath);
  const parentRoots = [
    home,
    join(home, 'dev'),
    join(home, 'work'),
    join(home, 'projects'),
    join(home, 'src'),
  ];
  const candidatePaths: string[] = [];
  for (const root of parentRoots) {
    const candidate = join(root, projectName);
    try {
      const s = await stat(candidate);
      // Only directories are valid project roots — a regular file at
      // `<root>/<projectName>` would be a nonsensical remap target.
      if (s.isDirectory()) {
        candidatePaths.push(candidate);
      }
    } catch {
      // ENOENT or other stat failure → not a candidate
    }
  }
  return findMatchingDir(decodedPath, candidatePaths);
}

export async function collectRemapDecisions(
  missing: ProjectInventoryEntry[],
  opts: FixPathsOpts,
  claudeDir: string,
): Promise<RemapDecision[]> {
  const silent = opts.silent === true;
  // `--remap` specs are scripted-mode-only. Parse them only when we are going
  // to consult them (silent path); validating them in interactive mode would
  // abort the run with `INTERNAL` for a flag that the interactive path will
  // never read.
  const remapSpecs = silent ? parseRemapSpecs(opts.remap ?? []) : [];
  const decisions: RemapDecision[] = [];

  for (const entry of missing) {
    const { slug, decodedPath } = entry;

    if (silent) {
      const match = matchRemapSpec(decodedPath, remapSpecs);
      if (match === null) {
        throw new CmemmovError({
          code: 'PATH_REMAP_AMBIGUOUS',
          hint: `--remap rule needed for ${decodedPath}`,
        });
      }
      const suffix = decodedPath.slice(match.lhs.length);
      const targetPath = match.rhs + suffix;
      const action: RemapDecision['action'] = targetPath === decodedPath ? 'no-op' : 'remap';
      decisions.push({
        slug,
        originalPath: decodedPath,
        targetPath: action === 'no-op' ? null : targetPath,
        action,
      });
      continue;
    }

    const suggestion = await buildSuggestion(decodedPath, claudeDir);
    const result = await promptRemapDecision({
      slug,
      originalPath: decodedPath,
      suggestion,
    });

    if (result.action === 'skip') {
      decisions.push({ slug, originalPath: decodedPath, targetPath: null, action: 'skip' });
      continue;
    }

    const targetPath = result.path;
    const action: RemapDecision['action'] = targetPath === decodedPath ? 'no-op' : 'remap';
    decisions.push({
      slug,
      originalPath: decodedPath,
      targetPath: action === 'no-op' ? null : targetPath,
      action,
    });
  }

  return decisions;
}

export async function applyDecisions(
  decisions: RemapDecision[],
  claudeDir: string,
  opts: FixPathsOpts,
  out: Output,
): Promise<{ backupPath: string | null; warnings: string[] }> {
  const toRename = decisions.filter((d) => d.action === 'remap');

  if (toRename.length === 0) {
    return { backupPath: null, warnings: [] };
  }

  const gate =
    opts.dryRun === true
      ? makeDryRunWriteGate()
      : makeLiveWriteGate((msg) => {
          out.warn(msg);
        });

  // 1. Backup before any write (skip in dry-run — nothing will actually change)
  let backupPath: string | null = null;
  if (opts.dryRun !== true) {
    backupPath = await createBackup(claudeDir);
    out.progress(`Backup created: ${backupPath}`);
  }

  // 2. Pre-flight collision check — ALL slugs before ANY rename. A single
  // pass detects collisions up front so we never leave a half-renamed tree.
  // Two flavours of collision: (a) target slug already exists on disk, and
  // (b) two decisions in this batch resolve to the same target slug — both
  // would individually pass the on-disk check but the second rename would
  // fail mid-loop, leaving a half-renamed tree. Detect both up front.
  const projectsDir = join(claudeDir, 'projects');
  if (opts.dryRun !== true) {
    const seenTargets = new Map<string, string>(); // newSlug → originating decision slug
    for (const d of toRename) {
      if (d.targetPath === null) continue; // unreachable for action === 'remap'
      const newSlug = pathToSlug(d.targetPath);
      const prior = seenTargets.get(newSlug);
      if (prior !== undefined) {
        throw new CmemmovError({
          code: 'INTERNAL',
          hint: `two remap decisions both target slug ${newSlug} (${prior} and ${d.slug}); resolve manually before re-running`,
        });
      }
      seenTargets.set(newSlug, d.slug);

      const newSlugDir = join(projectsDir, newSlug);
      try {
        await stat(newSlugDir);
        // stat succeeded → target exists → collision
        throw new CmemmovError({
          code: 'INTERNAL',
          hint: `target slug ${newSlug} already exists; remove or merge manually before re-running, or run cmemmov rollback`,
        });
      } catch (err) {
        if (err instanceof CmemmovError) throw err;
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
        // ENOENT → no collision, continue
      }
    }
  }

  // 3. Pre-read .claude.json so a malformed file aborts BEFORE any rename.
  // `readSettingsFileStrict` distinguishes ENOENT (→ undefined) from malformed
  // JSON (→ 'malformed'). The legacy reader collapsed both to undefined which
  // would silently treat a corrupt-but-recoverable .claude.json as "missing"
  // and skip the remap — the user gets a misleading "not found" warning while
  // their real .claude.json continues to point at stale paths. Fail loudly on
  // malformed BEFORE any rename so we don't leave a half-renamed tree paired
  // with stale path fields the apply phase couldn't update.
  const claudeJsonPath = `${claudeDir}.json`;
  const existingClaudeJson = await readSettingsFileStrict(claudeJsonPath);
  if (existingClaudeJson === 'malformed') {
    throw new CmemmovError({
      code: 'INTERNAL',
      hint: `~/.claude.json is malformed; restore from backup ${backupPath ?? '(none — dry-run had no backup)'} or fix the JSON manually before re-running`,
    });
  }

  // 4. Rename project directories via gate (dry-run-aware, EXDEV-aware).
  const renameLabel = opts.dryRun === true ? '[dry-run] Would rename' : 'Renamed';
  for (const d of toRename) {
    if (d.targetPath === null) continue;
    const newSlug = pathToSlug(d.targetPath);
    const oldSlugDir = join(projectsDir, d.slug);
    const newSlugDir = join(projectsDir, newSlug);
    await gate.rename(oldSlugDir, newSlugDir);
    out.progress(`${renameLabel}: ${d.slug} → ${newSlug}`);
  }

  // 5. Update .claude.json (path-bearing fields remapped via applyCategory).
  const warnings: string[] = [];
  if (existingClaudeJson === undefined) {
    const msg =
      '`~/.claude.json` not found — directory renames completed but global state not updated.';
    out.warn(msg);
    warnings.push(msg);
  } else {
    await applyCategory({
      category: 'claudeJson',
      mode: 'overwrite',
      targetDir: claudeDir,
      data: existingClaudeJson,
      gate,
      remapDecisions: toRename.map((d) => ({
        originalPath: d.originalPath,
        targetPath: d.targetPath,
      })),
      warn: (msg) => {
        warnings.push(msg);
        out.warn(msg);
      },
      info: (msg) => {
        out.progress(msg);
      },
    });
  }

  // 6. Dry-run: emit what WOULD have happened (gate has recorded all ops).
  if (opts.dryRun === true) {
    out.progress('[dry-run] No changes applied. Operations that WOULD have occurred:');
    for (const op of gate.recordedOps()) {
      if (op.kind === 'rename') {
        out.progress(`  rename: ${op.from} → ${op.to}`);
      } else if (op.kind === 'write') {
        out.progress(`  write: ${op.path} (${String(op.bytes)} bytes)`);
      } else if (op.kind === 'mkdir') {
        out.progress(`  mkdir: ${op.path}`);
      } else {
        out.progress(`  remove: ${op.path}`);
      }
    }
  }

  return { backupPath, warnings };
}

export async function run(opts: FixPathsOpts = {}): Promise<void> {
  const out = new Output('fix-paths', { json: opts.json === true });
  const { claudeDir } = locateClaude();

  out.progress('Scanning ~/.claude/projects/...');
  const entries = await scanProjects(claudeDir);

  for (const entry of entries) {
    const status = entry.exists ? 'FOUND' : 'NOT FOUND';
    out.progress(`Scanned ${entry.slug}: ${entry.decodedPath} [${status}]`);
  }

  const missing = entries.filter((e) => !e.exists);

  if (entries.length === 0 || missing.length === 0) {
    if (opts.json === true) {
      out.finish('No projects need fixing.', true, { projects: entries });
    } else {
      out.finish('No projects need fixing.');
    }
    return;
  }

  // `--remap` is a scripted-mode flag; in interactive mode the prompt always
  // wins. Warn the user so they don't think their rules were applied.
  if (opts.silent !== true && (opts.remap?.length ?? 0) > 0) {
    out.warn('--remap is ignored in interactive mode; use --silent --remap for scripted runs.');
  }

  const decisions = await collectRemapDecisions(missing, opts, claudeDir);

  for (const d of decisions) {
    if (d.action === 'remap') {
      out.progress(`Remap: ${d.originalPath} → ${d.targetPath ?? ''}`);
    } else if (d.action === 'no-op') {
      out.progress(`No-op: ${d.originalPath} (path unchanged)`);
    } else {
      out.progress(`Skipped: ${d.originalPath}`);
    }
  }

  const { backupPath, warnings } = await applyDecisions(decisions, claudeDir, opts, out);

  const remapCount = decisions.filter((d) => d.action === 'remap').length;
  const skipCount = decisions.filter(
    (d) => d.action === 'skip' || d.action === 'no-op',
  ).length;
  const backupNote = opts.dryRun === true ? '[dry-run]' : (backupPath ?? 'none');
  const summary = `${String(remapCount)} project(s) renamed, ${String(skipCount)} skipped. Backup: ${backupNote}`;

  if (opts.json === true) {
    out.finish(summary, true, {
      projects: entries,
      remappings: decisions,
      backupPath,
      warnings,
    });
  } else {
    out.finish(summary);
  }
}
