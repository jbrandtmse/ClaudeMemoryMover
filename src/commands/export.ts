import { writeFile } from 'node:fs/promises';
import { locateClaude, getSourceHomedir } from '../services/claude-locator.js';
import {
  readClaudeSurface,
  readClaudeJsonFile,
  resolveOriginalPath,
  type ClaudeSurface,
  type OriginalPathResult,
} from '../services/claude-reader.js';
import { serializeBundle } from '../services/bundle-serializer.js';
import { applySanitization } from '../core/sanitization-rules.js';
import { Output } from '../ui/output.js';
import {
  selectCategories,
  selectProjects,
  confirmCredentials,
  promptOriginalPath,
  type ProjectOption,
} from '../ui/prompts.js';
import { CmemmovError } from '../core/error.js';
import {
  type ClaudeCategory,
  type ExportDecision,
  FLAG_NAMES,
} from '../core/decision-schema.js';
import {
  parseCategories,
  detectClaudeVersion,
  defaultOutputPath,
  buildBundle,
} from './export-selection.js';

export interface ExportOpts {
  silent?: boolean;
  json?: boolean;
  dryRun?: boolean;
  categories?: string;
  output?: string;
  includeCredentials?: boolean;
  includeSessions?: boolean;
  allProjects?: boolean;
  projects?: string;
  projectPath?: Record<string, string>;
}

function buildDecision(opts: ExportOpts): ExportDecision {
  const silent = opts.silent === true;
  const json = opts.json === true;
  const includeCredentials = opts.includeCredentials === true;
  const allProjects = opts.allProjects === true;

  let categories: ClaudeCategory[];
  if (opts.categories !== undefined) {
    categories = parseCategories(opts.categories);
  } else if (silent) {
    throw new CmemmovError({
      code: 'INTERNAL',
      hint: `${FLAG_NAMES.categories} required in silent mode`,
    });
  } else {
    categories = [];
  }

  const rawProjects =
    opts.projects !== undefined
      ? opts.projects.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
      : [];
  // Dedupe project slugs; commander accepts `--projects a,a` and the user
  // expects one entry per slug.
  const projects = [...new Set(rawProjects)];

  return {
    categories,
    includeCredentials,
    outputPath: opts.output ?? defaultOutputPath(),
    silent,
    json,
    allProjects,
    projects,
    projectPaths: opts.projectPath ?? {},
  };
}

async function chooseCategories(
  decision: ExportDecision,
  out: Output,
): Promise<ClaudeCategory[]> {
  if (decision.silent) {
    return decision.categories;
  }
  if (decision.categories.length > 0) {
    return decision.categories;
  }
  out.progress('Select categories to include in the export.');
  const interactive = await selectCategories({ silent: false });
  return interactive;
}

function validateProjectSlugs(requested: string[], known: Set<string>): void {
  const unknown = requested.filter((s) => s !== 'all' && !known.has(s));
  if (unknown.length > 0) {
    throw new CmemmovError({
      code: 'INTERNAL',
      hint: `unknown project slug${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}`,
    });
  }
}

async function chooseProjects(
  decision: ExportDecision,
  surface: ClaudeSurface,
  pathResults: Map<string, OriginalPathResult>,
  out: Output,
): Promise<string[]> {
  const allSlugs = surface.projects.map((p) => p.slug);
  const knownSlugs = new Set(allSlugs);

  if (decision.allProjects) {
    if (decision.projects.length > 0) {
      out.warn(`${FLAG_NAMES.projects} ignored because ${FLAG_NAMES.allProjects} was passed`);
    }
    return allSlugs;
  }

  if (decision.silent) {
    if (decision.projects.length === 0 || decision.projects.includes('all')) {
      return allSlugs;
    }
    validateProjectSlugs(decision.projects, knownSlugs);
    return decision.projects;
  }

  if (decision.projects.length > 0) {
    if (decision.projects.includes('all')) return allSlugs;
    validateProjectSlugs(decision.projects, knownSlugs);
    return decision.projects;
  }

  if (allSlugs.length === 0) return [];

  out.progress('Select projects to include.');
  const options: ProjectOption[] = surface.projects.map((p) => {
    const result = pathResults.get(p.slug);
    let label: string;
    if ((result?.source ?? null) === null) {
      label = `${p.slug}  (path unknown)`;
    } else if (result?.source === 'slugDecode') {
      label = `${result.path}  (best-effort — no sessions)`;
    } else if (result !== undefined) {
      label = result.path;
    } else {
      label = p.slug;
    }
    return { slug: p.slug, label };
  });

  return selectProjects({ options });
}

