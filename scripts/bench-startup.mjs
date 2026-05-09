#!/usr/bin/env node
// Measures median wall-clock time for `node dist/cmemmov.js --help` over 10 runs.
// Fails with exit code 1 if median >= 500ms (NFR1).

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const distPath = join(__dirname, '..', 'dist', 'cmemmov.js');

if (!existsSync(distPath)) {
  console.error(`ERROR: dist/cmemmov.js not found at ${distPath}. Run 'npm run build' first.`);
  process.exit(1);
}

const RUNS = 10;
const BUDGET_MS = 500;
const times = [];

for (let i = 0; i < RUNS; i++) {
  const start = performance.now();
  const result = spawnSync(process.execPath, [distPath, '--help'], {
    encoding: 'utf8',
    timeout: 5000,
  });
  const elapsed = performance.now() - start;
  if (result.error) {
    console.error(`Run ${i + 1} spawn error: ${result.error.message}`);
    process.exit(1);
  }
  // status === null AND a signal => process was killed (most commonly by the
  // 5000 ms timeout above). Treating that as a passing sample would silently
  // mask any regression that always exceeds the timeout, so fail loudly.
  if (result.status === null) {
    const sig = result.signal ?? 'unknown';
    console.error(`Run ${i + 1} terminated by signal ${sig} (likely timeout); aborting benchmark`);
    if (result.stderr) console.error(result.stderr);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`Run ${i + 1} failed with exit code ${result.status}`);
    if (result.stderr) console.error(result.stderr);
    process.exit(1);
  }
  times.push(elapsed);
}

times.sort((a, b) => a - b);
// Statistical median: average the two middle values for an even-length sample;
// for odd-length, take the single middle. Avoids the off-by-one bias of the
// naive `times[Math.floor(N/2)]` form.
const median =
  RUNS % 2 === 0
    ? (times[RUNS / 2 - 1] + times[RUNS / 2]) / 2
    : times[(RUNS - 1) / 2];

console.log(`Platform: ${process.platform}  Node: ${process.version}`);
console.log(`Startup times (ms): ${times.map((t) => t.toFixed(1)).join(', ')}`);
console.log(`Median: ${median.toFixed(1)} ms  Budget: ${BUDGET_MS} ms`);

if (median >= BUDGET_MS) {
  console.error(`FAIL: median startup ${median.toFixed(1)} ms exceeds ${BUDGET_MS} ms budget (NFR1)`);
  process.exit(1);
}

console.log(`PASS: median startup ${median.toFixed(1)} ms is within ${BUDGET_MS} ms budget`);
