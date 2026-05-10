import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { locateClaude } from '../services/claude-locator.js';
import { resolveOriginalPath } from '../services/claude-reader.js';
import { Output } from '../ui/output.js';

export interface FixPathsOpts {
  silent?: boolean;
  json?: boolean;
  dryRun?: boolean;
}

export interface ProjectInventoryEntry {
  slug: string;
  decodedPath: string;
  exists: boolean;
  source: 'sessionCwd' | 'slugDecode' | null;
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

  const summary = `${String(missing.length)} project(s) need path repair.`;
  if (opts.json === true) {
    out.finish(summary, true, { projects: entries });
  } else {
    out.finish(summary);
  }
}
