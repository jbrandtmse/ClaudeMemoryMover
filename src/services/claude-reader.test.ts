import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CmemmovError } from '../core/error.js';

// Hoisted mock state so the vi.mock factory can read it. Default is undefined
// (passthrough); EBUSY/EPERM tests set it to override readFile behavior.
const { readFileOverride } = vi.hoisted(() => {
  return { readFileOverride: { current: null as null | ((path: string) => Error | undefined) } };
});

vi.mock('node:fs/promises', async () => {
  const actual =
    await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    readFile: vi.fn(async (path: Parameters<typeof actual.readFile>[0], opts?: unknown) => {
      if (typeof path === 'string') {
        const override = readFileOverride.current;
        if (override !== null) {
          const err = override(path);
          if (err !== undefined) throw err;
        }
      }
      return actual.readFile(
        path,
        opts as Parameters<typeof actual.readFile>[1],
      );
    }),
  };
});

const { readClaudeSurface, resolveOriginalPath } = await import('./claude-reader.js');

const FIXTURE_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'tests',
  'fixtures',
  'claude-trees',
  'linux-typical',
);

const CLAUDE_DIR = join(FIXTURE_ROOT, '.claude');
const CLAUDE_JSON = join(FIXTURE_ROOT, '.claude.json');

beforeEach(() => {
  readFileOverride.current = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('readClaudeSurface', () => {
  it('returns globalSettings parsed from settings.json', async () => {
    const surface = await readClaudeSurface(CLAUDE_DIR, CLAUDE_JSON);
    expect(surface.globalSettings).toBeDefined();
    const settings = surface.globalSettings as Record<string, unknown>;
    expect(settings.permissions).toBeDefined();
    expect(settings.mcpServers).toBeDefined();
  });

  it('extracts mcpConfig from settings.json mcpServers key', async () => {
    const surface = await readClaudeSurface(CLAUDE_DIR, CLAUDE_JSON);
    const mcp = surface.mcpConfig as Record<string, unknown>;
    expect(mcp.filesystem).toBeDefined();
  });

  it('reads globalMemory entries including MEMORY.md', async () => {
    const surface = await readClaudeSurface(CLAUDE_DIR, CLAUDE_JSON);
    const filenames = surface.globalMemory.map((m) => m.filename).sort();
    expect(filenames).toEqual(['MEMORY.md', 'user_profile.md']);
    const userProfile = surface.globalMemory.find((m) => m.filename === 'user_profile.md');
    expect(userProfile?.content).toContain('TypeScript strict mode');
  });

  it('reads global CLAUDE.md content', async () => {
    const surface = await readClaudeSurface(CLAUDE_DIR, CLAUDE_JSON);
    expect(surface.claudeMd).toContain('Global Claude Rules');
  });

  it('reads customCommands as filename + content', async () => {
    const surface = await readClaudeSurface(CLAUDE_DIR, CLAUDE_JSON);
    expect(surface.customCommands).toHaveLength(1);
    expect(surface.customCommands[0]?.filename).toBe('greet.md');
    expect(surface.customCommands[0]?.content).toContain('Greet the user');
  });

  it('reads teams keyed by team directory name', async () => {
    const surface = await readClaudeSurface(CLAUDE_DIR, CLAUDE_JSON);
    const teams = surface.teams as Record<string, unknown>;
    expect(teams['my-team']).toBeDefined();
    const myTeam = teams['my-team'] as Record<string, unknown>;
    expect(myTeam.id).toBe('team-abc');
  });

  it('reads claudeJson content as a parsed object', async () => {
    const surface = await readClaudeSurface(CLAUDE_DIR, CLAUDE_JSON);
    const cj = surface.claudeJson as Record<string, unknown>;
    expect(cj.oauthAccount).toBeDefined();
  });

  it('credentialsRef is undefined when no credentials file exists in fixture', async () => {
    const surface = await readClaudeSurface(CLAUDE_DIR, CLAUDE_JSON);
    expect(surface.credentialsRef).toBeUndefined();
  });

  it('plugins is undefined when neither plugins.json nor plugins/ exists', async () => {
    const surface = await readClaudeSurface(CLAUDE_DIR, CLAUDE_JSON);
    expect(surface.plugins).toBeUndefined();
  });

  it('enumerates each project directory as a ProjectSurface', async () => {
    const surface = await readClaudeSurface(CLAUDE_DIR, CLAUDE_JSON);
    expect(surface.projects).toHaveLength(1);
    const project = surface.projects[0];
    expect(project?.slug).toBe('-home-user-myproject');
    expect(project?.claudeMd).toContain('My Project Rules');
    expect(project?.memories.map((m) => m.filename).sort()).toEqual([
      'MEMORY.md',
      'project_notes.md',
    ]);
    const settings = project?.settings as Record<string, unknown>;
    expect(settings.permissions).toBeDefined();
    expect(project?.sessions).toHaveLength(1);
    expect(project?.sessions[0]?.filename).toBe('abc123.jsonl');
    // jsonl: 2 non-empty lines
    expect(project?.sessions[0]?.lines).toHaveLength(2);
  });

  it('throws CmemmovError(INTERNAL) when reading a session file fails with EBUSY', async () => {
    readFileOverride.current = (path: string): Error | undefined => {
      if (path.endsWith('.jsonl')) {
        return Object.assign(new Error('resource busy'), { code: 'EBUSY' });
      }
      return undefined;
    };

    try {
      await readClaudeSurface(CLAUDE_DIR, CLAUDE_JSON);
      expect.fail('expected readClaudeSurface to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(CmemmovError);
      const cm = err as CmemmovError;
      expect(cm.code).toBe('INTERNAL');
      expect(cm.hint).toMatch(/close Claude Code/i);
      expect(cm.file).toMatch(/abc123\.jsonl$/);
    }
  });

  it('throws CmemmovError(INTERNAL) on EPERM as well', async () => {
    readFileOverride.current = (path: string): Error | undefined => {
      if (path.endsWith('.jsonl')) {
        return Object.assign(new Error('permission denied'), { code: 'EPERM' });
      }
      return undefined;
    };

    await expect(readClaudeSurface(CLAUDE_DIR, CLAUDE_JSON)).rejects.toBeInstanceOf(CmemmovError);
  });
});

describe('resolveOriginalPath', () => {
  it('case (a): returns sessionCwd source when a session JSONL has a cwd field', async () => {
    const result = await resolveOriginalPath('-home-user-myproject', CLAUDE_DIR);
    expect(result.source).toBe('sessionCwd');
    expect(result.path).toBe('/home/user/myproject');
  });

  it('case (b): falls back to slugDecode when no sessions exist and slug is decodable', async () => {
    // platform-specific: this slug only decodes on linux/darwin
    if (process.platform !== 'linux' && process.platform !== 'darwin') {
      return;
    }
    // Use a slug that has no sessions on disk — the fixture tree has no
    // sessions for an arbitrary "-foo-bar" slug, so the function must fall
    // through to slugToPath.
    const result = await resolveOriginalPath('-foo-bar', CLAUDE_DIR);
    expect(result.source).toBe('slugDecode');
    expect(result.path).toBe('/foo/bar');
  });

  it('case (c): returns null source and slug as path when slug decode is null', async () => {
    // On win32, a slug missing the "X--" drive prefix decodes to null.
    // On linux/darwin, a slug not starting with "-" decodes to null.
    const ambiguousSlug = process.platform === 'win32' ? 'no-drive-prefix' : 'no-dash-prefix';
    const result = await resolveOriginalPath(ambiguousSlug, CLAUDE_DIR);
    expect(result.source).toBeNull();
    expect(result.path).toBe(ambiguousSlug);
  });

  it('returns sessionCwd by parsing the most-recent session JSONL', async () => {
    // The fixture has a single jsonl file abc123.jsonl whose first line has
    // cwd=/home/user/myproject — we already validated it in case (a). This
    // test re-asserts the contract that the most-recent session is selected
    // and its cwd is returned.
    const result = await resolveOriginalPath('-home-user-myproject', CLAUDE_DIR);
    expect(result).toEqual({ path: '/home/user/myproject', source: 'sessionCwd' });
  });

  it('throws CmemmovError(INTERNAL) when reading a session JSONL fails with EBUSY (AC5)', async () => {
    readFileOverride.current = (path: string): Error | undefined => {
      if (path.endsWith('.jsonl')) {
        return Object.assign(new Error('resource busy'), { code: 'EBUSY' });
      }
      return undefined;
    };
    try {
      await resolveOriginalPath('-home-user-myproject', CLAUDE_DIR);
      expect.fail('expected resolveOriginalPath to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(CmemmovError);
      const cm = err as CmemmovError;
      expect(cm.code).toBe('INTERNAL');
      expect(cm.hint).toMatch(/close Claude Code/i);
    }
  });

  it('throws CmemmovError(INTERNAL) when reading a session JSONL fails with EPERM (AC5)', async () => {
    readFileOverride.current = (path: string): Error | undefined => {
      if (path.endsWith('.jsonl')) {
        return Object.assign(new Error('permission denied'), { code: 'EPERM' });
      }
      return undefined;
    };
    await expect(
      resolveOriginalPath('-home-user-myproject', CLAUDE_DIR),
    ).rejects.toBeInstanceOf(CmemmovError);
  });
});
