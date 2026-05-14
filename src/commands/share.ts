import { writeFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import process from 'node:process';
import { locateClaude, getSourceHomedir } from '../services/claude-locator.js';
import { readClaudeSurface } from '../services/claude-reader.js';
import { serializeBundle } from '../services/bundle-serializer.js';
import { applySanitization } from '../core/sanitization-rules.js';
import { Output } from '../ui/output.js';
import { CmemmovError } from '../core/error.js';
import type { ClaudeCategory } from '../core/decision-schema.js';
import {
  buildBundle,
  detectClaudeVersion,
} from './export-selection.js';
import {
  composePatterns,
  defaultPersonalPatterns,
} from './share-patterns.js';
import {
  selectShareCategories,
  confirmShareWrite,
  promptOverridePatterns,
} from '../ui/prompts.js';
import type { Bundle } from '../core/bundle-schema.js';

export const SHARE_CATEGORIES: readonly ClaudeCategory[] = [
  'claudeMd',
  'customCommands',
  'mcpConfig',
  'globalSettings',
  'teams',
  'plugins',
] as const;

const SHARE_CATEGORIES_SET = new Set<string>(SHARE_CATEGORIES);

export interface ShareOpts {
  silent?: boolean;
  json?: boolean;
  dryRun?: boolean;
  categories?: string;
  output?: string;
  includeCredentials?: boolean;
  includePattern?: string[];
  excludePattern?: string[];
}

interface ShareDecision {
  categories: ClaudeCategory[];
  outputPath: string;
  silent: boolean;
  json: boolean;
  dryRun: boolean;
  personalPatterns: readonly RegExp[];
}

export function defaultShareOutputPath(): string {
  const date = new Date().toISOString().slice(0, 10);
  return join(process.cwd(), `team-baseline-${date}.cmemmov`);
}

export function parseShareCategories(raw: string): ClaudeCategory[] {
  const tokens = raw.split(',').map((t) => t.trim()).filter((t) => t.length > 0);
  if (tokens.length === 0) return [];

  const CATEGORY_ALIASES: Record<string, string> = {
    globalSettings: 'globalSettings',
    'global-settings': 'globalSettings',
    settings: 'globalSettings',
    claudeMd: 'claudeMd',
    'claude-md': 'claudeMd',
    mcpConfig: 'mcpConfig',
    'mcp-config': 'mcpConfig',
    mcp: 'mcpConfig',
    customCommands: 'customCommands',
    'custom-commands': 'customCommands',
    commands: 'customCommands',
    teams: 'teams',
    plugins: 'plugins',
  };

  const UNSUPPORTED_CATEGORIES = new Set([
    'sessionHistory',
    'session-history',
    'globalMemory',
    'global-memory',
    'projectMemory',
    'project-memory',
    'projectSettings',
    'project-settings',
    'claudeJson',
    'claude-json',
  ]);

  const seen = new Set<ClaudeCategory>();
  const result: ClaudeCategory[] = [];
  for (const token of tokens) {
    if (UNSUPPORTED_CATEGORIES.has(token)) {
      throw new CmemmovError({
        code: 'INTERNAL',
        hint: `${token} is not supported by share (out of scope for team bundles)`,
      });
    }
    const cat = CATEGORY_ALIASES[token];
    if (cat === undefined) {
      throw new CmemmovError({
        code: 'INTERNAL',
        hint: `unknown category: ${token}`,
      });
    }
    if (!SHARE_CATEGORIES_SET.has(cat)) {
      throw new CmemmovError({
        code: 'INTERNAL',
        hint: `${token} is not supported by share (out of scope for team bundles)`,
      });
    }
    const claudeCat = cat as ClaudeCategory;
    if (!seen.has(claudeCat)) {
      seen.add(claudeCat);
      result.push(claudeCat);
    }
  }
  return result;
}

export function buildShareDecision(opts: ShareOpts): ShareDecision {
  // NFR6: reject --include-credentials BEFORE any read
  if (opts.includeCredentials === true) {
    throw new CmemmovError({
      code: 'SHARE_INVALID_SOURCE',
      hint: '--include-credentials is not supported by share (NFR6); credentials are always excluded from team bundles',
    });
  }

  const silent = opts.silent === true;
  const json = opts.json === true;
  const dryRun = opts.dryRun === true;

  let categories: ClaudeCategory[];
  if (opts.categories !== undefined) {
    categories = parseShareCategories(opts.categories);
  } else if (silent) {
    throw new CmemmovError({
      code: 'INTERNAL',
      hint: '--categories required in silent mode',
    });
  } else {
    categories = [];
  }

  const personalPatterns = composePatterns(
    defaultPersonalPatterns(),
    opts.includePattern ?? [],
    opts.excludePattern ?? [],
  );

  return {
    categories,
    outputPath: opts.output ?? defaultShareOutputPath(),
    silent,
    json,
    dryRun,
    personalPatterns,
  };
}

function buildPreviewLines(bundle: Bundle): string[] {
  const lines: string[] = [];
  const wr = bundle.wasRedacted;
  if (wr === undefined) return lines;

  for (const filename of wr.personalMemoryFiles ?? []) {
    const parts = filename.split(posix.sep);
    const scope = parts.slice(0, -1).join(posix.sep);
    const name = parts[parts.length - 1] ?? filename;
    lines.push(`${scope}/${name} — matched personal-filename pattern`);
  }

  for (const rule of wr.homeDirPermissionRules ?? []) {
    lines.push(`home-directory absolute path — ${rule}`);
  }

  for (const server of wr.localMcpServers ?? []) {
    lines.push(`local MCP server — ${server}`);
  }

  for (const field of wr.claudeJsonFields ?? []) {
    lines.push(`claudeJson: user-identifying field — ${field}`);
  }

  return lines;
}

function countStrippedItems(bundle: Bundle): number {
  const wr = bundle.wasRedacted;
  if (wr === undefined) return 0;
  return (
    (wr.personalMemoryFiles?.length ?? 0) +
    (wr.homeDirPermissionRules?.length ?? 0) +
    (wr.localMcpServers?.length ?? 0) +
    (wr.claudeJsonFields?.length ?? 0)
  );
}

export async function run(opts: ShareOpts = {}): Promise<void> {
  const decision = buildShareDecision(opts);
  const out = new Output('share', { json: decision.json });

  out.progress(
    `Effective personal-filename patterns: ${decision.personalPatterns.map((p) => p.toString()).join(', ')}`,
  );

  const { claudeDir, claudeJson } = locateClaude();
  out.progress(`Reading Claude environment from ${claudeDir}...`);
  const surface = await readClaudeSurface(claudeDir, claudeJson);

  let categories = decision.categories;
  if (!decision.silent && categories.length === 0) {
    categories = await selectShareCategories({ silent: false, defaults: SHARE_CATEGORIES });
  }

  const claudeVersion = detectClaudeVersion(surface.projects);

  let personalPatterns = decision.personalPatterns;

  // Build → sanitize → preview → confirm loop.
  // The surface is NOT re-read across edit cycles.
  let confirmed = false;
  let sanitized!: Bundle;

  while (!confirmed) {
    const bundle = buildBundle({
      surface,
      categories,
      includeCredentials: false,
      selectedSlugs: [],
      projectOriginalPaths: new Map(),
      claudeVersion,
      credentialsContent: undefined,
      sourceHomedir: getSourceHomedir(),
      profile: 'team-baseline',
    });

    sanitized = applySanitization(bundle, 'strip-personal', { personalPatterns });

    if (decision.silent) {
      confirmed = true;
      break;
    }

    // Display preview in non-JSON mode
    const previewLines = buildPreviewLines(sanitized);
    if (!decision.json) {
      if (previewLines.length === 0) {
        out.progress(
          'No personal items detected by the strip-personal profile (only credentials and session history will be removed).',
        );
      } else {
        out.progress('Items that will be stripped by the strip-personal profile:');
        for (const line of previewLines) {
          out.progress(`  ${line}`);
        }
      }
    }

    const choice = await confirmShareWrite({ silent: decision.silent });

    if (choice === 'yes') {
      confirmed = true;
    } else if (choice === 'no') {
      throw new CmemmovError({ code: 'INTERNAL', hint: 'share cancelled by user' });
    } else {
      // 'edit' — re-prompt for pattern overrides, recompose from the decision's base patterns
      const overrides = await promptOverridePatterns();
      personalPatterns = composePatterns(decision.personalPatterns, overrides.includePattern, overrides.excludePattern);
    }
  }

  const bytes = serializeBundle(sanitized);
  const itemsStripped = countStrippedItems(sanitized);
  const warningLines: string[] = buildPreviewLines(sanitized);

  // Emit warnings so they appear in out.#warnings (captured in JSON output's top-level "warnings")
  for (const line of warningLines) {
    out.warn(line);
  }

  const summaryPrefix = decision.dryRun ? '[dry-run] ' : '';
  const summaryText = `${summaryPrefix}Shared ${categories.length.toString()} categor${categories.length === 1 ? 'y' : 'ies'} (${itemsStripped.toString()} items stripped, ${warningLines.length.toString()} warnings) to ${decision.outputPath} (${bytes.length.toString()} bytes)`;

  if (!decision.dryRun) {
    out.progress(`Writing bundle to ${decision.outputPath}...`);
    await writeFile(decision.outputPath, bytes);
  }

  // Extra JSON fields are spread into the "summary" object by Output.finish.
  // Match the AC6 documented shape: categoriesIncluded, outputPath, bundleBytes, itemsStripped, wasRedacted.
  const extraJson: Record<string, unknown> = {
    categoriesIncluded: categories,
    outputPath: decision.outputPath,
    bundleBytes: bytes.length,
    itemsStripped,
    wasRedacted: sanitized.wasRedacted ?? {},
  };

  if (decision.dryRun) {
    extraJson.dryRun = true;
  }

  out.finish(summaryText, true, extraJson);
}
