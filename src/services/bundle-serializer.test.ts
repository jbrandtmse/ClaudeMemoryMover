import { describe, it, expect } from 'vitest';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { serializeBundle } from './bundle-serializer.js';
import { parseBundle } from './bundle-parser.js';
import { BundleSchema, type Bundle } from '../core/bundle-schema.js';

function makeBundle(overrides: Partial<Bundle> = {}): Bundle {
  return BundleSchema.parse({
    version: '1.0.0',
    exportedAt: '2026-05-09T12:00:00.000Z',
    sourcePlatform: 'linux',
    claudeVersion: '2.1.133',
    hasCredentials: false,
    projects: [],
    global: {},
    ...overrides,
  });
}

describe('serializeBundle', () => {
  describe('plain JSON output (AC 5)', () => {
    it('produces indented plain JSON bytes for a small no-session bundle', () => {
      const bundle = makeBundle({
        projects: [
          {
            slug: '-home-user-myapp',
            originalPath: '/home/user/myapp',
            memories: [{ filename: 'MEMORY.md', content: '# Memory Index\n' }],
          },
        ],
      });

      const bytes = serializeBundle(bundle);
      // Not gzipped — first two bytes must NOT be 0x1f 0x8b.
      expect(bytes[0]).not.toBe(0x1f);
      const text = bytes.toString('utf8');
      // Indented: should contain at least one two-space indent line.
      expect(text).toMatch(/\n  "/);
      // Should be parseable as the bundle we put in (round-trip checked below).
      expect(text).toContain('"sourcePlatform": "linux"');
    });

    it('produces gzipped bytes when serialized size is >=5MB', () => {
      // Build a bundle whose serialized form exceeds 5MB without using sessions.
      const bigContent = 'x'.repeat(6 * 1024 * 1024);
      const bundle = makeBundle({
        projects: [
          {
            slug: '-home-user-myapp',
            originalPath: '/home/user/myapp',
            memories: [{ filename: 'big.md', content: bigContent }],
          },
        ],
      });

      const bytes = serializeBundle(bundle);
      expect(bytes[0]).toBe(0x1f);
      expect(bytes[1]).toBe(0x8b);
    });
  });

  describe('gzip output for bundles with sessions (AC 5)', () => {
    it('produces gzipped bytes when any project has a non-empty sessions array', () => {
      const bundle = makeBundle({
        projects: [
          {
            slug: '-home-user-myapp',
            originalPath: '/home/user/myapp',
            sessions: [{ filename: 'sess.jsonl', lines: ['{"role":"user"}'] }],
          },
        ],
      });

      const bytes = serializeBundle(bundle);
      expect(bytes[0]).toBe(0x1f);
      expect(bytes[1]).toBe(0x8b);
      // Sanity: gunzip yields valid JSON of the same bundle.
      const inflated = gunzipSync(bytes).toString('utf8');
      expect(inflated).toContain('"sessions"');
    });

    it('produces plain JSON when sessions array is present but empty', () => {
      const bundle = makeBundle({
        projects: [
          {
            slug: '-home-user-myapp',
            originalPath: '/home/user/myapp',
            sessions: [],
          },
        ],
      });

      const bytes = serializeBundle(bundle);
      expect(bytes[0]).not.toBe(0x1f);
    });
  });

  describe('integrity computation (AC 6)', () => {
    it('embeds a SHA256 hex string as bundle.integrity', () => {
      const bundle = makeBundle();
      const bytes = serializeBundle(bundle);
      const parsed = parseBundle(bytes);
      expect(parsed.integrity).toMatch(/^[0-9a-f]{64}$/);
    });

    it('computes the checksum over the canonical (no-integrity, compact) form', () => {
      const bundle = makeBundle({
        projects: [
          {
            slug: '-home-user-myapp',
            originalPath: '/home/user/myapp',
          },
        ],
      });
      const bytes = serializeBundle(bundle);
      const parsed = parseBundle(bytes);

      // Recompute canonical the same way the parser does.
      const rest: Omit<Bundle, 'integrity'> = { ...parsed };
      delete (rest as { integrity?: string }).integrity;
      const canonical = JSON.stringify(rest);
      const expected = createHash('sha256').update(canonical, 'utf8').digest('hex');
      expect(parsed.integrity).toBe(expected);
    });

    it('overwrites any pre-existing integrity field with a freshly computed one', () => {
      const bundle = makeBundle();
      const tampered: Bundle = { ...bundle, integrity: 'old-stale-checksum' };
      const bytes = serializeBundle(tampered);
      const parsed = parseBundle(bytes);
      expect(parsed.integrity).not.toBe('old-stale-checksum');
      expect(parsed.integrity).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('round-trip (AC 7)', () => {
    it('parseBundle(serializeBundle(bundle)) deep-equals the input for a plain bundle', () => {
      const bundle = makeBundle({
        projects: [
          {
            slug: '-home-user-myapp',
            originalPath: '/home/user/myapp',
            memories: [{ filename: 'MEMORY.md', content: '# index' }],
          },
        ],
        global: { settings: { model: 'sonnet' } },
      });

      const bytes = serializeBundle(bundle);
      const parsed = parseBundle(bytes);

      // The serializer adds an integrity field. Compare with that added.
      const expected: Bundle = { ...bundle, integrity: parsed.integrity };
      expect(parsed).toEqual(expected);
    });

    it('round-trips a session-bearing (gzipped) bundle', () => {
      const bundle = makeBundle({
        projects: [
          {
            slug: '-home-user-myapp',
            originalPath: '/home/user/myapp',
            sessions: [
              { filename: 'sess.jsonl', lines: ['{"a":1}', '{"a":2}'] },
            ],
          },
        ],
      });

      const bytes = serializeBundle(bundle);
      const parsed = parseBundle(bytes);
      const expected: Bundle = { ...bundle, integrity: parsed.integrity };
      expect(parsed).toEqual(expected);
    });

    it('round-trips a credentials-bearing bundle', () => {
      const bundle = makeBundle({
        hasCredentials: true,
        credentials: {
          content: { token: 'abc' },
          wasRedacted: false,
        },
      });

      const bytes = serializeBundle(bundle);
      const parsed = parseBundle(bytes);
      const expected: Bundle = { ...bundle, integrity: parsed.integrity };
      expect(parsed).toEqual(expected);
    });
  });
});
