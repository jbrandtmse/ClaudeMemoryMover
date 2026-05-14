import { describe, it, expect } from 'vitest';
import { ZodError } from 'zod';
import { BundleSchema, BUNDLE_FORMAT_VERSION } from './bundle-schema.js';
import validMinimal from '../../tests/fixtures/bundles/valid-minimal.json' with { type: 'json' };
import invalidMissingField from '../../tests/fixtures/bundles/invalid-missing-field.json' with { type: 'json' };
import invalidWrongType from '../../tests/fixtures/bundles/invalid-wrong-type.json' with { type: 'json' };
import invalidExtraField from '../../tests/fixtures/bundles/invalid-extra-field.json' with { type: 'json' };
import withCredentials from '../../tests/fixtures/bundles/with-credentials.json' with { type: 'json' };

describe('bundle-schema', () => {
  describe('BUNDLE_FORMAT_VERSION', () => {
    it('exposes the current bundle format version constant', () => {
      expect(BUNDLE_FORMAT_VERSION).toBe('1.1.0');
    });
  });

  describe('BundleSchema.parse', () => {
    it('accepts a valid minimal bundle and returns a typed bundle', () => {
      const parsed = BundleSchema.parse(validMinimal);
      expect(parsed.version).toBe('1.1.0');
      expect(parsed.sourcePlatform).toBe('linux');
      expect(parsed.projects).toHaveLength(1);
      expect(parsed.projects[0]?.slug).toBe('-home-user-myapp');
    });

    it('accepts a valid bundle with a populated credentials section', () => {
      const parsed = BundleSchema.parse(withCredentials);
      expect(parsed.hasCredentials).toBe(true);
      expect(parsed.credentials?.wasRedacted).toBe(false);
    });

    it('throws ZodError when a required field is missing and reports the failing path', () => {
      let caught: unknown;
      try {
        BundleSchema.parse(invalidMissingField);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ZodError);
      const zerr = caught as ZodError;
      expect(zerr.issues.some((i) => i.path.join('.') === 'version')).toBe(true);
    });

    it('throws ZodError when a field has the wrong type', () => {
      let caught: unknown;
      try {
        BundleSchema.parse(invalidWrongType);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ZodError);
      const zerr = caught as ZodError;
      expect(zerr.issues.some((i) => i.path.join('.') === 'hasCredentials')).toBe(true);
    });

    it('throws ZodError when an extra unrecognized field is present (strict mode)', () => {
      let caught: unknown;
      try {
        BundleSchema.parse(invalidExtraField);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ZodError);
      const zerr = caught as ZodError;
      expect(zerr.issues.some((i) => i.code === 'unrecognized_keys')).toBe(true);
    });

    it('throws ZodError when sourcePlatform is not one of the allowed values', () => {
      const bundle = { ...validMinimal, sourcePlatform: 'freebsd' };
      expect(() => BundleSchema.parse(bundle)).toThrow(ZodError);
    });

    it('throws ZodError when exportedAt is not a valid ISO 8601 datetime', () => {
      const bundle = { ...validMinimal, exportedAt: 'not-a-date' };
      expect(() => BundleSchema.parse(bundle)).toThrow(ZodError);
    });

    it('throws ZodError when a nested project has an extra unrecognized field (nested strict mode)', () => {
      const bundle = {
        ...validMinimal,
        projects: [
          {
            slug: '-home-user-myapp',
            originalPath: '/home/user/myapp',
            extraNestedField: 'oops',
          },
        ],
      };
      expect(() => BundleSchema.parse(bundle)).toThrow(ZodError);
    });
  });
});
