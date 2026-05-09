import { describe, it, expect } from 'vitest';
import {
  ALL_CATEGORIES,
  FLAG_NAMES,
  type ClaudeCategory,
  type ExportDecision,
  type ImportDecision,
  type ImportMode,
  type RollbackDecision,
} from './decision-schema.js';

describe('decision-schema', () => {
  describe('ALL_CATEGORIES', () => {
    it('contains exactly 10 entries', () => {
      expect(ALL_CATEGORIES).toHaveLength(10);
    });

    it('contains every expected ClaudeCategory member exactly once', () => {
      const expected: ClaudeCategory[] = [
        'globalMemory',
        'projectMemory',
        'globalSettings',
        'projectSettings',
        'claudeMd',
        'mcpConfig',
        'customCommands',
        'teams',
        'plugins',
        'sessionHistory',
      ];
      expect([...ALL_CATEGORIES].sort()).toEqual([...expected].sort());
      expect(new Set(ALL_CATEGORIES).size).toBe(ALL_CATEGORIES.length);
    });

    it('every entry is a valid ClaudeCategory (type-level satisfies check)', () => {
      const _check = ALL_CATEGORIES satisfies readonly ClaudeCategory[];
      expect(_check).toBe(ALL_CATEGORIES);
    });
  });

  describe('FLAG_NAMES', () => {
    it('maps every decision option to its CLI flag', () => {
      expect(FLAG_NAMES.categories).toBe('--categories');
      expect(FLAG_NAMES.includeCredentials).toBe('--include-credentials');
      expect(FLAG_NAMES.mode).toBe('--mode');
      expect(FLAG_NAMES.dryRun).toBe('--dry-run');
      expect(FLAG_NAMES.noIntegrityCheck).toBe('--no-integrity-check');
      expect(FLAG_NAMES.backupPath).toBe('--backup');
      expect(FLAG_NAMES.force).toBe('--force');
    });
  });

  describe('Decision interfaces (structural soundness)', () => {
    it('ExportDecision accepts a fully-populated value', () => {
      const value = {
        categories: ['globalMemory'],
        includeCredentials: false,
        outputPath: '/tmp/out.cmemmov.json',
        silent: false,
        json: false,
      } satisfies ExportDecision;
      expect(value.categories).toContain('globalMemory');
    });

    it('ImportDecision accepts a fully-populated value', () => {
      const value = {
        bundlePath: '/tmp/bundle.cmemmov.json',
        categories: ['projectMemory'],
        mode: 'merge' as ImportMode,
        dryRun: true,
        noIntegrityCheck: false,
        silent: false,
        json: true,
      } satisfies ImportDecision;
      expect(value.mode).toBe('merge');
    });

    it('RollbackDecision accepts both backupPath defined and undefined', () => {
      const withPath = {
        backupPath: '/tmp/.cmemmov-backups/2026-05-09T12-00-00Z',
        dryRun: false,
        silent: false,
        json: false,
      } satisfies RollbackDecision;
      const withoutPath = {
        backupPath: undefined,
        dryRun: false,
        silent: true,
        json: false,
      } satisfies RollbackDecision;
      expect(withPath.backupPath).toBeDefined();
      expect(withoutPath.backupPath).toBeUndefined();
    });

    it('ImportMode is the union "merge" | "overwrite"', () => {
      const merge: ImportMode = 'merge';
      const overwrite: ImportMode = 'overwrite';
      expect([merge, overwrite]).toEqual(['merge', 'overwrite']);
    });
  });
});
