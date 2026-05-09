import { describe, it, expect, vi } from 'vitest';
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBundle } from './bundle-parser.js';
import { BundleSchema } from '../core/bundle-schema.js';
import { CmemmovError } from '../core/error.js';

const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'tests',
  'fixtures',
  'bundles',
);

function readFixture(name: string): Buffer {
  return readFileSync(join(FIXTURE_DIR, name));
}

describe('parseBundle', () => {
  describe('gzip detection (AC 2)', () => {
    it('parses a plain JSON bundle (no gzip magic bytes)', () => {
      const bytes = readFixture('valid-linux.cmemmov');
      const bundle = parseBundle(bytes);
      expect(bundle.sourcePlatform).toBe('linux');
      expect(bundle.projects).toHaveLength(1);
    });

    it('decompresses a gzipped bundle when first two bytes are 0x1f 0x8b', () => {
      const plain = readFixture('valid-linux.cmemmov');
      const gzipped = gzipSync(plain);
      expect(gzipped[0]).toBe(0x1f);
      expect(gzipped[1]).toBe(0x8b);
      const bundle = parseBundle(gzipped);
      expect(bundle.sourcePlatform).toBe('linux');
    });

    it('wraps a truncated/corrupt gzip stream as BUNDLE_INVALID_SCHEMA', () => {
      // Magic bytes present but trailing payload is not a valid gzip stream.
      const corruptGzip = Buffer.concat([
        Buffer.from([0x1f, 0x8b]),
        Buffer.from('not-actually-a-gzip-payload', 'utf8'),
      ]);
      try {
        parseBundle(corruptGzip);
        expect.fail('expected parseBundle to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(CmemmovError);
        const cmErr = err as CmemmovError;
        expect(cmErr.code).toBe('BUNDLE_INVALID_SCHEMA');
        expect(cmErr.exitCode).toBe(2);
        expect(cmErr.hint).toMatch(/gzip/i);
        expect(cmErr.cause).toBeDefined();
      }
    });
  });

  describe('JSON parse step (AC 1)', () => {
    it('throws BUNDLE_INVALID_SCHEMA with a "malformed" hint when JSON is invalid', () => {
      const bytes = Buffer.from('{ this is not json', 'utf8');
      try {
        parseBundle(bytes);
        expect.fail('expected parseBundle to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(CmemmovError);
        const cmErr = err as CmemmovError;
        expect(cmErr.code).toBe('BUNDLE_INVALID_SCHEMA');
        expect(cmErr.exitCode).toBe(2);
        expect(cmErr.hint).toMatch(/malformed/i);
        expect(cmErr.cause).toBeInstanceOf(SyntaxError);
      }
    });
  });

  describe('Zod validation step (AC 1)', () => {
    it('throws BUNDLE_INVALID_SCHEMA wrapping ZodError when bundle shape is wrong', () => {
      const notABundle = { not: 'a bundle' };
      const bytes = Buffer.from(JSON.stringify(notABundle), 'utf8');
      try {
        parseBundle(bytes);
        expect.fail('expected parseBundle to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(CmemmovError);
        const cmErr = err as CmemmovError;
        expect(cmErr.code).toBe('BUNDLE_INVALID_SCHEMA');
        expect(cmErr.exitCode).toBe(2);
        expect(cmErr.hint).toMatch(/schema validation failed/i);
        expect(cmErr.cause).toBeDefined();
      }
    });

    it('rethrows a non-ZodError thrown by BundleSchema.parse without wrapping (defensive branch)', () => {
      const spy = vi
        .spyOn(BundleSchema, 'parse')
        .mockImplementationOnce(() => {
          throw new Error('synthetic non-zod error');
        });

      try {
        const bytes = Buffer.from(JSON.stringify({ anything: 1 }), 'utf8');
        expect(() => parseBundle(bytes)).toThrow('synthetic non-zod error');
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('integrity check (AC 3)', () => {
    it('throws BUNDLE_CHECKSUM_MISMATCH when the embedded integrity does not match', () => {
      const bytes = readFixture('corrupted-checksum.cmemmov');
      try {
        parseBundle(bytes);
        expect.fail('expected parseBundle to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(CmemmovError);
        const cmErr = err as CmemmovError;
        expect(cmErr.code).toBe('BUNDLE_CHECKSUM_MISMATCH');
        expect(cmErr.exitCode).toBe(2);
        expect(cmErr.hint).toMatch(/no-integrity-check/i);
      }
    });

    it('warns instead of throwing when noIntegrityCheck is true', () => {
      const bytes = readFixture('corrupted-checksum.cmemmov');
      const warn = vi.fn();
      const bundle = parseBundle(bytes, { noIntegrityCheck: true, warn });
      expect(warn).toHaveBeenCalledTimes(1);
      const msg = warn.mock.calls[0]?.[0] as string;
      expect(msg).toMatch(/checksum mismatch/i);
      expect(bundle.sourcePlatform).toBe('linux');
    });

    it('passes through silently when integrity matches', () => {
      const bytes = readFixture('valid-linux.cmemmov');
      const warn = vi.fn();
      const bundle = parseBundle(bytes, { warn });
      expect(warn).not.toHaveBeenCalled();
      expect(bundle.integrity).toBeDefined();
    });

    it('skips the integrity check when integrity field is absent', () => {
      const bundleNoIntegrity = {
        version: '1.0.0',
        exportedAt: '2026-05-09T12:00:00.000Z',
        sourcePlatform: 'linux',
        claudeVersion: '2.1.133',
        hasCredentials: false,
        projects: [],
        global: {},
      };
      const bytes = Buffer.from(JSON.stringify(bundleNoIntegrity), 'utf8');
      const warn = vi.fn();
      const bundle = parseBundle(bytes, { warn });
      expect(bundle.integrity).toBeUndefined();
      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe('format-version handshake (AC 4)', () => {
    it('warns when bundle.version differs from BUNDLE_FORMAT_VERSION but does not throw', () => {
      const bytes = readFixture('older-bundle-version.cmemmov');
      const warn = vi.fn();
      const bundle = parseBundle(bytes, { warn });
      expect(bundle.version).toBe('0.9.0');
      expect(warn).toHaveBeenCalledTimes(1);
      const msg = warn.mock.calls[0]?.[0] as string;
      expect(msg).toMatch(/0\.9\.0/);
      expect(msg).toMatch(/1\.0\.0/);
    });

    it('does not warn when bundle.version matches BUNDLE_FORMAT_VERSION', () => {
      const bytes = readFixture('valid-linux.cmemmov');
      const warn = vi.fn();
      parseBundle(bytes, { warn });
      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe('default warn callback', () => {
    it('uses a no-op warn when none is provided (does not throw on version mismatch)', () => {
      const bytes = readFixture('older-bundle-version.cmemmov');
      expect(() => parseBundle(bytes)).not.toThrow();
    });

    it('uses a no-op warn when noIntegrityCheck is true and no warn provided', () => {
      const bytes = readFixture('corrupted-checksum.cmemmov');
      expect(() => parseBundle(bytes, { noIntegrityCheck: true })).not.toThrow();
    });
  });

  describe('platform variants', () => {
    it('parses a win32 bundle correctly', () => {
      const bytes = readFixture('valid-windows.cmemmov');
      const bundle = parseBundle(bytes);
      expect(bundle.sourcePlatform).toBe('win32');
      expect(bundle.projects[0]?.originalPath).toContain('Users');
    });
  });
});
