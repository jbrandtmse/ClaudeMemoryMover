import { describe, it, expect } from 'vitest';
import { BundleSchema, type Bundle } from './bundle-schema.js';
import {
  applySanitization,
  SANITIZATION_PROFILES,
  PERSONAL_FILENAME_PATTERNS,
  CLAUDE_JSON_TEAM_ALLOWLIST,
  stripPersonalMemories,
  stripHomedirPermissionRules,
  stripLocalMcpServers,
  stripClaudeJsonUserFields,
} from './sanitization-rules.js';
import { ALL_CATEGORIES } from './decision-schema.js';
import validMinimal from '../../tests/fixtures/bundles/valid-minimal.json' with { type: 'json' };
import withCredentials from '../../tests/fixtures/bundles/with-credentials.json' with { type: 'json' };

// Minimal valid bundle factory
function makeBundle(overrides: Partial<Bundle> = {}): Bundle {
  return BundleSchema.parse({
    version: '1.1.0',
    exportedAt: '2026-05-09T12:00:00.000Z',
    sourcePlatform: 'linux',
    sourceHomedir: '/home/user',
    claudeVersion: '2.1.133',
    hasCredentials: false,
    projects: [],
    global: {},
    ...overrides,
  });
}

describe('applySanitization (redact-credentials)', () => {
  it('removes credential content and sets wasRedacted = true when credentials are present', () => {
    const bundle = BundleSchema.parse(withCredentials);
    const sanitized = applySanitization(bundle, 'redact-credentials');
    expect(sanitized.credentials).toBeDefined();
    expect(sanitized.credentials?.wasRedacted).toBe(true);
    expect(sanitized.credentials?.content).toBeNull();
  });

  it('does not mutate the original credential content (returns a new object)', () => {
    const bundle = BundleSchema.parse(withCredentials);
    const originalContent = bundle.credentials?.content;
    applySanitization(bundle, 'redact-credentials');
    expect(bundle.credentials?.content).toBe(originalContent);
    expect(bundle.credentials?.wasRedacted).toBe(false);
  });

  it('returns the bundle unchanged when credentials are absent', () => {
    const bundle = BundleSchema.parse(validMinimal);
    const sanitized = applySanitization(bundle, 'redact-credentials');
    expect(sanitized).toBe(bundle);
    expect(sanitized.credentials).toBeUndefined();
  });

  it('preserves all non-credential bundle fields when sanitizing', () => {
    const bundle = BundleSchema.parse(withCredentials);
    const sanitized = applySanitization(bundle, 'redact-credentials');
    expect(sanitized.version).toBe(bundle.version);
    expect(sanitized.exportedAt).toBe(bundle.exportedAt);
    expect(sanitized.sourcePlatform).toBe(bundle.sourcePlatform);
    expect(sanitized.claudeVersion).toBe(bundle.claudeVersion);
    expect(sanitized.hasCredentials).toBe(bundle.hasCredentials);
    expect(sanitized.projects).toBe(bundle.projects);
    expect(sanitized.global).toBe(bundle.global);
  });

  it('preserves projects array structure when sanitizing a bundle that has projects', () => {
    const bundle = BundleSchema.parse(validMinimal);
    const sanitized = applySanitization(bundle, 'redact-credentials');
    expect(sanitized.projects).toHaveLength(1);
    expect(sanitized.projects[0]?.slug).toBe('-home-user-myapp');
    expect(sanitized.projects[0]?.memories).toEqual(bundle.projects[0]?.memories);
  });
});

