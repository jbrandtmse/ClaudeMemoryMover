import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      thresholds: {
        'src/core/path-engine.ts': {
          lines: 100,
          branches: 100,
        },
        'src/services/bundle-parser.ts': {
          lines: 100,
        },
      },
    },
  },
});
