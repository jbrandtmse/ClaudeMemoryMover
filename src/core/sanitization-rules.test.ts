import { describe, it, expect } from 'vitest';
import { BundleSchema } from './bundle-schema.js';
import { applySanitization } from './sanitization-rules.js';
import validMinimal from '../../tests/fixtures/bundles/valid-minimal.json' with { type: 'json' };
import withCredentials from '../../tests/fixtures/bundles/with-credentials.json' with { type: 'json' };

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
