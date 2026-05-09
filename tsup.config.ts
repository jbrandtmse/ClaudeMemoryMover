import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { cmemmov: 'src/cli.ts' },
  format: ['esm'],
  dts: true,
  clean: true,
  outDir: 'dist',
  banner: {
    js: '#!/usr/bin/env node',
  },
  target: 'node22',
});
