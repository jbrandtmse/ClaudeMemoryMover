import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToSlug } from '../../../src/core/path-engine.js';

export interface SeedShareSourceOpts {
  sourcePlatform: 'win32' | 'darwin' | 'linux';
  // When false, the credentials file is NOT created (opt-in for NFR6 negative tests).
  credentials?: boolean;
}

export interface ShareSourceTempClaudeDir {
  // Real tmpdir root containing the seeded tree on disk.
  tmpRoot: string;
  // Source-OS-style fake home dir string (LITERAL, not on-disk).
  sourceHomedir: string;
}

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

/**
 * Seed a share-specific source tree for integration tests.
 *
 * Path strategy: all "home-dir-absolute" paths use the real tmpRoot as the
 * fake home, so sanitization can match them against the mocked sourceHomedir.
 * Network MCP command strings use LITERAL source-OS forms (not path.join)
 * because they must NOT be on disk and must survive the network-path check.
 *
 * On-disk layout:
 *   <tmpRoot>/.claude/
 *     .credentials.json          (unless opts.credentials === false)
 *     CLAUDE.md                  "# Global memory\n"
 *     settings.json              { permissions: [...], mcpServers: {...} }
 *     memory/
 *       personal_notes.md        (PERSONAL — matched by /^personal/i pattern)
 *       team-conventions.md      (TEAM — must survive share)
 *     commands/
 *       team-cmd.md
 *   <tmpRoot>/.claude.json       { theme, email, machineId, recentProjects, ... }
 *
 * Callers must:
 *   1. Set `homedirState.value = result.sourceHomedir` before calling shareRun
 *   2. Set `process.env.CLAUDE_CONFIG_DIR = join(result.tmpRoot, '.claude')`
 *   3. Clean up `result.tmpRoot` in afterEach
 */
