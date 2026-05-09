import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'node:os';
import { join } from 'node:path';
import { locateClaude } from './claude-locator.js';

describe('locateClaude', () => {
  const originalEnv = process.env.CLAUDE_CONFIG_DIR;

  beforeEach(() => {
    delete process.env.CLAUDE_CONFIG_DIR;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.CLAUDE_CONFIG_DIR = originalEnv;
    } else {
      delete process.env.CLAUDE_CONFIG_DIR;
    }
    vi.restoreAllMocks();
  });

  describe('default resolution (no CLAUDE_CONFIG_DIR)', () => {
    it('returns os.homedir() + .claude for claudeDir and + .claude.json for claudeJson', () => {
      const fakeHome = '/home/jordan';
      vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);

      const loc = locateClaude();
      expect(loc.claudeDir).toBe(join(fakeHome, '.claude'));
      expect(loc.claudeJson).toBe(join(fakeHome, '.claude.json'));
    });

    it('uses os.homedir() on win32-style home paths too', () => {
      const fakeHome = 'C:\\Users\\Jordan';
      vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);

      const loc = locateClaude();
      expect(loc.claudeDir).toBe(join(fakeHome, '.claude'));
      expect(loc.claudeJson).toBe(join(fakeHome, '.claude.json'));
    });

    it('treats an empty CLAUDE_CONFIG_DIR as unset (falls back to default)', () => {
      const fakeHome = '/home/jordan';
      vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
      process.env.CLAUDE_CONFIG_DIR = '';

      const loc = locateClaude();
      expect(loc.claudeDir).toBe(join(fakeHome, '.claude'));
      expect(loc.claudeJson).toBe(join(fakeHome, '.claude.json'));
    });
  });

  describe('CLAUDE_CONFIG_DIR override', () => {
    it('uses the env value as claudeDir and derives claudeJson by appending .json', () => {
      process.env.CLAUDE_CONFIG_DIR = '/custom/path';
      const loc = locateClaude();
      expect(loc.claudeDir).toBe('/custom/path');
      expect(loc.claudeJson).toBe('/custom/path.json');
    });

    it('does NOT call os.homedir() when CLAUDE_CONFIG_DIR is set', () => {
      const homedirSpy = vi.spyOn(os, 'homedir');
      process.env.CLAUDE_CONFIG_DIR = '/custom/path';

      locateClaude();
      expect(homedirSpy).not.toHaveBeenCalled();
    });

    it('keeps claudeJson as claudeDir + .json (regardless of trailing slash)', () => {
      // Verify the documented contract: CLAUDE_CONFIG_DIR=/foo => claudeJson=/foo.json
      process.env.CLAUDE_CONFIG_DIR = '/some/dir';
      const loc = locateClaude();
      expect(loc.claudeJson).toBe(loc.claudeDir + '.json');
    });

    it('handles a Windows-style absolute CLAUDE_CONFIG_DIR', () => {
      process.env.CLAUDE_CONFIG_DIR = 'D:\\claude-config';
      const loc = locateClaude();
      expect(loc.claudeDir).toBe('D:\\claude-config');
      expect(loc.claudeJson).toBe('D:\\claude-config.json');
    });
  });
});