describe('applySanitization (strip-personal)', () => {
  // AC2: credentials stripped unconditionally
  describe('AC2 — credentials stripped unconditionally', () => {
    it('strips credentials to null and sets wasRedacted.credentials = true', () => {
      const bundle = makeBundle({
        hasCredentials: true,
        credentials: { content: { token: 'secret' }, wasRedacted: false },
      });
      const sanitized = applySanitization(bundle, 'strip-personal');
      expect(sanitized.credentials?.content).toBeNull();
      expect(sanitized.credentials?.wasRedacted).toBe(true);
      expect(sanitized.wasRedacted?.credentials).toBe(true);
    });

    it('does not set wasRedacted.credentials when bundle has no credentials', () => {
      const bundle = makeBundle();
      const sanitized = applySanitization(bundle, 'strip-personal');
      expect(sanitized.credentials).toBeUndefined();
      expect(sanitized.wasRedacted?.credentials).toBeUndefined();
    });

    it('input bundle is not mutated (credentials path)', () => {
      const bundle = makeBundle({
        hasCredentials: true,
        credentials: { content: { token: 'secret' }, wasRedacted: false },
      });
      const originalContent = bundle.credentials?.content;
      applySanitization(bundle, 'strip-personal');
      expect(bundle.credentials?.content).toBe(originalContent);
      expect(bundle.credentials?.wasRedacted).toBe(false);
    });

    // AC2 (negative): compile-time test that no options bypass credentials stripping.
    // The function signature has no 3rd parameter, so passing extra args is a TypeScript error.
    // @ts-expect-error - no third argument accepted
    void ((_b: Bundle) => applySanitization(_b, 'strip-personal', { keepCredentials: true }));
  });

  // AC3: personal memory filtering
  describe('AC3 — personal memory filtering', () => {
    it('strips memories matching PERSONAL_FILENAME_PATTERNS', () => {
      const bundle = makeBundle({
        global: {
          memories: [
            { filename: 'personal_notes.md', content: '# Notes' },
            { filename: 'private_journal.md', content: '# Journal' },
            { filename: 'me_log.md', content: '# Log' },
            { filename: 'todo_list.md', content: '# Todo' },
            { filename: 'MEMORY.md', content: '# Index' },
            { filename: 'team-rules.md', content: '# Rules' },
            { filename: 'CLAUDE.md', content: '# Claude' },
          ],
        },
      });
      const sanitized = applySanitization(bundle, 'strip-personal');
      const kept = sanitized.global.memories as { filename: string }[] | undefined;
      const filenames = kept?.map((m) => m.filename) ?? [];
      expect(filenames).toContain('MEMORY.md');
      expect(filenames).toContain('team-rules.md');
      expect(filenames).toContain('CLAUDE.md');
      expect(filenames).not.toContain('personal_notes.md');
      expect(filenames).not.toContain('private_journal.md');
      expect(filenames).not.toContain('me_log.md');
      expect(filenames).not.toContain('todo_list.md');
    });

    it('strips a memory with YAML frontmatter personal: true', () => {
      const bundle = makeBundle({
        global: {
          memories: [
            {
              filename: 'my-notes.md',
              content: '---\npersonal: true\n---\n# Title\nContent here.',
            },
            { filename: 'shared.md', content: '# Shared\nNo frontmatter.' },
          ],
        },
      });
      const sanitized = applySanitization(bundle, 'strip-personal');
      const kept = sanitized.global.memories as { filename: string }[] | undefined;
      const filenames = kept?.map((m) => m.filename) ?? [];
      expect(filenames).not.toContain('my-notes.md');
      expect(filenames).toContain('shared.md');
    });

    it('records stripped global memory filenames in wasRedacted.personalMemoryFiles', () => {
      const bundle = makeBundle({
        global: {
          memories: [
            { filename: 'personal_notes.md', content: '# Notes' },
            { filename: 'MEMORY.md', content: '# Index' },
          ],
        },
      });
      const sanitized = applySanitization(bundle, 'strip-personal');
      expect(sanitized.wasRedacted?.personalMemoryFiles).toContain('global/personal_notes.md');
      expect(sanitized.wasRedacted?.personalMemoryFiles).not.toContain('global/MEMORY.md');
    });

    it('records stripped project memory filenames scoped to slug', () => {
      const bundle = makeBundle({
        projects: [
          {
            slug: 'my-proj',
            originalPath: '/home/user/my-proj',
            memories: [
              { filename: 'personal_notes.md', content: '# Personal' },
              { filename: 'CLAUDE.md', content: '# Shared' },
            ],
          },
        ],
      });
      const sanitized = applySanitization(bundle, 'strip-personal');
      expect(sanitized.wasRedacted?.personalMemoryFiles).toContain(
        'my-proj/personal_notes.md',
      );
      expect(sanitized.wasRedacted?.personalMemoryFiles).not.toContain(
        'my-proj/CLAUDE.md',
      );
    });

    it('does not strip memory entries without frontmatter or matching filename', () => {
      const bundle = makeBundle({
        global: {
          memories: [
            { filename: 'notes.md', content: 'Just content, no frontmatter.' },
          ],
        },
      });
      const sanitized = applySanitization(bundle, 'strip-personal');
      const kept = sanitized.global.memories as { filename: string }[] | undefined;
      expect(kept?.map((m) => m.filename)).toContain('notes.md');
      expect(sanitized.wasRedacted?.personalMemoryFiles).toBeUndefined();
    });
  });

  // AC4: permission rules under source home directory
  describe('AC4 — permission rules under source home directory', () => {
    it('strips permission rules with absolute paths under sourceHomedir (linux)', () => {
      const bundle = makeBundle({
        sourceHomedir: '/home/user',
        global: {
          settings: {
            permissions: [
              'Read(/home/user/secrets)',
              'Write(/home/user/projects/**)',
              'Read(./relative/path)',
              'Bash(git status)',
              'Read(\\\\server\\share)',
              'Write(**/*.log)',
            ],
          },
        },
      });
      const sanitized = applySanitization(bundle, 'strip-personal');
      const settings = sanitized.global.settings as Record<string, unknown>;
      const perms = settings.permissions as string[];
      expect(perms).toContain('Read(./relative/path)');
      expect(perms).toContain('Bash(git status)');
      expect(perms).toContain('Read(\\\\server\\share)');
      expect(perms).toContain('Write(**/*.log)');
      expect(perms).not.toContain('Read(/home/user/secrets)');
      expect(perms).not.toContain('Write(/home/user/projects/**)');
      expect(sanitized.wasRedacted?.homeDirPermissionRules).toContain(
        'Read(/home/user/secrets)',
      );
    });

    it('strips permission rules under sourceHomedir for Windows paths', () => {
      const bundle = BundleSchema.parse({
        version: '1.1.0',
        exportedAt: '2026-05-09T12:00:00.000Z',
        sourcePlatform: 'win32',
        sourceHomedir: 'C:\\Users\\Josh',
        claudeVersion: '2.1.133',
        hasCredentials: false,
        projects: [],
        global: {
          settings: {
            permissions: [
              'Read(C:\\Users\\Josh\\agents\\**)',
              'Read(D:\\shared\\data)',
            ],
          },
        },
      });
      const sanitized = applySanitization(bundle, 'strip-personal');
      const settings = sanitized.global.settings as Record<string, unknown>;
      const perms = settings.permissions as string[];
      expect(perms).not.toContain('Read(C:\\Users\\Josh\\agents\\**)');
      expect(perms).toContain('Read(D:\\shared\\data)');
      expect(sanitized.wasRedacted?.homeDirPermissionRules).toBeDefined();
    });

    it('preserves network path permission rules', () => {
      const bundle = makeBundle({
        global: {
          settings: {
            permissions: [
              'Read(https://example.com/resource)',
              'Read(\\\\server\\share)',
            ],
          },
        },
      });
      const sanitized = applySanitization(bundle, 'strip-personal');
      const settings = sanitized.global.settings as Record<string, unknown>;
      const perms = settings.permissions as string[];
      expect(perms).toContain('Read(https://example.com/resource)');
      expect(perms).toContain('Read(\\\\server\\share)');
      expect(sanitized.wasRedacted?.homeDirPermissionRules).toBeUndefined();
    });

    it('applies the same filtering to project permissions with slug prefix', () => {
      const bundle = makeBundle({
        projects: [
          {
            slug: 'my-proj',
            originalPath: '/home/user/my-proj',
            settings: {
              permissions: [
                'Write(/home/user/my-proj/output/**)',
                'Read(/opt/shared/**)',
              ],
            },
          },
        ],
      });
      const sanitized = applySanitization(bundle, 'strip-personal');
      const proj = sanitized.projects[0];
      const perms = (proj?.settings as Record<string, unknown>).permissions as string[];
      expect(perms).not.toContain('Write(/home/user/my-proj/output/**)');
      expect(perms).toContain('Read(/opt/shared/**)');
      expect(sanitized.wasRedacted?.homeDirPermissionRules).toContain(
        'my-proj: Write(/home/user/my-proj/output/**)',
      );
    });
  });

  // AC5: MCP server entries with local paths
  describe('AC5 — MCP server entries with local paths', () => {
    it('removes MCP servers with command under sourceHomedir', () => {
      const bundle = makeBundle({
        global: {
          mcpConfig: {
            localTool: { command: '/home/user/agents/local.js', args: [] },
            remoteTool: { command: 'npx', args: ['server-x'] },
            urlTool: { command: 'https://server.example/tool', args: [] },
          },
        },
      });
      const sanitized = applySanitization(bundle, 'strip-personal');
      const mcp = sanitized.global.mcpConfig as Record<string, unknown>;
      expect(mcp).not.toHaveProperty('localTool');
      expect(mcp).toHaveProperty('remoteTool');
      expect(mcp).toHaveProperty('urlTool');
      expect(sanitized.wasRedacted?.localMcpServers).toContain('localTool');
    });

    it('removes claudeJson.mcpServers entries under sourceHomedir with claudeJson: prefix', () => {
      // Note: mcpServers is not in CLAUDE_JSON_TEAM_ALLOWLIST, so the entire key is
      // removed by the allowlist filter regardless. However, the stripped server names
      // are recorded BEFORE the allowlist filter removes mcpServers from claudeJson.
      const bundle = makeBundle({
        global: {
          claudeJson: {
            theme: 'dark',
            mcpServers: {
              localTool: { command: '/home/user/agents/local.js' },
              remoteTool: { command: 'npx' },
            },
          },
        },
      });
      const sanitized = applySanitization(bundle, 'strip-personal');
      // theme survives the allowlist; mcpServers does not (not in allowlist)
      const claudeJson = sanitized.global.claudeJson as Record<string, unknown>;
      expect(claudeJson).toHaveProperty('theme', 'dark');
      expect(claudeJson).not.toHaveProperty('mcpServers');
      // localTool is recorded because it had a home-dir path command
      expect(sanitized.wasRedacted?.localMcpServers).toContain('claudeJson:localTool');
    });
  });

  // AC6: Custom commands and CLAUDE.md preserved
  describe('AC6 — customCommands and claudeMd preserved', () => {
    it('preserves global.customCommands verbatim', () => {
      const cmds = [{ filename: 'my-cmd.md', content: '# cmd' }];
      const bundle = makeBundle({ global: { customCommands: cmds } });
      const sanitized = applySanitization(bundle, 'strip-personal');
      expect(sanitized.global.customCommands).toEqual(cmds);
    });

    it('preserves global.claudeMd verbatim', () => {
      const bundle = makeBundle({ global: { claudeMd: '# Global rules' } });
      const sanitized = applySanitization(bundle, 'strip-personal');
      expect(sanitized.global.claudeMd).toBe('# Global rules');
    });

    it('preserves per-project claudeMd verbatim', () => {
      const bundle = makeBundle({
        projects: [
          {
            slug: 'proj',
            originalPath: '/home/user/proj',
            claudeMd: '# Project rules',
          },
        ],
      });
      const sanitized = applySanitization(bundle, 'strip-personal');
      expect(sanitized.projects[0]?.claudeMd).toBe('# Project rules');
    });
  });

  // AC7: .claude.json user-identifying fields stripped
  describe('AC7 — claudeJson user-identifying fields stripped', () => {
    it('keeps only allowlisted fields from claudeJson', () => {
      const bundle = makeBundle({
        global: {
          claudeJson: {
            theme: 'dark',
            email: 'user@example.com',
            recentProjects: ['/home/user/proj'],
            machineId: 'abc123',
            editorMode: 'vim',
          },
        },
      });
      const sanitized = applySanitization(bundle, 'strip-personal');
      const cj = sanitized.global.claudeJson as Record<string, unknown>;
      expect(cj).toHaveProperty('theme', 'dark');
      expect(cj).toHaveProperty('editorMode', 'vim');
      expect(cj).not.toHaveProperty('email');
      expect(cj).not.toHaveProperty('recentProjects');
      expect(cj).not.toHaveProperty('machineId');
    });

    it('records stripped fields in wasRedacted.claudeJsonFields', () => {
      const bundle = makeBundle({
        global: {
          claudeJson: {
            theme: 'dark',
            email: 'user@example.com',
            name: 'Josh',
          },
        },
      });
      const sanitized = applySanitization(bundle, 'strip-personal');
      expect(sanitized.wasRedacted?.claudeJsonFields).toContain('email');
      expect(sanitized.wasRedacted?.claudeJsonFields).toContain('name');
      expect(sanitized.wasRedacted?.claudeJsonFields).not.toContain('theme');
    });

    it('removes claudeJson entirely when no allowlisted fields remain', () => {
      const bundle = makeBundle({
        global: {
          claudeJson: {
            email: 'user@example.com',
            machineId: 'abc',
          },
        },
      });
      const sanitized = applySanitization(bundle, 'strip-personal');
      expect(sanitized.global.claudeJson).toBeUndefined();
      expect(sanitized.wasRedacted?.claudeJsonFields).toContain('email');
    });

    it('preserves claudeJson when only allowlisted fields are present', () => {
      const bundle = makeBundle({
        global: {
          claudeJson: { theme: 'light', verbose: true },
        },
      });
      const sanitized = applySanitization(bundle, 'strip-personal');
      expect(sanitized.global.claudeJson).toEqual({ theme: 'light', verbose: true });
      expect(sanitized.wasRedacted?.claudeJsonFields).toBeUndefined();
    });
  });

  // AC9: canonical category coverage
  describe('AC9 — canonical category coverage', () => {
    it('strip-personal profile has a defined decision for every canonical category', () => {
      const profile = SANITIZATION_PROFILES['strip-personal'];
      const allCats: string[] = [...ALL_CATEGORIES, 'credentials', 'claudeJson'];
      for (const cat of allCats) {
        expect(
          profile[cat as keyof typeof profile],
          `strip-personal missing decision for '${cat}'`,
        ).toBeDefined();
      }
    });

    it('strip-personal profile has no extra or misspelled keys beyond canonical categories', () => {
      const profile = SANITIZATION_PROFILES['strip-personal'];
      const canonicalSet = new Set([...ALL_CATEGORIES, 'credentials', 'claudeJson']);
      for (const key of Object.keys(profile)) {
        expect(
          canonicalSet.has(key as never),
          `strip-personal has unexpected key '${key}'`,
        ).toBe(true);
      }
    });

    it('redact-credentials profile also covers all canonical categories', () => {
      const profile = SANITIZATION_PROFILES['redact-credentials'];
      const allCats: string[] = [...ALL_CATEGORIES, 'credentials', 'claudeJson'];
      for (const cat of allCats) {
        expect(profile[cat as keyof typeof profile]).toBeDefined();
      }
    });
  });

  // AC10: redact-credentials regression
  describe('AC10 — redact-credentials regression (existing behavior unchanged)', () => {
    it('redact-credentials: strips credentials and sets wasRedacted = true', () => {
      const bundle = BundleSchema.parse(withCredentials);
      const sanitized = applySanitization(bundle, 'redact-credentials');
      expect(sanitized.credentials?.wasRedacted).toBe(true);
      expect(sanitized.credentials?.content).toBeNull();
    });

    it('redact-credentials: returns same reference when no credentials', () => {
      const bundle = BundleSchema.parse(validMinimal);
      expect(applySanitization(bundle, 'redact-credentials')).toBe(bundle);
    });
  });

  // AC11: session history stripped
  describe('AC11 — sessionHistory stripped unconditionally', () => {
    it('strips sessions from all projects; project itself is preserved', () => {
      const bundle = makeBundle({
        projects: [
          {
            slug: 'proj',
            originalPath: '/home/user/proj',
            sessions: [
              { filename: 'sess.jsonl', lines: ['{"type":"message"}'] },
            ],
          },
        ],
      });
      const sanitized = applySanitization(bundle, 'strip-personal');
      expect(sanitized.projects).toHaveLength(1);
      expect(sanitized.projects[0]?.slug).toBe('proj');
      expect(sanitized.projects[0]?.sessions).toBeUndefined();
    });

    it('does not write wasRedacted entry for sessions', () => {
      const bundle = makeBundle({
        projects: [
          {
            slug: 'p',
            originalPath: '/home/user/p',
            sessions: [{ filename: 's.jsonl', lines: ['{}'] }],
          },
        ],
      });
      const sanitized = applySanitization(bundle, 'strip-personal');
      // sessionHistory strip is architectural; not recorded per-item in wasRedacted
      expect((sanitized.wasRedacted as Record<string, unknown> | undefined)?.sessionHistory).toBeUndefined();
    });
  });

  // AC12: teams and plugins preserved
  describe('AC12 — teams and plugins preserved', () => {
    it('preserves global.teams verbatim', () => {
      const teams = { 'my-team': { members: ['alice'] } };
      const bundle = makeBundle({ global: { teams } });
      const sanitized = applySanitization(bundle, 'strip-personal');
      expect(sanitized.global.teams).toEqual(teams);
    });

    it('preserves global.plugins verbatim', () => {
      const plugins = { 'my-plugin': { version: '1.0' } };
      const bundle = makeBundle({ global: { plugins } });
      const sanitized = applySanitization(bundle, 'strip-personal');
      expect(sanitized.global.plugins).toEqual(plugins);
    });
  });

  // Immutability
  describe('immutability', () => {
    it('input bundle is not mutated', () => {
      const bundle = makeBundle({
        hasCredentials: true,
        credentials: { content: { token: 'secret' }, wasRedacted: false },
        global: {
          memories: [{ filename: 'personal_notes.md', content: '# Personal' }],
          claudeJson: { theme: 'dark', email: 'x@y.com' },
          settings: {
            permissions: ['Read(/home/user/stuff)', 'Read(./relative)'],
          },
        },
        projects: [
          {
            slug: 'p',
            originalPath: '/home/user/p',
            sessions: [{ filename: 's.jsonl', lines: ['{}'] }],
            memories: [{ filename: 'private_log.md', content: '# Private' }],
          },
        ],
      });

      const originalJson = JSON.stringify(bundle);
      applySanitization(bundle, 'strip-personal');
      expect(JSON.stringify(bundle)).toBe(originalJson);
    });
  });

  // Edge cases for 100% coverage
  describe('edge cases', () => {
    it('memory entry with content but no frontmatter delimiters is preserved', () => {
      const bundle = makeBundle({
        global: {
          memories: [
            { filename: 'notes.md', content: 'No frontmatter here.' },
          ],
        },
      });
      const sanitized = applySanitization(bundle, 'strip-personal');
      const kept = sanitized.global.memories as { filename: string }[] | undefined;
      expect(kept?.map((m) => m.filename)).toContain('notes.md');
    });

    it('permission rule with non-absolute path (e.g. relative or glob) is preserved', () => {
      const bundle = makeBundle({
        global: {
          settings: {
            permissions: ['Read(relative/path)', 'Write(**/*.ts)'],
          },
        },
      });
      const sanitized = applySanitization(bundle, 'strip-personal');
      const settings = sanitized.global.settings as Record<string, unknown>;
      expect(settings.permissions).toContain('Read(relative/path)');
      expect(settings.permissions).toContain('Write(**/*.ts)');
    });

    it('MCP entry with null/undefined command value is preserved', () => {
      const bundle = makeBundle({
        global: {
          mcpConfig: {
            nullCmd: { command: null },
            noCmd: { port: 9090 },
          },
        },
      });
      const sanitized = applySanitization(bundle, 'strip-personal');
      const mcp = sanitized.global.mcpConfig as Record<string, unknown>;
      expect(mcp).toHaveProperty('nullCmd');
      expect(mcp).toHaveProperty('noCmd');
    });

    it('claudeJson that is null or non-object produces kept: undefined', () => {
      // Simulate non-object claudeJson (shouldn't happen in practice, but defensive)
      const result = stripClaudeJsonUserFields(null);
      expect(result.kept).toBeUndefined();
      expect(result.strippedFields).toEqual([]);

      const resultStr = stripClaudeJsonUserFields('a string');
      expect(resultStr.kept).toBeUndefined();
    });

    it('bundle with no credentials at all does not write wasRedacted.credentials', () => {
      const bundle = makeBundle();
      const sanitized = applySanitization(bundle, 'strip-personal');
      expect(sanitized.credentials).toBeUndefined();
      expect(sanitized.wasRedacted?.credentials).toBeUndefined();
    });

    it('case-insensitive path matching on win32 — drive letter capitalization differs', () => {
      // Test win32 case-insensitive matching by passing 'win32' as platform explicitly
      const { stripped: strippedWin32 } = stripHomedirPermissionRules(
        ['Read(C:\\Users\\Josh\\secrets)'],
        'c:\\users\\josh',
        '',
        'win32',
      );
      // win32: case-insensitive — C:\Users\Josh matches c:\users\josh
      expect(strippedWin32).toContain('Read(C:\\Users\\Josh\\secrets)');

      // Linux: case-sensitive
      const { stripped: strippedLinux } = stripHomedirPermissionRules(
        ['Read(/home/user/secrets)'],
        '/home/user',
        '',
        'linux',
      );
      expect(strippedLinux).toContain('Read(/home/user/secrets)');
    });

    it('win32 forward-slash path in rule matches backslash sourceHomedir (separator normalization)', () => {
      // AC4: strip is independent of which separator style the rule uses.
      // Rule uses forward slashes; sourceHomedir uses backslashes — must still match.
      const { stripped } = stripHomedirPermissionRules(
        ['Read(C:/Users/Josh/secrets)'],
        'C:\\Users\\Josh',
        '',
        'win32',
      );
      expect(stripped).toContain('Read(C:/Users/Josh/secrets)');
    });

    it('permission rule with no parseable arg (bare Bash command) is preserved', () => {
      const bundle = makeBundle({
        global: {
          settings: {
            permissions: ['Bash(git status)', 'Bash(npm test)'],
          },
        },
      });
      const sanitized = applySanitization(bundle, 'strip-personal');
      const settings = sanitized.global.settings as Record<string, unknown>;
      const perms = settings.permissions as string[];
      expect(perms).toContain('Bash(git status)');
      expect(perms).toContain('Bash(npm test)');
    });

    it('non-string entries in permissions array pass through unchanged', () => {
      const { kept } = stripHomedirPermissionRules(
        [42, 'Read(/home/user/x)', null],
        '/home/user',
        '',
        'linux',
      );
      const arr = kept as unknown[];
      expect(arr).toContain(42);
      expect(arr).toContain(null);
    });

    it('permissions that is not an array passes through unchanged', () => {
      const { kept } = stripHomedirPermissionRules('not-an-array', '/home/user', '', 'linux');
      expect(kept).toBe('not-an-array');
    });

    it('mcpRecord that is not a plain object passes through unchanged', () => {
      const { kept } = stripLocalMcpServers(null, '/home/user', '', 'linux');
      expect(kept).toBeNull();
      const { kept: arr } = stripLocalMcpServers([1, 2], '/home/user', '', 'linux');
      expect(arr).toEqual([1, 2]);
    });

    it('stripPersonalMemories with empty array returns empty kept', () => {
      const { kept, strippedFilenames } = stripPersonalMemories([], 'global');
      expect(kept).toEqual([]);
      expect(strippedFilenames).toEqual([]);
    });

    it('permission rule with no parentheses (no parseable arg) is preserved', () => {
      // Rule without parens does not match `^\w+\((.+)\)$` — covers the argMatch===null branch
      const { kept, stripped } = stripHomedirPermissionRules(
        ['JustAWord', 'Read(/home/user/x)'],
        '/home/user',
        '',
        'linux',
      );
      const arr = kept as string[];
      expect(arr).toContain('JustAWord');
      expect(stripped).toContain('Read(/home/user/x)');
    });

    it('strips MCP servers inside global.settings.mcpServers', () => {
      const bundle = makeBundle({
        global: {
          settings: {
            model: 'sonnet',
            mcpServers: {
              localTool: { command: '/home/user/agents/tool.js' },
              remoteTool: { command: 'npx' },
            },
          },
        },
      });
      const sanitized = applySanitization(bundle, 'strip-personal');
      const settings = sanitized.global.settings as Record<string, unknown>;
      const mcpServers = settings.mcpServers as Record<string, unknown> | undefined;
      expect(mcpServers).not.toHaveProperty('localTool');
      expect(mcpServers).toHaveProperty('remoteTool');
      expect(sanitized.wasRedacted?.localMcpServers).toContain('localTool');
    });

    it('MCP server entry with path field (not command) is stripped when path is under sourceHomedir', () => {
      // Covers extractMcpCommand's path field branch
      const bundle = makeBundle({
        global: {
          mcpConfig: {
            pathTool: { path: '/home/user/tools/plugin.js' },
            remoteTool: { command: 'node' },
          },
        },
      });
      const sanitized = applySanitization(bundle, 'strip-personal');
      const mcp = sanitized.global.mcpConfig as Record<string, unknown>;
      expect(mcp).not.toHaveProperty('pathTool');
      expect(mcp).toHaveProperty('remoteTool');
    });

    it('MCP server entry whose value is not a plain object is preserved', () => {
      // Covers extractMcpCommand returning null for non-object values
      const bundle = makeBundle({
        global: {
          mcpConfig: {
            nullEntry: null,
            validEntry: { command: 'npx' },
          },
        },
      });
      const sanitized = applySanitization(bundle, 'strip-personal');
      const mcp = sanitized.global.mcpConfig as Record<string, unknown>;
      expect(mcp).toHaveProperty('nullEntry');
      expect(mcp).toHaveProperty('validEntry');
    });

    it('hasFrontmatterPersonalTrue handles lines array where all indices exist', () => {
      // Covers lines[i] ?? '' — in practice lines[i] is always defined in bounds,
      // but we test content between frontmatter delimiters that has no personal field
      const bundle = makeBundle({
        global: {
          memories: [
            {
              filename: 'notes.md',
              content: '---\ntag: team\nshared: true\n---\n# Content',
            },
          ],
        },
      });
      const sanitized = applySanitization(bundle, 'strip-personal');
      const kept = sanitized.global.memories as { filename: string }[] | undefined;
      expect(kept?.map((m) => m.filename)).toContain('notes.md');
    });

    it('wasRedacted is omitted when nothing is stripped', () => {
      const bundle = makeBundle({
        global: {
          memories: [{ filename: 'MEMORY.md', content: '# Index' }],
        },
      });
      const sanitized = applySanitization(bundle, 'strip-personal');
      expect(sanitized.wasRedacted).toBeUndefined();
    });

    it('PERSONAL_FILENAME_PATTERNS is exported at module level', () => {
      expect(PERSONAL_FILENAME_PATTERNS).toBeInstanceOf(Array);
      expect(PERSONAL_FILENAME_PATTERNS.length).toBeGreaterThan(0);
      expect(PERSONAL_FILENAME_PATTERNS.every((p) => p instanceof RegExp)).toBe(true);
    });

    it('CLAUDE_JSON_TEAM_ALLOWLIST is exported at module level', () => {
      expect(CLAUDE_JSON_TEAM_ALLOWLIST).toBeInstanceOf(Array);
      expect(CLAUDE_JSON_TEAM_ALLOWLIST).toContain('theme');
      expect(CLAUDE_JSON_TEAM_ALLOWLIST).toContain('editorMode');
    });

    it('frontmatter with only opening --- (no closing) is not treated as personal', () => {
      const bundle = makeBundle({
        global: {
          memories: [
            { filename: 'notes.md', content: '---\npersonal: true\nno closing delimiter' },
          ],
        },
      });
      const sanitized = applySanitization(bundle, 'strip-personal');
      const kept = sanitized.global.memories as { filename: string }[] | undefined;
      expect(kept?.map((m) => m.filename)).toContain('notes.md');
    });

    it('frontmatter with personal: false does not strip the memory', () => {
      const bundle = makeBundle({
        global: {
          memories: [
            { filename: 'notes.md', content: '---\npersonal: false\n---\n# Content' },
          ],
        },
      });
      const sanitized = applySanitization(bundle, 'strip-personal');
      const kept = sanitized.global.memories as { filename: string }[] | undefined;
      expect(kept?.map((m) => m.filename)).toContain('notes.md');
    });
  });
});
