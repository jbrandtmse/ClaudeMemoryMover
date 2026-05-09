// NFR3 verification: 500 MB session-history bundle export+import wall-clock budget.
// CI margin = 2× the NFR's 60s target → 120s budget per phase. The fixture is
// built at runtime by tests/fixtures/builders/large-sessions-builder.mjs and is
// gitignored — building it can take tens of seconds, which is acceptable since
// this whole describe block is gated behind CMEMMOV_RUN_LARGE_PERF=1 and only
// runs in the nightly + release-tag pipelines.
//
// Why describe.skipIf instead of it.skip(): AC7 bans OS-conditional skips;
// environment-variable gating for an opt-in heavy fixture is a different
// category and is the documented vitest idiom for runtime-conditional tests.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

const LARGE_PERF_ENABLED = process.env.CMEMMOV_RUN_LARGE_PERF === '1';
const LARGE_PERF_BUDGET_MS = 120_000;

let bundlePath: string;
let claudeDir: string;
let originalEnvDir: string | undefined;
let fixtureRoot: string;

describe.skipIf(!LARGE_PERF_ENABLED)(
  'large session-history perf — 500MB bundle (NFR3, CMEMMOV_RUN_LARGE_PERF=1)',
  () => {
    beforeAll(async () => {
      interface BuilderModule {
        buildLargeSessionsFixture: (opts?: { force?: boolean }) => Promise<string>;
      }
      const builder = (await import('../fixtures/builders/large-sessions-builder.mjs')) as BuilderModule;
      fixtureRoot = await builder.buildLargeSessionsFixture({ force: false });

      claudeDir = join(fixtureRoot, '.claude');
      bundlePath = join(fixtureRoot, 'large-sessions.cmemmov');

      originalEnvDir = process.env.CLAUDE_CONFIG_DIR;
      process.env.CLAUDE_CONFIG_DIR = claudeDir;
    }, LARGE_PERF_BUDGET_MS);

    afterAll(() => {
      if (originalEnvDir === undefined) {
        delete process.env.CLAUDE_CONFIG_DIR;
      } else {
        process.env.CLAUDE_CONFIG_DIR = originalEnvDir;
      }
      // Leave the fixture in place across test invocations — re-materializing
      // 500 MB on every run would dwarf the perf measurement itself. The
      // builder is idempotent and skips when the directory already exists.
    });

    it(
      `exports 500MB session bundle under ${LARGE_PERF_BUDGET_MS.toString()}ms`,
      async () => {
        const { run: exportRun } = await import('../../src/commands/export.js');

        const start = performance.now();
        await exportRun({
          silent: true,
          json: true,
          categories: 'globalSettings,sessionHistory',
          allProjects: true,
          includeSessions: true,
          output: bundlePath,
          includeCredentials: false,
        });
        const elapsed = performance.now() - start;

        console.log(
          `[large-perf] export(500MB sessions): ${elapsed.toFixed(0)} ms (budget ${LARGE_PERF_BUDGET_MS.toString()} ms)`,
        );
        expect(elapsed).toBeLessThan(LARGE_PERF_BUDGET_MS);
      },
      LARGE_PERF_BUDGET_MS + 30_000,
    );

    it(
      `imports 500MB session bundle under ${LARGE_PERF_BUDGET_MS.toString()}ms`,
      async () => {
        // The previous test produced bundlePath. Reset claudeDir to a clean
        // state so import has to actually write everything back out.
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
          `[large-perf] import(500MB sessions): ${elapsed.toFixed(0)} ms (budget ${LARGE_PERF_BUDGET_MS.toString()} ms)`,
        );
        expect(elapsed).toBeLessThan(LARGE_PERF_BUDGET_MS);
      },
      LARGE_PERF_BUDGET_MS + 30_000,
    );
  },
);