export async function seedShareSourceTree(
  opts: SeedShareSourceOpts,
): Promise<ShareSourceTempClaudeDir> {
  const includeCredentials = opts.credentials !== false;
  const platform = opts.sourcePlatform;

  const tmpRoot = await mkdtemp(join(tmpdir(), 'cmemmov-share-src-'));
  const realClaudeDir = join(tmpRoot, '.claude');
  const realClaudeJsonPath = join(tmpRoot, '.claude.json');
  const realMemoryDir = join(realClaudeDir, 'memory');
  const realCommandsDir = join(realClaudeDir, 'commands');

  await mkdir(realClaudeDir, { recursive: true });
  await mkdir(realMemoryDir, { recursive: true });
  await mkdir(realCommandsDir, { recursive: true });

  // Build source-OS-style path strings using LITERAL templates matching
  // sourcePlatform conventions. Do NOT use path.join — it uses the runtime
  // OS separator, which would produce wrong separators when platform differs.
  //
  // For the home-dir and local-MCP paths, we need them to be treated as
  // "absolute paths under sourceHomedir" by the sanitization code, which
  // checks isAbsolutePath(arg, sourcePlatform). The simplest correct approach:
  // use the real on-disk tmpRoot for the runtime platform, and LITERAL fake
  // paths for cross-platform scenarios (when sourcePlatform !== process.platform).
  //
  // When mockPlatform(platform) is active, process.platform === platform, so
  // bundle.sourcePlatform === platform. The sanitization's isAbsolutePath() and
  // pathStartsWith() both use bundle.sourcePlatform — so fake paths in the
  // literal style of sourcePlatform will be correctly identified.
  let sourceHomedir: string;
  let localMcpCommand: string;
  let homeDirAbsoluteRule: string;
  let networkMcpCommand: string;
  let networkPermissionRule: string;
  let recentProjectPath: string;

  if (platform === 'win32') {
    // Use the real on-disk tmpRoot converted to win32 separator style.
    // When mockPlatform('win32') is active on a posix runner, tmpRoot uses /
    // which after replace becomes \\ — still a valid-looking win32 path with
    // a drive letter from the real tmpdir prefix.
    const winRoot = tmpRoot.replace(/\//g, '\\');
    // If the path doesn't start with a drive letter (e.g. on Linux runner),
    // fall back to a fake win32 home so isAbsolutePath('C:\\...', 'win32') works.
    const hasDrive = /^[a-zA-Z]:/.test(winRoot);
    const effectiveRoot = hasDrive ? winRoot : `C:\\FakeHome\\testuser`;
    sourceHomedir = effectiveRoot;
    localMcpCommand = `${effectiveRoot}\\agents\\local-tool.js`;
    homeDirAbsoluteRule = `Read(${effectiveRoot}\\agents\\**)`;
    networkMcpCommand = `\\\\internal\\toolserver\\bin\\server.exe`;
    networkPermissionRule = 'Read(\\\\internal\\toolserver\\**)';
    recentProjectPath = `${effectiveRoot}\\projects\\my-app`;
  } else {
    // posix (linux/darwin). Use the real on-disk tmpRoot with backslashes
    // converted to forward slashes.
    const posixRoot = tmpRoot.replace(/\\/g, '/');
    // If the path doesn't start with / (e.g. on Windows runner where tmpdir
    // starts with a drive letter like C:/...), use a fake posix home so that
    // isAbsolutePath('/home/...', 'linux') correctly identifies it as absolute.
    const isAbsolutePosix = posixRoot.startsWith('/');
    const effectiveRoot = isAbsolutePosix ? posixRoot : `/home/testuser/share-test`;
    sourceHomedir = effectiveRoot;
    localMcpCommand = `${effectiveRoot}/agents/local-tool.js`;
    homeDirAbsoluteRule = `Read(${effectiveRoot}/agents/**)`;
    networkMcpCommand = `//internal/toolserver/bin/server`;
    networkPermissionRule = 'Read(//internal/toolserver/**)';
    recentProjectPath = `${effectiveRoot}/projects/my-app`;
  }

  const relativeRule = 'Read(./local-thing)';
  const bashRule = 'Bash(git status)';

  // Credentials file (toggled by opts.credentials — default true)
  if (includeCredentials) {
    await writeFile(
      join(realClaudeDir, '.credentials.json'),
      JSON.stringify({ oauthToken: 'secret-test-token-EYES-ONLY' }, null, 2),
      'utf8',
    );
  }

  // Global CLAUDE.md
  await writeFile(join(realClaudeDir, 'CLAUDE.md'), '# Global memory\n', 'utf8');

  // Memory files: personal (should be stripped) and team (should be preserved)
  await writeFile(
    join(realMemoryDir, 'personal_notes.md'),
    '# Personal\n\nLocal-only notes that should NEVER ship.\n',
    'utf8',
  );
  await writeFile(
    join(realMemoryDir, 'team-conventions.md'),
    '# Team conventions\n\nThese SHOULD ship.\n',
    'utf8',
  );

  // Custom command
  await writeFile(
    join(realCommandsDir, 'team-cmd.md'),
    '# /team-cmd\n\nTeam-relevant slash command.\n',
    'utf8',
  );

  const mcpServers: Record<string, unknown> = {
    'fileserver-local': { command: localMcpCommand },
    'internal-toolserver': { command: networkMcpCommand },
    'bare-program': { command: 'npx', args: ['-y', '@modelcontextprotocol/server-X'] },
  };

  await writeFile(
    join(realClaudeDir, 'settings.json'),
    JSON.stringify(
      {
        permissions: [homeDirAbsoluteRule, relativeRule, networkPermissionRule, bashRule],
        mcpServers,
      },
      null,
      2,
    ),
    'utf8',
  );

  // .claude.json with allowlist + deny fields
  await writeFile(
    realClaudeJsonPath,
    JSON.stringify(
      {
        theme: 'dark',
        email: 'alice@example.com',
        machineId: 'fake-machine-uuid-EYES-ONLY',
        recentProjects: [{ path: recentProjectPath }],
        lastSessionCwd: recentProjectPath,
        experiments: ['plus'],
      },
      null,
      2,
    ),
    'utf8',
  );

  return {
    tmpRoot,
    sourceHomedir,
  };
}
