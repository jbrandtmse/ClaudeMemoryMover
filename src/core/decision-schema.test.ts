import { describe, it, expect } from 'vitest';
import {
  ALL_CATEGORIES,
  FLAG_NAMES,
  type ClaudeCategory,
  type ExportDecision,
  type ImportDecision,
  type ImportMode,
  type RemapDecision,
  type RemapDecisions,
  type RemapOutcome,
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
      expect(FLAG_NAMES.output).toBe('--output');
      expect(FLAG_NAMES.allProjects).toBe('--all-projects');
      expect(FLAG_NAMES.projects).toBe('--projects');
      expect(FLAG_NAMES.projectPath).toBe('--project-path');
      expect(FLAG_NAMES.includeSessions).toBe('--include-sessions');
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
        allProjects: false,
        projects: [],
        projectPaths: {},
      } satisfies ExportDecision;
      expect(value.categories).toContain('globalMemory');
    });

    it('ImportDecision accepts a fully-populated value', () => {
      const value = {
        bundlePath: '/tmp/bundle.cmemmov.json',
        categories: ['projectMemory'],
        mode: 'merge' as ImportMode,
        overwriteCategories: [],
        dryRun: true,
        noIntegrityCheck: false,
        silent: false,
        json: true,
        remap: [],
      } satisfies ImportDecision;
      expect(value.mode).toBe('merge');
      expect(value.overwriteCategories).toEqual([]);
    });

    it('ImportDecision accepts overwriteCategories with category entries', () => {
      const value = {
        bundlePath: '/tmp/bundle.cmemmov.json',
        categories: ['globalMemory', 'globalSettings'],
        mode: 'merge' as ImportMode,
        overwriteCategories: ['globalSettings'] as ClaudeCategory[],
        dryRun: false,
        noIntegrityCheck: false,
        silent: true,
        json: false,
        remap: [],
      } satisfies ImportDecision;
      expect(value.overwriteCategories).toContain('globalSettings');
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

    it('ImportDecision accepts remap entries with lhs/rhs', () => {
      const value = {
        bundlePath: '/tmp/bundle.cmemmov.json',
        categories: ['projectMemory'],
        mode: 'merge' as ImportMode,
        overwriteCategories: [],
        dryRun: false,
        noIntegrityCheck: false,
        silent: true,
        json: false,
        remap: [{ lhs: 'C:\\Users\\maya', rhs: '/Users/maya' }],
      } satisfies ImportDecision;
      expect(value.remap[0]?.lhs).toBe('C:\\Users\\maya');
      expect(value.remap[0]?.rhs).toBe('/Users/maya');
    });

    it('ImportDecision accepts an empty remap array (default for same-OS)', () => {
      const value = {
        bundlePath: '/tmp/bundle.cmemmov.json',
        categories: [],
        mode: 'merge' as ImportMode,
        overwriteCategories: [],
        dryRun: false,
        noIntegrityCheck: false,
        silent: false,
        json: false,
        remap: [],
      } satisfies ImportDecision;
      expect(value.remap).toEqual([]);
    });
  });

  describe('RemapDecision/RemapDecisions/RemapOutcome', () => {
    it('RemapOutcome accepts every defined member', () => {
      const outcomes: RemapOutcome[] = [
        'auto-confirmed',
        'user-confirmed',
        'overridden',
        'skipped',
      ];
      expect(outcomes).toHaveLength(4);
    });

    it('RemapDecision accepts a fully-populated remapped value', () => {
      const value = {
        slug: '-home-u-proj-a',
        originalPath: 'C:\\Users\\maya\\proj-a',
        targetPath: '/Users/maya/proj-a',
        outcome: 'auto-confirmed',
      } satisfies RemapDecision;
      expect(value.outcome).toBe('auto-confirmed');
      expect(value.targetPath).toBe('/Users/maya/proj-a');
    });

    it('RemapDecision accepts targetPath: null when skipped', () => {
      const value = {
        slug: '-home-u-proj-a',
        originalPath: '/old/proj-a',
        targetPath: null,
        outcome: 'skipped',
      } satisfies RemapDecision;
      expect(value.targetPath).toBeNull();
    });

    it('RemapDecisions is an array of RemapDecision', () => {
      const value: RemapDecisions = [
        {
          slug: 'a',
          originalPath: '/a',
          targetPath: '/Users/u/a',
          outcome: 'overridden',
        },
        {
          slug: 'b',
          originalPath: '/b',
          targetPath: null,
          outcome: 'skipped',
        },
      ];
      expect(value).toHaveLength(2);
      expect(value[0]?.outcome).toBe('overridden');
    });
  });
});
