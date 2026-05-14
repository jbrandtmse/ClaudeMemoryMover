// NFR2 verification: 20-project export + import wall-clock budget.
// CI margin = 2× the NFR's 10s target, so the budget here is 20s per phase.
// On under-provisioned CI runners the gzip + serialize step is the dominant
// cost; if this test ever flakes the right answer is to investigate the
// regression — NOT to widen the budget.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const PERF_BUDGET_MS = 20_000;
const NUM_PROJECTS = 20;
const MEMORY_FILES_PER_PROJECT = 3;

let tmpHome: string;
let claudeDir: string;
let bundlePath: string;
let originalEnvDir: string | undefined;

async function seedTwentyProjectTree(): Promise<void> {
  await mkdir(claudeDir, { recursive: true });
  await writeFile(
    join(claudeDir, 'settings.json'),
    JSON.stringify({ model: 'sonnet' }, null, 2),
    'utf8',
  );

  for (let p = 0; p < NUM_PROJECTS; p++) {
    // Real project path lives inside tmpHome so the import existence check
    // resolves true and silent-mode doesn't auto-skip the project.
    const realPath = join(tmpHome, `perf-project-${p.toString()}`);
    await mkdir(realPath, { recursive: true });

    const slug = realPath.replace(/[\\/:]/g, '-');
    const projDir = join(claudeDir, 'projects', slug);
    const memDir = join(projDir, 'memory');
    await mkdir(memDir, { recursive: true });
    await writeFile(
      join(projDir, 'settings.json'),
      JSON.stringify({ permissions: { allow: ['npm:*'] } }, null, 2),
      'utf8',
    );
    for (let m = 0; m < MEMORY_FILES_PER_PROJECT; m++) {
      await writeFile(
        join(memDir, `note-${m.toString()}.md`),
        `# Note ${m.toString()} for project ${p.toString()}\n\nSome content for the perf fixture.\n`,
        'utf8',
      );
    }
    // Minimum-viable session JSONL flat under slug dir so resolveOriginalPath
    // has cwd info — session JSONLs are not nested under sessions/ on disk.
    await writeFile(
      join(projDir, 'session.jsonl'),
      JSON.stringify({
        type: 'message',
        cwd: realPath,
        version: '2.1.133',
      }) + '\n',
      'utf8',
    );
  }

  await writeFile(
    join(tmpHome, '.claude.json'),
    JSON.stringify({ projects: {} }, null, 2),
    'utf8',
  );
}

beforeEach(async () => {
  tmpHome = await mkdtemp(join(tmpdir(), 'cmemmov-perf-'));
  claudeDir = join(tmpHome, '.claude');
  bundlePath = join(tmpHome, 'perf.cmemmov');

  await seedTwentyProjectTree();

  originalEnvDir = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = claudeDir;
});

afterEach(async () => {
  if (originalEnvDir === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR;
  } else {
    process.env.CLAUDE_CONFIG_DIR = originalEnvDir;
  }
  await rm(tmpHome, { recursive: true, force: true });
});

describe('export + import perf — 20 projects, no sessions (NFR2)', () => {
  const exportLabel = `completes export of ${NUM_PROJECTS.toString()}-project tree under ${PERF_BUDGET_MS.toString()}ms`;
  it(
    exportLabel,
    async () => {
      const { run: exportRun } = await import('../../src/commands/export.js');

      const start = performance.now();
      await exportRun({
        silent: true,
        json: true,
        categories: 'globalSettings,globalMemory,projectMemory,projectSettings,claudeMd',
        allProjects: true,
        output: bundlePath,
        includeCredentials: false,
      });
      const elapsed = performance.now() - start;

      console.log(
        `[perf] export(${NUM_PROJECTS.toString()} projects, no sessions): ${elapsed.toFixed(0)} ms (budget ${PERF_BUDGET_MS.toString()} ms)`,
      );
      expect(elapsed).toBeLessThan(PERF_BUDGET_MS);
    },
    PERF_BUDGET_MS + 30_000,
  );

  const importLabel = `completes import of ${NUM_PROJECTS.toString()}-project bundle under ${PERF_BUDGET_MS.toString()}ms`;
  it(
    importLabel,
    async () => {
      // Build the bundle first (out-of-band; not measured).
      const { run: exportRun } = await import('../../src/commands/export.js');
      await exportRun({
        silent: true,
        json: true,
        categories: 'globalSettings,globalMemory,projectMemory,projectSettings,claudeMd',
        allProjects: true,
        output: bundlePath,
        includeCredentials: false,
      });

      // Wipe ~/.claude/ so import re-creates it from the bundle and the
      // wall-clock cost reflects a fresh apply, not a no-op merge.
      await rm(claudeDir, { recursive: true, force: true });
      await mkdir(claudeDir, { recursive: true });

      const { run: importRun } = await import('../../src/commands/import.js');

      const start = performance.now();
      await importRun(bundlePath, {
        mode: 'overwrite',
        silent: true,
        json: true,
      });
      const elapsed = performance.now() - start;

      console.log(
        `[perf] import(${NUM_PROJECTS.toString()} projects, no sessions): ${elapsed.toFixed(0)} ms (budget ${PERF_BUDGET_MS.toString()} ms)`,
      );
      expect(elapsed).toBeLessThan(PERF_BUDGET_MS);
    },
    PERF_BUDGET_MS * 2 + 30_000,
  );
});
