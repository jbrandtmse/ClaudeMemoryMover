// Unit tests for the SEA build script's pure helpers. The shell-out steps
// (codesign, postject, --experimental-sea-config) are NOT mocked — they
// belong in the integration test (build-binary.integration.test.mjs) which
// runs the real pipeline on the host runner. Mocking those would add no
// value and would couple this test to esbuild/Node SEA internals.

import { describe, it, expect } from 'vitest';
import {
  SUPPORTED_TARGETS,
  validatePlatform,
  binaryOutputPath,
} from './build-binary.mjs';

describe('build-binary — SUPPORTED_TARGETS contract', () => {
  it('exposes exactly the four documented targets', () => {
    expect(Object.keys(SUPPORTED_TARGETS).sort()).toEqual(
      ['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-x64'].sort(),
    );
  });

  it('every target has the expected shape (outputBase, ext, macho)', () => {
    for (const [key, target] of Object.entries(SUPPORTED_TARGETS)) {
      expect(target, `target ${key}`).toHaveProperty('outputBase');
      expect(target, `target ${key}`).toHaveProperty('ext');
      expect(target, `target ${key}`).toHaveProperty('macho');
      expect(typeof target.outputBase).toBe('string');
      expect(typeof target.ext).toBe('string');
      expect(typeof target.macho).toBe('boolean');
    }
  });

  it('darwin targets are macho:true; others are macho:false', () => {
    expect(SUPPORTED_TARGETS['darwin-arm64'].macho).toBe(true);
    expect(SUPPORTED_TARGETS['darwin-x64'].macho).toBe(true);
    expect(SUPPORTED_TARGETS['win32-x64'].macho).toBe(false);
    expect(SUPPORTED_TARGETS['linux-x64'].macho).toBe(false);
  });

  it('win32 target has .exe extension; others have empty ext', () => {
    expect(SUPPORTED_TARGETS['win32-x64'].ext).toBe('.exe');
    expect(SUPPORTED_TARGETS['darwin-arm64'].ext).toBe('');
    expect(SUPPORTED_TARGETS['darwin-x64'].ext).toBe('');
    expect(SUPPORTED_TARGETS['linux-x64'].ext).toBe('');
  });

  it('SUPPORTED_TARGETS is frozen (single-source-of-truth invariant)', () => {
    expect(Object.isFrozen(SUPPORTED_TARGETS)).toBe(true);
  });
});

describe('build-binary — validatePlatform (AC9)', () => {
  it.each([
    ['win32', 'x64'],
    ['darwin', 'arm64'],
    ['darwin', 'x64'],
    ['linux', 'x64'],
  ])('accepts %s-%s', (platform, arch) => {
    expect(() => validatePlatform(platform, arch)).not.toThrow();
    const target = validatePlatform(platform, arch);
    expect(target).toBe(SUPPORTED_TARGETS[`${platform}-${arch}`]);
  });

  it.each([
    ['linux', 'arm64'],
    ['linux', 'ia32'],
    ['win32', 'arm64'],
    ['darwin', 'ppc64'],
    ['aix', 'x64'],
    ['freebsd', 'x64'],
  ])('rejects unsupported host %s-%s', (platform, arch) => {
    expect(() => validatePlatform(platform, arch)).toThrowError(
      /Cross-platform binary build not supported/,
    );
  });

  it('error message names the actual host and lists all four supported targets', () => {
    try {
      validatePlatform('openbsd', 'mips');
      throw new Error('expected validatePlatform to throw');
    } catch (err) {
      const msg = err.message;
      // AC9 contract: message includes current host, all four targets, and
      // the CI-matrix pointer.
      expect(msg).toContain('Current host: openbsd-mips');
      expect(msg).toContain('win32-x64');
      expect(msg).toContain('darwin-arm64');
      expect(msg).toContain('darwin-x64');
      expect(msg).toContain('linux-x64');
      expect(msg).toContain('CI matrix on GitHub Actions');
    }
  });
});

describe('build-binary — binaryOutputPath (AC3)', () => {
  // AC3 specifies the exact output paths. These tests pin them so a typo
  // in `outputBase` or `ext` breaks the build at unit-test time, not after
  // a 30-second SEA build on each of four CI runners.
  it.each([
    ['win32', 'x64', 'cmemmov-windows-x64.exe'],
    ['darwin', 'arm64', 'cmemmov-macos-arm64'],
    ['darwin', 'x64', 'cmemmov-macos-x64'],
    ['linux', 'x64', 'cmemmov-linux-x64'],
  ])('%s-%s → ...dist/binaries/%s', (platform, arch, expectedBasename) => {
    const out = binaryOutputPath(platform, arch);
    // path.join uses native separators; normalize to forward slashes for
    // a stable cross-platform assertion.
    const normalized = out.replace(/\\/g, '/');
    expect(normalized).toMatch(/dist\/binaries\/[^/]+$/);
    expect(normalized.endsWith(`dist/binaries/${expectedBasename}`)).toBe(true);
  });

  it('inherits AC9 rejection for unsupported platforms', () => {
    expect(() => binaryOutputPath('linux', 'arm64')).toThrowError(
      /Cross-platform binary build not supported/,
    );
  });
});
