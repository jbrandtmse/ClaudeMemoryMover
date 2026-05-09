import type { MockInstance } from 'vitest';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CmemmovError } from '../core/error.js';
import { Output, type OutputResult } from './output.js';

type WriteFn = (chunk: string | Uint8Array) => boolean;

describe('Output', () => {
  let stdoutSpy: MockInstance<WriteFn>;
  let stderrSpy: MockInstance<WriteFn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, 'write');
    stdoutSpy.mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, 'write');
    stderrSpy.mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('human mode', () => {
    it('progress writes to stderr only', () => {
      const out = new Output('export', { json: false });
      out.progress('Reading...');
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Reading...'));
      expect(stdoutSpy).not.toHaveBeenCalled();
    });

    it('warn writes a colored warning to stderr immediately', () => {
      const out = new Output('export');
      out.warn('disk almost full');
      expect(stderrSpy).toHaveBeenCalledTimes(1);
      const written = (stderrSpy.mock.calls[0] as [string])[0];
      expect(written).toContain('disk almost full');
      expect(stdoutSpy).not.toHaveBeenCalled();
    });

    it('error writes structured details to stderr (code, file, operation, hint)', () => {
      const out = new Output('export', { json: false });
      out.error(
        new CmemmovError({
          code: 'BACKUP_FAILED',
          file: '/tmp/x',
          operation: 'backup',
          hint: 'check write permissions',
        }),
      );
      expect(stderrSpy).toHaveBeenCalledTimes(1);
      const written = (stderrSpy.mock.calls[0] as [string])[0];
      expect(written).toContain('[BACKUP_FAILED]');
      expect(written).toContain('/tmp/x');
      expect(written).toContain('backup');
      expect(written).toContain('check write permissions');
      expect(stdoutSpy).not.toHaveBeenCalled();
    });

    it('finish writes exactly one line to stdout in human mode', () => {
      const out = new Output('export', { json: false });
      out.finish('Done!');
      expect(stdoutSpy).toHaveBeenCalledTimes(1);
      const raw = (stdoutSpy.mock.calls[0] as [string])[0];
      expect(raw).toContain('Done!');
    });

    it('progress goes to stderr and finish goes to stdout — no interleaving', () => {
      const out = new Output('export', { json: false });
      out.progress('Reading bundle...');
      out.progress('Writing files...');
      out.finish('Imported 3 categories');
      expect(stderrSpy).toHaveBeenCalledTimes(2);
      expect(stdoutSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('json mode', () => {
    it('finish emits a single JSON object on stdout with the expected shape', () => {
      const out = new Output('export', { json: true });
      out.finish('Exported 3 projects', true);
      expect(stdoutSpy).toHaveBeenCalledTimes(1);
      const raw = (stdoutSpy.mock.calls[0] as [string])[0];
      const parsed = JSON.parse(raw) as OutputResult;
      expect(parsed.success).toBe(true);
      expect(parsed.command).toBe('export');
      expect(parsed.summary).toBe('Exported 3 projects');
      expect(parsed.errors).toEqual([]);
      expect(parsed.warnings).toEqual([]);
    });

    it('finish with success=false reflects in the JSON', () => {
      const out = new Output('import', { json: true });
      out.finish('Failed', false);
      const parsed = JSON.parse((stdoutSpy.mock.calls[0] as [string])[0]) as OutputResult;
      expect(parsed.success).toBe(false);
    });

    it('error is buffered (NOT printed to stderr) and surfaces in json errors[]', () => {
      const out = new Output('export', { json: true });
      out.error(
        new CmemmovError({
          code: 'BACKUP_FAILED',
          file: '/tmp/x',
          operation: 'backup',
          hint: 'check write permissions',
        }),
      );
      expect(stderrSpy).not.toHaveBeenCalled();
      out.finish('Bundle write failed', false);
      const parsed = JSON.parse((stdoutSpy.mock.calls[0] as [string])[0]) as OutputResult;
      expect(parsed.errors).toHaveLength(1);
      expect(parsed.errors[0]).toEqual({
        code: 'BACKUP_FAILED',
        file: '/tmp/x',
        operation: 'backup',
        hint: 'check write permissions',
      });
    });

    it('error in json mode omits undefined optional fields', () => {
      const out = new Output('export', { json: true });
      out.error(new CmemmovError({ code: 'INTERNAL' }));
      out.finish('failed', false);
      const parsed = JSON.parse((stdoutSpy.mock.calls[0] as [string])[0]) as OutputResult;
      const record = parsed.errors[0];
      expect(record).toBeDefined();
      expect(record).toEqual({ code: 'INTERNAL' });
      expect(Object.keys(record ?? {})).toEqual(['code']);
    });

    it('warn writes immediately to stderr AND is included in json warnings[]', () => {
      const out = new Output('export', { json: true });
      out.warn('partial result');
      expect(stderrSpy).toHaveBeenCalledTimes(1);
      out.finish('done');
      const parsed = JSON.parse((stdoutSpy.mock.calls[0] as [string])[0]) as OutputResult;
      expect(parsed.warnings).toEqual(['partial result']);
    });

    it('finish writes exactly once to stdout per call', () => {
      const out = new Output('export', { json: true });
      out.finish('done');
      expect(stdoutSpy).toHaveBeenCalledTimes(1);
    });

    it('json output never interleaves: progress goes to stderr, json blob to stdout once', () => {
      const out = new Output('export', { json: true });
      out.progress('reading');
      out.progress('parsing');
      out.warn('skipped one entry');
      out.finish('done');
      expect(stdoutSpy).toHaveBeenCalledTimes(1);
      const raw = (stdoutSpy.mock.calls[0] as [string])[0];
      // verify it parses as a single JSON object
      const parsed = JSON.parse(raw) as OutputResult;
      expect(parsed.command).toBe('export');
    });
  });

  describe('default options', () => {
    it('defaults to human mode when json is omitted', () => {
      const out = new Output('export');
      out.finish('hi');
      const raw = (stdoutSpy.mock.calls[0] as [string])[0];
      // human mode emits the raw summary, not JSON
      expect(() => JSON.parse(raw) as unknown).toThrow();
      expect(raw).toContain('hi');
    });

    it('defaults success to true when omitted', () => {
      const out = new Output('export', { json: true });
      out.finish('done');
      const parsed = JSON.parse((stdoutSpy.mock.calls[0] as [string])[0]) as OutputResult;
      expect(parsed.success).toBe(true);
    });
  });
});