async function resolveProjectPaths(
  selectedSlugs: string[],
  pathResults: Map<string, OriginalPathResult>,
  decision: ExportDecision,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const slug of selectedSlugs) {
    const result = pathResults.get(slug);
    const override = decision.projectPaths[slug];

    // Explicit `--project-path slug=...` always wins, regardless of source —
    // the user is asserting the path. An empty value is rejected so silent
    // mode cannot smuggle through a zero-length originalPath.
    if (override !== undefined) {
      if (override.length === 0) {
        throw new CmemmovError({
          code: 'PATH_REMAP_AMBIGUOUS',
          hint: `${FLAG_NAMES.projectPath} value for ${slug} must not be empty`,
        });
      }
      out.set(slug, override);
      continue;
    }

    const source = result?.source ?? null;
    if (source !== 'sessionCwd') {
      const suggestedPath = result?.path ?? slug;
      const confirmed = await promptOriginalPath({
        slug,
        suggestedPath,
        silent: decision.silent,
      });
      out.set(slug, confirmed);
      continue;
    }

    out.set(slug, result?.path ?? slug);
  }
  return out;
}

async function readCredentialsContent(
  surface: ClaudeSurface,
  includeCredentials: boolean,
): Promise<unknown> {
  if (!includeCredentials || surface.credentialsRef === undefined) return undefined;
  return readClaudeJsonFile(surface.credentialsRef);
}

export async function run(opts: ExportOpts = {}): Promise<void> {
  const decision = buildDecision(opts);
  const out = new Output('export', { json: decision.json });

  const { claudeDir, claudeJson } = locateClaude();
  out.progress(`Reading Claude environment from ${claudeDir}...`);
  const surface = await readClaudeSurface(claudeDir, claudeJson);

  const pathResults = new Map<string, OriginalPathResult>();
  for (const proj of surface.projects) {
    pathResults.set(proj.slug, await resolveOriginalPath(proj.slug, claudeDir));
  }

  const categories = await chooseCategories(decision, out);

  if (categories.length === 0) {
    throw new CmemmovError({
      code: 'EXPORT_NOTHING_SELECTED',
      hint: 'select at least one category to export',
    });
  }

  const finalCategories =
    opts.includeSessions === true && !categories.includes('sessionHistory')
      ? [...categories, 'sessionHistory' as ClaudeCategory]
      : categories;

  const selectedSlugs = await chooseProjects(decision, surface, pathResults, out);
  const projectOriginalPaths = await resolveProjectPaths(selectedSlugs, pathResults, decision);

  let includeCredentials = decision.includeCredentials;
  if (!decision.silent && opts.includeCredentials === undefined) {
    includeCredentials = await confirmCredentials({ silent: false });
  }

  if (includeCredentials) {
    out.warn(
      'Credentials will be included in the bundle. Do not commit or share this file publicly.',
    );
    if (surface.credentialsRef === undefined) {
      out.warn('No credentials file was found in the Claude directory; bundle credentials field will be empty.');
    }
  }

  const credentialsContent = await readCredentialsContent(surface, includeCredentials);

  out.progress(`Building bundle (${finalCategories.length.toString()} categories, ${selectedSlugs.length.toString()} projects)...`);
  const claudeVersion = detectClaudeVersion(surface.projects);

  let bundle = buildBundle({
    surface,
    categories: finalCategories,
    includeCredentials,
    selectedSlugs,
    projectOriginalPaths,
    claudeVersion,
    credentialsContent,
    sourceHomedir: getSourceHomedir(),
  });

  if (!includeCredentials) {
    bundle = applySanitization(bundle, 'redact-credentials');
  }

  out.progress('Serializing bundle...');
  const bytes = serializeBundle(bundle);

  out.progress(`Writing bundle to ${decision.outputPath}...`);
  await writeFile(decision.outputPath, bytes);

  const summary = `Exported ${finalCategories.length.toString()} categor${finalCategories.length === 1 ? 'y' : 'ies'} from ${selectedSlugs.length.toString()} project${selectedSlugs.length === 1 ? '' : 's'} to ${decision.outputPath} (${bytes.length.toString()} bytes)`;
  out.finish(summary, true);
}
