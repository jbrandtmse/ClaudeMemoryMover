import { describe, it, expect } from 'vitest';
import {
  pathToSlug,
  slugToPath,
  findMatchingDir,
  isCrossPlatformMigration,
} from './path-engine.js';
import fixtures from '../../tests/fixtures/slug-edge-cases.json' with { type: 'json' };

interface SlugFixture {
  description: string;
  platform: string;
  absolutePath: string | null;
  slug: string;
  decodesTo: string | null;
}

const fixtureCases: readonly SlugFixture[] = fixtures;

const encodeCases = fixtureCases.filter(
  (f): f is SlugFixture & { absolutePath: string } => f.absolutePath !== null,
);

describe('path-engine', () => {
  describe('pathToSlug', () => {
    it.each(encodeCases)(
      'encodes $description',
      ({ absolutePath, slug }) => {
        expect(pathToSlug(absolutePath)).toBe(slug);
      },
    );

    it('matches Claude Code algorithm for win32 example from AC 1', () => {
      expect(pathToSlug('C:\\Users\\Josh\\dev\\my-app')).toBe('C--Users-Josh-dev-my-app');
    });

    it('matches Claude Code algorithm for unix example from AC 1', () => {
      expect(pathToSlug('/home/jordan/dev/api-gateway')).toBe('-home-jordan-dev-api-gateway');
    });
  });

  describe('slugToPath', () => {
    it.each(fixtureCases)(
      'decodes $description',
      ({ slug, platform, decodesTo }) => {
        expect(slugToPath(slug, platform as NodeJS.Platform)).toBe(decodesTo);
      },
    );

    it('returns null for win32 slug missing the drive prefix', () => {
      expect(slugToPath('home-user-project', 'win32')).toBeNull();
    });

    it('returns null for win32 slug with single dash after drive letter', () => {
      expect(slugToPath('C-Users-Josh', 'win32')).toBeNull();
    });

    it('reverses an encoded win32 path round-trip (no hyphens in folder names)', () => {
      const original = 'D:\\projects\\sample';
      const slug = pathToSlug(original);
      expect(slugToPath(slug, 'win32')).toBe(original);
    });

    it('reverses an encoded linux path round-trip (no hyphens in folder names)', () => {
      const original = '/var/log/app';
      const slug = pathToSlug(original);
      expect(slugToPath(slug, 'linux')).toBe(original);
    });

    it('reverses an encoded darwin path round-trip (no hyphens in folder names)', () => {
      const original = '/Users/me/code';
      const slug = pathToSlug(original);
      expect(slugToPath(slug, 'darwin')).toBe(original);
    });

    it('demonstrates the documented lossy decode for hyphenated folder names', () => {
      const slug = pathToSlug('/home/my-project');
      expect(slug).toBe('-home-my-project');
      expect(slugToPath(slug, 'linux')).toBe('/home/my/project');
    });

    it('returns null for an unsupported platform', () => {
      expect(slugToPath('-anything', 'aix')).toBeNull();
    });
  });

  describe('findMatchingDir', () => {
    it('returns the first scanRoot whose basename matches originalPath basename', () => {
      const original = '/home/oldhostname/dev/my-project';
      const candidates = [
        '/home/newhostname/dev/my-project',
        '/home/newhostname/work/my-project',
      ];
      expect(findMatchingDir(original, candidates)).toBe('/home/newhostname/dev/my-project');
    });

    it('returns null when no scanRoot basename matches', () => {
      expect(findMatchingDir('/home/u/alpha', ['/home/u/beta', '/home/u/gamma'])).toBeNull();
    });

    it('returns null when scanRoots is empty', () => {
      expect(findMatchingDir('/home/u/alpha', [])).toBeNull();
    });

    it('matches across differing parent directories on win32-style paths', () => {
      const original = 'C:\\Users\\Josh\\dev\\app';
      const candidates = ['D:\\backup\\dev\\app', 'C:\\Users\\Josh\\dev\\app'];
      expect(findMatchingDir(original, candidates)).toBe('D:\\backup\\dev\\app');
    });

    it('matches a foreign-OS originalPath against current-OS scanRoots (cross-OS migration)', () => {
      // simulates running on linux and resolving a win32-origin originalPath
      // against linux scanRoots — the basename must be extracted from either
      // separator style so this works regardless of runtime os.
      const original = 'C:\\Users\\Josh\\dev\\my-app';
      const candidates = ['/home/jordan/work/my-app', '/home/jordan/dev/my-app'];
      expect(findMatchingDir(original, candidates)).toBe('/home/jordan/work/my-app');
    });

    it('matches a unix-origin originalPath against win32 scanRoots', () => {
      const original = '/home/jordan/dev/my-app';
      const candidates = ['D:\\backup\\dev\\my-app', 'C:\\Users\\Josh\\dev\\my-app'];
      expect(findMatchingDir(original, candidates)).toBe('D:\\backup\\dev\\my-app');
    });

    it('treats a path with no separators as its own basename', () => {
      expect(findMatchingDir('alpha', ['beta', 'alpha', 'gamma'])).toBe('alpha');
    });
  });

  describe('isCrossPlatformMigration', () => {
    it('returns false when source and current platforms match', () => {
      expect(isCrossPlatformMigration('linux', 'linux')).toBe(false);
    });

    it('returns true when source and current platforms differ', () => {
      expect(isCrossPlatformMigration('darwin', 'linux')).toBe(true);
      expect(isCrossPlatformMigration('linux', 'win32')).toBe(true);
      expect(isCrossPlatformMigration('win32', 'darwin')).toBe(true);
    });
  });
});
