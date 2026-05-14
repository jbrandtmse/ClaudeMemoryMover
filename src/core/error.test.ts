import { describe, it, expect } from 'vitest';
import { CmemmovError } from './error.js';

describe('CmemmovError', () => {
  describe('constructor options', () => {
    it('captures code on the instance', () => {
      const err = new CmemmovError({ code: 'INTERNAL' });
      expect(err.code).toBe('INTERNAL');
    });

    it('captures file when provided', () => {
      const err = new CmemmovError({ code: 'BACKUP_FAILED', file: '/tmp/x' });
      expect(err.file).toBe('/tmp/x');
    });

    it('leaves file undefined when not provided', () => {
      const err = new CmemmovError({ code: 'INTERNAL' });
      expect(err.file).toBeUndefined();
    });

    it('captures operation when provided', () => {
      const err = new CmemmovError({ code: 'BACKUP_FAILED', operation: 'backup' });
      expect(err.operation).toBe('backup');
    });

    it('captures hint when provided', () => {
      const err = new CmemmovError({
        code: 'BACKUP_FAILED',
        hint: 'check write permissions',
      });
      expect(err.hint).toBe('check write permissions');
    });

    it('captures cause when provided (forwarded to Error base)', () => {
      const root = new Error('underlying');
      const err = new CmemmovError({ code: 'BACKUP_FAILED', cause: root });
      expect(err.cause).toBe(root);
    });

    it('exposes all fields together as readonly when full options are provided (AC 4)', () => {
      const original = new Error('disk full');
      const err = new CmemmovError({
        code: 'BACKUP_FAILED',
        file: '/path',
        operation: 'backup',
        hint: 'check write permissions',
        cause: original,
      });
      expect(err.code).toBe('BACKUP_FAILED');
      expect(err.file).toBe('/path');
      expect(err.operation).toBe('backup');
      expect(err.hint).toBe('check write permissions');
      expect(err.cause).toBe(original);
      expect(err.exitCode).toBe(2);
    });
  });

  describe('exitCode mapping', () => {
    it('maps IMPORT_PARTIAL to exit code 1 (partial success)', () => {
      const err = new CmemmovError({ code: 'IMPORT_PARTIAL' });
      expect(err.exitCode).toBe(1);
    });

    it('maps EXPORT_NOTHING_SELECTED to exit code 1 (partial success)', () => {
      const err = new CmemmovError({ code: 'EXPORT_NOTHING_SELECTED' });
      expect(err.exitCode).toBe(1);
    });

    it('maps FIXPATHS_NO_PROJECTS to exit code 1 (partial success)', () => {
      const err = new CmemmovError({ code: 'FIXPATHS_NO_PROJECTS' });
      expect(err.exitCode).toBe(1);
    });

    it('maps BUNDLE_INVALID_SCHEMA to exit code 2 (fatal)', () => {
      const err = new CmemmovError({ code: 'BUNDLE_INVALID_SCHEMA' });
      expect(err.exitCode).toBe(2);
    });

    it('maps BACKUP_FAILED to exit code 2 (fatal)', () => {
      const err = new CmemmovError({ code: 'BACKUP_FAILED' });
      expect(err.exitCode).toBe(2);
    });

    it('maps INTERNAL to exit code 2 (fatal)', () => {
      const err = new CmemmovError({ code: 'INTERNAL' });
      expect(err.exitCode).toBe(2);
    });
  });

  describe('inheritance and identity', () => {
    it('is an instance of CmemmovError', () => {
      const err = new CmemmovError({ code: 'INTERNAL' });
      expect(err).toBeInstanceOf(CmemmovError);
    });

    it('is an instance of Error', () => {
      const err = new CmemmovError({ code: 'INTERNAL' });
      expect(err).toBeInstanceOf(Error);
    });

    it('sets the name to "CmemmovError"', () => {
      const err = new CmemmovError({ code: 'INTERNAL' });
      expect(err.name).toBe('CmemmovError');
    });
  });

  describe('SHARE_INVALID_SOURCE', () => {
    it('maps SHARE_INVALID_SOURCE to exit code 2 (fatal)', () => {
      const err = new CmemmovError({ code: 'SHARE_INVALID_SOURCE' });
      expect(err.exitCode).toBe(2);
    });

    it('captures hint for SHARE_INVALID_SOURCE', () => {
      const err = new CmemmovError({
        code: 'SHARE_INVALID_SOURCE',
        hint: '--include-credentials is not supported by share (NFR6)',
      });
      expect(err.hint).toBe('--include-credentials is not supported by share (NFR6)');
      expect(err.exitCode).toBe(2);
    });
  });

  describe('message formatting', () => {
    it('includes the error code in the message', () => {
      const err = new CmemmovError({ code: 'BACKUP_FAILED' });
      expect(err.message).toContain('BACKUP_FAILED');
    });

    it('includes the operation when provided', () => {
      const err = new CmemmovError({ code: 'BACKUP_FAILED', operation: 'backup' });
      expect(err.message).toContain('backup');
    });

    it('includes the file when provided', () => {
      const err = new CmemmovError({ code: 'BACKUP_FAILED', file: '/tmp/x' });
      expect(err.message).toContain('/tmp/x');
    });

    it('includes the hint when provided', () => {
      const err = new CmemmovError({ code: 'BACKUP_FAILED', hint: 'try again' });
      expect(err.message).toContain('try again');
    });
  });
});
