import { readdir, stat } from 'node:fs/promises';
import { basename, dirname, join, posix, win32 } from 'node:path';
import { CmemmovError } from '../core/error.js';
import { findMatchingDir } from '../core/path-engine.js';
import { locateClaude } from '../services/claude-locator.js';
import { resolveOriginalPath } from '../services/claude-reader.js';
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

  if (opts.dryRun === true) {
    out.progress('[dry-run] No changes applied.');
  }

  const remapCount = decisions.filter((d) => d.action === 'remap').length;
  const summary = `${String(remapCount)} project(s) will be renamed.`;
  if (opts.json === true) {
    out.finish(summary, true, { projects: entries, remappings: decisions });
  } else {
    out.finish(summary);
  }
  // Story 3.3 will add the apply phase here (rename dirs + update .claude.json)
}
