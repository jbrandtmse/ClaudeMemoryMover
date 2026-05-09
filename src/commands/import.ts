import { readFile, stat, readdir } from 'node:fs/promises';
import { dirname, join, normalize, sep } from 'node:path';
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
import { confirmCrossOsPath, confirmProjectPath } from '../ui/prompts.js';
import { CmemmovError } from '../core/error.js';
import {
  ALL_CATEGORIES,
  type ClaudeCategory,
  type ImportDecision,
  type ImportMode,
  type RemapDecision,
  type RemapDecisions,
} from '../core/decision-schema.js';
import { findMatchingDir, isCrossPlatformMigration, suggestRemap } from '../core/path-engine.js';

export interface ImportOpts {
  mode?: string;
  // Commander's `--no-integrity-check` produces `integrityCheck: false`
  // (defaulting to `true` when the flag is not set).
  integrityCheck?: boolean;
  dryRun?: boolean;
  silent?: boolean;
  json?: boolean;
  // Repeatable `--remap "source-prefix=target-prefix"` rules for scripted
  // cross-OS imports. Empty/undefined means interactive cross-OS mode.
  remap?: string[];
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
  const remap = (opts.remap ?? []).map((spec) => {
    const eqIdx = spec.indexOf('=');
    if (eqIdx < 1) {
      throw new CmemmovError({
        code: 'INTERNAL',
        hint: `Invalid --remap format: ${spec}. Use "source-prefix=target-prefix"`,
      });
    }
    return { lhs: spec.slice(0, eqIdx), rhs: spec.slice(eqIdx + 1) };
  });
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
    remap,
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

// True when `target` is the home dir itself or strictly beneath it on the
// current platform. Plain `startsWith(homedir)` would let `~maya2` slip past
// `~maya`; the separator boundary closes that sibling-prefix gap.
function isInsideHome(target: string, homedir: string): boolean {
  if (target === homedir) return true;
  return target.startsWith(homedir + sep);
}

async function resolveProjectsCrossOS(
  bundleProjects: { slug: string; originalPath: string }[],
  claudeDir: string,
  decision: ImportDecision,
  out: Output,
): Promise<{ remapDecisions: RemapDecisions; skippedSlugs: string[] }> {
  const targetPlatform = process.platform;
  // Normalize the home boundary so the traversal-guard comparison compares
  // apples to apples — `path.normalize` on Windows converts `/` to `\`, so
  // both sides of the check must agree on separators.
  const homedir = normalize(dirname(claudeDir));
  const remapDecisions: RemapDecisions = [];
  const skippedSlugs: string[] = [];

  // Silent + cross-OS + no --remap rules is unrecoverable: the prompt
  // would silently skip every project, leaving the user with an opaque
  // IMPORT_PARTIAL exit. Surface a clear PATH_REMAP_AMBIGUOUS instead so
  // scripted callers see exactly what's missing. (Bundles with zero
  // projects can still proceed — there's nothing to ask about.)
  if (
    decision.silent &&
    decision.remap.length === 0 &&
    bundleProjects.length > 0
  ) {
    throw new CmemmovError({
      code: 'PATH_REMAP_AMBIGUOUS',
      hint: '--remap rule(s) required in silent cross-OS mode',
    });
  }

  for (const project of bundleProjects) {
    // Scripted --remap mode: every project must match a rule, otherwise the
    // run is ambiguous and we exit 2 (PATH_REMAP_AMBIGUOUS) before any writes.
    if (decision.remap.length > 0) {
      const match = decision.remap.find(({ lhs }) => project.originalPath.startsWith(lhs));
      if (match === undefined) {
        throw new CmemmovError({
          code: 'PATH_REMAP_AMBIGUOUS',
          hint: `--remap rule needed for ${project.originalPath}`,
        });
      }
      const raw = match.rhs + project.originalPath.slice(match.lhs.length);
      const targetPath = normalize(raw);
      // Path-traversal guard: after collapsing `..` segments, the resolved
      // path must remain inside the user's home. Cross-OS imports often see
      // a mix of `/` and `\` separators, so the normalize+isInsideHome pair
      // is what catches `=/Users/maya/../../../etc` style attacks AND
      // sibling-home crossings like `~maya` → `~maya2`.
      if (!isInsideHome(targetPath, homedir)) {
        throw new CmemmovError({
          code: 'PATH_REMAP_AMBIGUOUS',
          hint: `Remapped path '${targetPath}' escapes target home directory`,
        });
      }
      out.progress(`✓ ${project.slug} → ${targetPath}`);
      remapDecisions.push({
        slug: project.slug,
        originalPath: project.originalPath,
        targetPath,
        outcome: 'auto-confirmed',
      });
      continue;
    }

    // Interactive cross-OS mode: try home-prefix substitution first, then
    // fall back to scanning local subdirs for a basename match.
    const suggestion =
      suggestRemap(project.originalPath, targetPlatform, homedir) ??
      (await gatherSuggestion(project.originalPath, claudeDir));

    const result = await confirmCrossOsPath({
      slug: project.slug,
      originalPath: project.originalPath,
      suggestion,
      silent: decision.silent,
    });

    if (result.action === 'skip') {
      out.progress(`⊘ skipped ${project.slug}`);
      skippedSlugs.push(project.slug);
      remapDecisions.push({
        slug: project.slug,
        originalPath: project.originalPath,
        targetPath: null,
        outcome: 'skipped',
      });
      continue;
    }

    const targetPath = normalize(result.path);
    if (!isInsideHome(targetPath, homedir)) {
      // Treat traversal-escaped path as unresolvable and surface a warning
      // so the user knows their typed path was rejected.
      out.warn(`Path '${result.path}' escapes target home — treating as skip`);
      skippedSlugs.push(project.slug);
      remapDecisions.push({
        slug: project.slug,
        originalPath: project.originalPath,
        targetPath: null,
        outcome: 'skipped',
      });
      continue;
    }

    const outcome: RemapDecision['outcome'] =
      result.action === 'accept' ? 'auto-confirmed' : 'overridden';
    out.progress(`✓ ${project.slug} → ${targetPath}`);
    remapDecisions.push({
      slug: project.slug,
      originalPath: project.originalPath,
      targetPath,
      outcome,
    });
  }

  return { remapDecisions, skippedSlugs };
}

async function applyGlobalCategories(
  bundle: import('../core/bundle-schema.js').Bundle,
  claudeDir: string,
  claudeJsonPath: string,
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
  if (g.claudeJson !== undefined) {
    // The writer derives the on-disk path as `${targetDir}.json`, which by
    // construction equals locateClaude().claudeJson — assert that invariant
    // so any future drift in the locator's path formula trips a clear error
    // here rather than silently writing to the wrong file.
    if (claudeJsonPath !== `${claudeDir}.json`) {
      throw new CmemmovError({
        code: 'INTERNAL',
        hint: `claudeJson path '${claudeJsonPath}' does not match expected '${claudeDir}.json'`,
      });
    }
    await applyCategory({
      category: 'claudeJson',
      mode: effectiveMode('claudeJson', decision),
      targetDir: claudeDir,
      data: g.claudeJson,
      gate,
    });
    out.progress('Applied claudeJson');
    count++;
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

  const { claudeDir, claudeJson: claudeJsonPath } = locateClaude();

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

  // AC #1: announce cross-OS migration BEFORE backup/resolve, so the user
  // sees it immediately and any subsequent error message has the proper
  // context. The exact wording is asserted by tests.
  const isCrossOS = isCrossPlatformMigration(bundle.sourcePlatform, process.platform);
  if (isCrossOS) {
    out.progress(
      `Export source: ${bundle.sourcePlatform}. Current platform: ${process.platform}. Path remapping required.`,
    );
  }

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

  let resolved: ResolvedProject[];
  let skippedSlugs: string[];
  let remapDecisions: RemapDecisions = [];

  if (isCrossOS) {
    const crossOsResult = await resolveProjectsCrossOS(
      bundle.projects,
      claudeDir,
      decision,
      out,
    );
    remapDecisions = crossOsResult.remapDecisions;
    skippedSlugs = crossOsResult.skippedSlugs;
    // applyProjectCategories writes per-slug; the confirmedPath is used for
    // summary display only, so rebuild ResolvedProject from non-skipped
    // remap decisions.
    resolved = crossOsResult.remapDecisions
      .filter(
        (d): d is RemapDecision & { targetPath: string } => d.targetPath !== null,
      )
      .map((d) => ({ slug: d.slug, confirmedPath: d.targetPath }));
  } else {
    const sameOsResult = await resolveProjects(
      bundle.projects,
      claudeDir,
      decision,
      out,
    );
    resolved = sameOsResult.resolved;
    skippedSlugs = sameOsResult.skippedSlugs;
  }

  const globalCount = await applyGlobalCategories(
    bundle,
    claudeDir,
    claudeJsonPath,
    gate,
    decision,
    out,
  );
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
  if (isCrossOS) {
    // AC #8: per-outcome counts for cross-OS imports. Same-OS imports omit
    // this line because all four outcome buckets are conceptually empty.
    const autoConfirmed = remapDecisions.filter((d) => d.outcome === 'auto-confirmed').length;
    const userConfirmed = remapDecisions.filter((d) => d.outcome === 'user-confirmed').length;
    const overridden = remapDecisions.filter((d) => d.outcome === 'overridden').length;
    const skipped = remapDecisions.filter((d) => d.outcome === 'skipped').length;
    summaryParts.push(
      `Remapped: ${autoConfirmed.toString()} auto / ${userConfirmed.toString()} user / ${overridden.toString()} override / ${skipped.toString()} skipped.`,
    );
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

  // AC #9: in JSON mode the result.summary object includes a `remappings`
  // array of every RemapDecision. Same-OS imports pass no extra payload so
  // the JSON shape stays a bare string for backward compatibility.
  if (isCrossOS) {
    out.finish(summaryParts.join(' '), true, { remappings: remapDecisions });
  } else {
    out.finish(summaryParts.join(' '), true);
  }
}
