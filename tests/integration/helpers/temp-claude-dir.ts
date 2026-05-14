import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToSlug } from '../../../src/core/path-engine.js';

export interface TempClaudeDir {
  // Source-OS-style fake home (e.g. "C:\\Users\\alice" or "/home/alice").
  // This string never exists on the real disk; it lives in bundle JSON as
  // `originalPath` and in session JSONL as `cwd`.
  homeDir: string;
  // Source-OS-style fake .claude path (homeDir + source-OS sep + ".claude").
  claudeDir: string;
  // Source-OS-style fake .claude.json path (homeDir + source-OS sep + ".claude.json").
  claudeJsonPath: string;
  // Source-OS-style fake project path (e.g. "C:\\Users\\alice\\projects\\my-app").
  projectRealPath: string;
  // Slug derived from projectRealPath via pathToSlug. This is the on-disk
  // directory name under {tmpRoot}/.claude/projects/.
  projectSlug: string;
  // Real tmpdir-rooted path that will hold the seeded ~/.claude/ tree on disk.
  // Set process.env.CLAUDE_CONFIG_DIR = join(tmpRoot, '.claude') to point the
  // locator at the seed.
  tmpRoot: string;
}

export interface SeedOpts {
  sourcePlatform: 'win32' | 'darwin' | 'linux';
  sourceUser: string;
  // Used inside settings.json permission rule paths so that cross-OS imports
  // can verify the rule's target-user prefix is rewritten correctly.
  targetUser: string;
}

interface SourceOsPaths {
  homeDir: string;
  claudeDir: string;
  claudeJsonPath: string;
  projectRealPath: string;
  globalPermissionsRule: string;
  projectPermissionWriteRule: string;
}

// Build source-OS path strings using literal templates. We deliberately do NOT
// use path.join here because that uses the real OS separator — which would
// produce mixed-separator garbage when the real OS differs from sourcePlatform.
function buildSourceOsPaths(opts: SeedOpts): SourceOsPaths {
  if (opts.sourcePlatform === 'win32') {
    const homeDir = `C:\\Users\\${opts.sourceUser}`;
    const claudeDir = `${homeDir}\\.claude`;
    const claudeJsonPath = `${homeDir}\\.claude.json`;
    const projectRealPath = `${homeDir}\\projects\\my-app`;
    return {
      homeDir,
      claudeDir,
      claudeJsonPath,
      projectRealPath,
      globalPermissionsRule: `Read(C:\\Users\\${opts.targetUser}\\projects\\**)`,
      projectPermissionWriteRule: `Write(C:\\Users\\${opts.sourceUser}\\projects\\my-app\\**)`,
    };
  }
  // POSIX-style platforms: darwin uses /Users/<user>, linux uses /home/<user>.
  const userRoot = opts.sourcePlatform === 'darwin' ? '/Users' : '/home';
  const homeDir = `${userRoot}/${opts.sourceUser}`;
  const claudeDir = `${homeDir}/.claude`;
  const claudeJsonPath = `${homeDir}/.claude.json`;
  const projectRealPath = `${homeDir}/projects/my-app`;
  return {
    homeDir,
    claudeDir,
    claudeJsonPath,
    projectRealPath,
    globalPermissionsRule: `Read(${userRoot}/${opts.targetUser}/projects/**)`,
    projectPermissionWriteRule: `Write(${homeDir}/projects/my-app/**)`,
  };
}

/**
 * Seed a fixture ~/.claude/ tree representative of `sourcePlatform`.
 *
 * The on-disk layout (under a real tmpdir) is:
 *   <tmpRoot>/.claude/
 *     settings.json                          { model: "sonnet", permissions: [...] }
 *     CLAUDE.md                              "# Global memory\n"
 *     memory/
 *       MEMORY.md                            "# Memory Index\n\n- [note](note.md) — a note\n"
 *       note.md                              "# note\n"
 *     projects/<projectSlug>/
 *       CLAUDE.md                            "# Project memory\n"
 *       settings.json                        { permissions: [...] }
 *       session-1.jsonl                      { type, cwd: <fake source path>, version }
 *   <tmpRoot>/.claude.json                   { lastSessionCwd, currentProject, recentProjects }
 *
 * Note: session JSONLs are written flat under the slug dir (not in sessions/).
 * This matches Claude Code's real on-disk layout as of the 2026-05-12 bug report.
 *
 * Caller is responsible for:
 *   - setting `process.env.CLAUDE_CONFIG_DIR = <tmpRoot>/.claude`
 *   - cleaning up `tmpRoot` via `rm(tmpRoot, { recursive: true, force: true })`
 */
export async function seedClaudeTree(opts: SeedOpts): Promise<TempClaudeDir> {
  const src = buildSourceOsPaths(opts);
  const tmpRoot = await mkdtemp(join(tmpdir(), 'cmemmov-crossos-'));

  // Real-disk layout under tmpRoot uses the runtime OS separator (correct).
  const realClaudeDir = join(tmpRoot, '.claude');
  const realClaudeJsonPath = join(tmpRoot, '.claude.json');

  const projectSlug = pathToSlug(src.projectRealPath);
  const realProjectDir = join(realClaudeDir, 'projects', projectSlug);
  const realJsonlPath = join(realProjectDir, 'session-1.jsonl');
  const realMemoryDir = join(realClaudeDir, 'memory');

  await mkdir(realProjectDir, { recursive: true });
  await mkdir(realMemoryDir, { recursive: true });

  // Project files — session JSONL written flat under the slug dir (real layout)
  await writeFile(
    realJsonlPath,
    JSON.stringify({ type: 'message', cwd: src.projectRealPath, version: '2.1.133' }) + '\n',
    'utf8',
  );
  await writeFile(join(realProjectDir, 'CLAUDE.md'), '# Project memory\n', 'utf8');
  await writeFile(
    join(realProjectDir, 'settings.json'),
    JSON.stringify(
      {
        permissions: [src.globalPermissionsRule, src.projectPermissionWriteRule],
      },
      null,
      2,
    ),
    'utf8',
  );

  // Global files
  await writeFile(
    join(realClaudeDir, 'settings.json'),
    JSON.stringify(
      {
        model: 'sonnet',
        permissions: [src.globalPermissionsRule],
      },
      null,
      2,
    ),
    'utf8',
  );
  await writeFile(join(realClaudeDir, 'CLAUDE.md'), '# Global memory\n', 'utf8');
  await writeFile(join(realMemoryDir, 'note.md'), '# note\n\nA note body.\n', 'utf8');
  await writeFile(
    join(realMemoryDir, 'MEMORY.md'),
    '# Memory Index\n\n- [note](note.md) — a note\n',
    'utf8',
  );

  // Adjacent ~/.claude.json — uses source-OS-style path strings so cross-OS
  // import sees fake foreign paths and rewrites them.
  await writeFile(
    realClaudeJsonPath,
    JSON.stringify(
      {
        lastSessionCwd: src.projectRealPath,
        currentProject: src.projectRealPath,
        recentProjects: [{ path: src.projectRealPath }],
      },
      null,
      2,
    ),
    'utf8',
  );

  return {
    homeDir: src.homeDir,
    claudeDir: src.claudeDir,
    claudeJsonPath: src.claudeJsonPath,
    projectRealPath: src.projectRealPath,
    projectSlug,
    tmpRoot,
  };
}
