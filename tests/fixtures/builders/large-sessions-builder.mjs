// Materializes a synthetic ~/.claude/ tree under tests/fixtures/large-bundles/sessions-500mb/
// containing JSONL session files totaling ~500 MB.
//
// NOT committed to git (.gitignore excludes tests/fixtures/large-bundles/).
// Called by tests/integration/large-perf.test.ts before running the perf test.

import { existsSync } from 'node:fs';
import { mkdir, stat, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const FIXTURE_ROOT = join(__dirname, '..', 'large-bundles', 'sessions-500mb');

const TARGET_BYTES = 500 * 1024 * 1024;
const NUM_PROJECTS = 5;
const SESSIONS_PER_PROJECT = 4;
const LINE_BYTES = 1024;
const LINES_PER_SESSION = Math.ceil(
  TARGET_BYTES / NUM_PROJECTS / SESSIONS_PER_PROJECT / LINE_BYTES,
);

function makeJsonlLine(idx) {
  const payload = {
    type: 'message',
    role: idx % 2 === 0 ? 'user' : 'assistant',
    timestamp: new Date(2026, 0, 1, 0, 0, idx % 60).toISOString(),
    version: '2.1.133',
    content: 'x'.repeat(LINE_BYTES - 200),
    seq: idx,
  };
  let line = JSON.stringify(payload);
  if (line.length < LINE_BYTES - 1) {
    line += ' '.repeat(LINE_BYTES - 1 - line.length);
  }
  return line + '\n';
}

async function buildSessionFile(filePath, lines) {
  const chunks = [];
  for (let i = 0; i < lines; i++) {
    chunks.push(makeJsonlLine(i));
  }
  await writeFile(filePath, chunks.join(''), 'utf8');
}

export async function buildLargeSessionsFixture({ force = false } = {}) {
  if (existsSync(FIXTURE_ROOT)) {
    if (force) {
      await rm(FIXTURE_ROOT, { recursive: true, force: true });
    } else {
      try {
        const s = await stat(FIXTURE_ROOT);
        if (s.isDirectory()) {
          return FIXTURE_ROOT;
        }
      } catch {
        // fall through to rebuild
      }
    }
  }

  const claudeDir = join(FIXTURE_ROOT, '.claude');
  const projectsRoot = join(claudeDir, 'projects');
  await mkdir(projectsRoot, { recursive: true });

  await writeFile(
    join(claudeDir, 'settings.json'),
    JSON.stringify({ model: 'sonnet' }, null, 2),
    'utf8',
  );

  for (let p = 0; p < NUM_PROJECTS; p++) {
    // Real project path lives inside FIXTURE_ROOT so import's existence check
    // resolves true and silent-mode doesn't auto-skip the project on apply.
    const realPath = join(FIXTURE_ROOT, `large-project-${p}`);
    await mkdir(realPath, { recursive: true });

    const slug = realPath.replace(/[\\/:]/g, '-');
    const projDir = join(projectsRoot, slug);
    const sessionsSubdir = join(projDir, 'sessions');
    await mkdir(sessionsSubdir, { recursive: true });

    // Tiny session.jsonl with cwd so resolveOriginalPath returns realPath.
    await writeFile(
      join(sessionsSubdir, 'cwd.jsonl'),
      JSON.stringify({ type: 'message', cwd: realPath, version: '2.1.133' }) + '\n',
      'utf8',
    );
    for (let s = 0; s < SESSIONS_PER_PROJECT; s++) {
      const sessionFile = join(sessionsSubdir, `session-${s}.jsonl`);
      await buildSessionFile(sessionFile, LINES_PER_SESSION);
    }
  }

  await writeFile(
    join(FIXTURE_ROOT, '.claude.json'),
    JSON.stringify({ projects: {} }, null, 2),
    'utf8',
  );

  return FIXTURE_ROOT;
}

export const LARGE_FIXTURE_ROOT = FIXTURE_ROOT;

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  const force = process.argv.includes('--force');
  const root = await buildLargeSessionsFixture({ force });
  console.log(`Materialized large fixture at: ${root}`);
}
