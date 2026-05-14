import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts', 'scripts/**/*.test.mjs'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      thresholds: {
        lines: 80,
        'src/core/path-engine.ts': {
          lines: 100,
          branches: 100,
        },
        'src/core/bundle-schema.ts': {
          lines: 100,
        },
        'src/services/bundle-parser.ts': {
          lines: 100,
        },
        'src/core/sanitization-rules.ts': {
          lines: 100,
          branches: 100,
        },
      },
    },
  },
});
