export interface PlatformMock {
  restore(): void;
}

/**
 * Override `process.platform` for the duration of a test so that
 * `isCrossPlatformMigration(bundle.sourcePlatform, process.platform)` and any
 * other code that branches on the current OS sees the mocked target value.
 *
 * NOTE — `os.homedir()` is intentionally NOT mocked here. `import.ts` derives
 * the homedir as `dirname(claudeDir)` where `claudeDir` comes from
 * `locateClaude()` which reads `CLAUDE_CONFIG_DIR`. So tests control homedir
 * via that env var; the platform mock only flips `process.platform`. Mocking
 * `os.homedir()` would also break `claude-locator` for callers that don't set
 * `CLAUDE_CONFIG_DIR`, which is why we limit the mock surface here.
 */
export function mockPlatform(platform: NodeJS.Platform): PlatformMock {
  const originalDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', {
    configurable: true,
    get: () => platform,
  });
  return {
    restore() {
      if (originalDescriptor !== undefined) {
        Object.defineProperty(process, 'platform', originalDescriptor);
      } else {
        delete (process as unknown as Record<string, unknown>).platform;
      }
    },
  };
}
