import { readFile, stat, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import process from 'node:process';
import { locateClaude } from '../services/claude-locator.js';
import { parseBundle } from '../services/bundle-parser.js';
import { applyCategory } from '../services/claude-writer.js';
import { createBackup } from '../services/backup-service.js';
import {
  makeLiveWriteGate,
  makeDryRunWriteGate,
  type WriteGate,
} from '../services/write-gate.js';
import { Output } from '../ui/output.js';
import { confirmProjectPath } from '../ui/prompts.js';
import { CmemmovError } from '../core/error.js';
import {
  ALL_CATEGORIES,
  type ClaudeCategory,
  type ImportDecision,
  type ImportMode,
} from '../core/decision-schema.js';
import { findMatchingDir } from '../core/path-engine.js';

export interface ImportOpts {
  mode?: string;
  // Commander's `--no-integrity-check` produces `integrityCheck: false`
  // (defaulting to `true` when the flag is not set).
  integrityCheck?: boolean;
  dryRun?: boolean;
  silent?: boolean;
  json?: boolean;
}

function parseMode(spec: string): {
  mode: ImportMode;
  overwriteCategories: ClaudeCategory[];
} {
  if (spec === 'merge') return { mode: 'merge', overwriteCategories: [] };
  if (spec === 'overwrite') return { mode: 'overwrite', overwriteCategories: [] };
  const prefix = 'overwrite=';
  if (spec.startsWith(prefix)) {
    const catName = spec.slice(prefix.length) as ClaudeCategory;
    if (!ALL_CATEGORIES.includes(catName)) {
      throw new CmemmovError({
        code: 'INTERNAL',
        hint: `Unknown category in --mode: ${catName}`,
      });
    }
    return { mode: 'merge', overwriteCategories: [catName] };
  }
  throw new CmemmovError({
    code: 'INTERNAL',
    hint: `Invalid --mode value: ${spec}. Use merge, overwrite, or overwrite=<category>`,
  });
}

function buildDecision(bundlePath: string, opts: ImportOpts): ImportDecision {
  const { mode, overwriteCategories } = parseMode(opts.mode ?? 'merge');
  // Commander emits `integrityCheck: false` when `--no-integrity-check` is
  // passed; absent flag leaves it undefined, which means "do verify".
  return {
    bundlePath,
    categories: [...ALL_CATEGORIES],
    mode,
    overwriteCategories,
    dryRun: opts.dryRun === true,
    noIntegrityCheck: opts.integrityCheck === false,
    silent: opts.silent === true,
    json: opts.json === true,
  };
}

function effectiveMode(cat: ClaudeCategory, decision: ImportDecision): ImportMode {
  if (decision.mode === 'overwrite') return 'overwrite';
  return decision.overwriteCategories.includes(cat) ? 'overwrite' : 'merge';
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

// Derive the user's home directory from the located Claude dir to avoid
// pulling in os.homedir() (ESLint reserves that import for claude-locator.ts).
async function gatherSuggestion(
  originalPath: string,
  claudeDir: string,
): Promise<string | null> {
  const home = dirname(claudeDir);
  const parentDirs = [
    home,
    join(home, 'dev'),
    join(home, 'projects'),
    join(home, 'src'),
    join(home, 'code'),
    join(home, 'Documents'),
    join(home, 'Desktop'),
  ];

  const scanRoots: string[] = [];
  for (const dir of parentDirs) {
    let entries: { name: string; isDirectory: () => boolean }[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isDirectory()) scanRoots.push(join(dir, e.name));
    }
  }
  return findMatchingDir(originalPath, scanRoots);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Mirrors backup-service.ts naming so dry-run reporting can show the path that
// WOULD have been used without touching disk.
function projectedBackupPath(claudeDir: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const suffix = `${process.pid.toString()}-${randomBytes(4).toString('hex')}`;
  return join(claudeDir, 'backups', 'cmemmov', `${ts}-${suffix}`);
}

interface ResolvedProject {
  slug: string;
  // The path the user confirmed for this project. Recorded for the summary
  // only; applyCategory still keys per-project writes off `slug` so that the
  // on-disk directory under ~/.claude/projects/<slug>/ stays consistent.
  confirmedPath: string;
}

async function resolveProjects(
  bundleProjects: { slug: string; originalPath: string }[],
  claudeDir: string,
  decision: ImportDecision,
  out: Output,
): Promise<{ resolved: ResolvedProject[]; skippedSlugs: string[] }> {
  const resolved: ResolvedProject[] = [];
  const skippedSlugs: string[] = [];

  for (const project of bundleProjects) {
    const exists = await pathExists(project.originalPath);
    if (exists) {
      out.progress(`✓ ${project.slug} → ${project.originalPath}`);
      resolved.push({ slug: project.slug, confirmedPath: project.originalPath });
      continue;
    }

    const suggestion = await gatherSuggestion(project.originalPath, claudeDir);
    const result = await confirmProjectPath({
      slug: project.slug,
      originalPath: project.originalPath,
      suggestion,
      silent: decision.silent,
    });

    if (result.action === 'skip') {
      out.progress(`⊘ skipped ${project.slug}`);
      skippedSlugs.push(project.slug);
      continue;
    }
    out.progress(`✓ ${project.slug} → ${result.path}`);
    resolved.push({ slug: project.slug, confirmedPath: result.path });
  }

  return { resolved, skippedSlugs };
}

async function applyGlobalCategories(
  bundle: import('../core/bundle-schema.js').Bundle,
  claudeDir: string,
  gate: WriteGate,
  decision: ImportDecision,
  out: Output,
): Promise<number> {
  let count = 0;
  const g = bundle.global;

  if (g.memories !== undefined) {
    await applyCategory({
      category: 'globalMemory',
      mode: effectiveMode('globalMemory', decision),
      targetDir: claudeDir,
      data: g.memories,
      gate,
    });
    out.progress('Applied globalMemory');
    count++;
  }
  if (g.settings !== undefined) {
    await applyCategory({
      category: 'globalSettings',
      mode: effectiveMode('globalSettings', decision),
      targetDir: claudeDir,
      data: g.settings,
      gate,
    });
    out.progress('Applied globalSettings');
    count++;
  }
  if (g.claudeMd !== undefined) {
    await applyCategory({
      category: 'claudeMd',
      mode: effectiveMode('claudeMd', decision),
      targetDir: claudeDir,
      data: { content: g.claudeMd },
      gate,
    });
    out.progress('Applied claudeMd (global)');
    count++;
  }
  if (g.mcpConfig !== undefined) {
    await applyCategory({
      category: 'mcpConfig',
      mode: effectiveMode('mcpConfig', decision),
      targetDir: claudeDir,
      data: g.mcpConfig,
      gate,
    });
    out.progress('Applied mcpConfig');
    count++;
  }
  if (g.customCommands !== undefined) {
    await applyCategory({
      category: 'customCommands',
      mode: effectiveMode('customCommands', decision),
      targetDir: claudeDir,
      data: g.customCommands,
      gate,
    });
    out.progress('Applied customCommands');
    count++;
  }
  if (g.teams !== undefined && isRecord(g.teams)) {
    await applyCategory({
      category: 'teams',
      mode: effectiveMode('teams', decision),
      targetDir: claudeDir,
      data: g.teams,
      gate,
    });
    out.progress('Applied teams');
    count++;
  }
  if (g.plugins !== undefined) {
    await applyCategory({
      category: 'plugins',
      mode: effectiveMode('plugins', decision),
      targetDir: claudeDir,
      data: g.plugins,
      gate,
    });
    out.progress('Applied plugins');
    count++;
  }
  // bundle.global.claudeJson is preserved in the bundle schema (export-side
  // captures it) but the writer surface has no claudeJson category yet — see
  // deferred-work.md "claudeJson restore on import". Warn so users running a
  // round-trip on the same OS know ~/.claude.json is not being touched.
  if (g.claudeJson !== undefined) {
    out.warn('Bundle contains .claude.json content but import does not restore it yet (deferred). ~/.claude.json on this machine is unchanged.');
  }
  return count;
}

async function applyProjectCategories(
  bundle: import('../core/bundle-schema.js').Bundle,
  resolved: ResolvedProject[],
  claudeDir: string,
  gate: WriteGate,
  decision: ImportDecision,
  out: Output,
): Promise<number> {
  let count = 0;
  const resolvedSlugs = new Set(resolved.map((r) => r.slug));

  for (const project of bundle.projects) {
    if (!resolvedSlugs.has(project.slug)) continue;

    if (project.memories !== undefined && project.memories.length > 0) {
      await applyCategory({
        category: 'projectMemory',
        mode: effectiveMode('projectMemory', decision),
        targetDir: claudeDir,
        data: { slug: project.slug, files: project.memories },
        gate,
      });
      out.progress(`Applied projectMemory (${project.slug})`);
      count++;
    }
    if (project.settings !== undefined) {
      await applyCategory({
        category: 'projectSettings',
        mode: effectiveMode('projectSettings', decision),
        targetDir: claudeDir,
        data: { slug: project.slug, settings: project.settings },
        gate,
      });
      out.progress(`Applied projectSettings (${project.slug})`);
      count++;
    }
    if (project.claudeMd !== undefined) {
      await applyCategory({
        category: 'claudeMd',
        mode: effectiveMode('claudeMd', decision),
        targetDir: claudeDir,
        data: { content: project.claudeMd, slug: project.slug },
        gate,
      });
      out.progress(`Applied claudeMd (${project.slug})`);
      count++;
    }
    if (project.sessions !== undefined && project.sessions.length > 0) {
      await applyCategory({
        category: 'sessionHistory',
        mode: effectiveMode('sessionHistory', decision),
        targetDir: claudeDir,
        data: { slug: project.slug, files: project.sessions },
        gate,
      });
      out.progress(`Applied sessionHistory (${project.slug})`);
      count++;
    }
  }
  return count;
}

export async function run(bundlePath: string, opts: ImportOpts = {}): Promise<void> {
  const decision = buildDecision(bundlePath, opts);
  const out = new Output('import', { json: decision.json });

  const { claudeDir } = locateClaude();

  out.progress(`Reading bundle from ${decision.bundlePath}...`);
  const bytes = await readFile(decision.bundlePath);

  // Parse + checksum BEFORE backup so a corrupted bundle exits 2 with the
  // pre-existing ~/.claude/ untouched (NFR10, AC9).
  const bundle = parseBundle(bytes, {
    noIntegrityCheck: decision.noIntegrityCheck,
    warn: (msg) => {
      out.warn(msg);
    },
  });

  let gate: WriteGate;
  let backupPath: string | undefined;
  let projectedBackup: string | undefined;
  if (decision.dryRun) {
    gate = makeDryRunWriteGate();
    projectedBackup = projectedBackupPath(claudeDir);
    out.progress('Dry run — no files will be written.');
    out.progress(`Backup would be created at ${projectedBackup}`);
  } else {
    backupPath = await createBackup(claudeDir);
    out.progress(`Backup created at ${backupPath}`);
    gate = makeLiveWriteGate((msg) => {
      out.warn(msg);
    });
  }

  const { resolved, skippedSlugs } = await resolveProjects(
    bundle.projects,
    claudeDir,
    decision,
    out,
  );

  const globalCount = await applyGlobalCategories(bundle, claudeDir, gate, decision, out);
  const projectCount = await applyProjectCategories(
    bundle,
    resolved,
    claudeDir,
    gate,
    decision,
    out,
  );

  const totalApplied = globalCount + projectCount;
  const summaryParts: string[] = [];
  if (decision.dryRun) {
    summaryParts.push('Dry run — no files written.');
    summaryParts.push(
      `Would have applied ${totalApplied.toString()} categor${totalApplied === 1 ? 'y' : 'ies'} across ${resolved.length.toString()} project${resolved.length === 1 ? '' : 's'}.`,
    );
    const ops = gate.recordedOps();
    const writeOpCount = ops.filter((op) => op.kind === 'write').length;
    summaryParts.push(
      `${writeOpCount.toString()} write op(s) recorded (${ops.length.toString()} total fs op(s)).`,
    );
    if (projectedBackup !== undefined) {
      summaryParts.push(`Backup would be: ${projectedBackup}.`);
    }
  } else {
    summaryParts.push(
      `Imported ${totalApplied.toString()} categor${totalApplied === 1 ? 'y' : 'ies'} across ${resolved.length.toString()} project${resolved.length === 1 ? '' : 's'}.`,
    );
    if (backupPath !== undefined) {
      summaryParts.push(`Backup: ${backupPath}`);
    }
  }
  if (skippedSlugs.length > 0) {
    summaryParts.push(
      `Skipped ${skippedSlugs.length.toString()} project${skippedSlugs.length === 1 ? '' : 's'}: ${skippedSlugs.join(', ')}.`,
    );
  }

  if (skippedSlugs.length > 0) {
    // Emit the summary to stderr before throwing so the partial-success
    // outcome is visible. cli.ts owns the final error reporting + JSON blob.
    out.progress(summaryParts.join(' '));
    throw new CmemmovError({
      code: 'IMPORT_PARTIAL',
      hint: `Skipped: ${skippedSlugs.join(', ')}. Run cmemmov fix-paths to associate.`,
    });
  }

  out.finish(summaryParts.join(' '), true);
}
