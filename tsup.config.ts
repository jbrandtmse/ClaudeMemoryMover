import { defineConfig } from 'tsup';

// Two builds:
//   1) Default `cmemmov` entry — chunked output for `npm install -g cmemmov`.
//      tsup defaults emit `dist/cmemmov.js` + dynamic-import chunks for the
//      `await import('./commands/*.js')` lazy-loaded subcommands.
//   2) `cmemmov-bundled` entry — single-file output for the Node SEA build
//      (Story 5.2). `splitting: false` + esbuild's static analysis of
//      relative dynamic imports inlines every command module into one file
//      at `dist/cmemmov-bundled.js`. Node SEA needs ONE js file; multi-file
//      SEA is not supported as of Node 22.
//
// Why two configs (array form) instead of two entries in one config:
// `splitting` is a per-config flag in tsup, so the only way to keep entry 1
// chunked AND entry 2 single-file is two sibling config objects. `clean` is
// set on the first config only so the second build doesn't wipe entry 1's
// output.
export default defineConfig([
  {
    entry: { cmemmov: 'src/cli.ts' },
    format: ['esm'],
    dts: true,
    clean: true,
    outDir: 'dist',
    banner: {
      js: '#!/usr/bin/env node',
    },
    target: 'node22',
  },
  {
    // CJS format intentional: Node 22 SEA only supports `mainFormat:
    // "commonjs"` (the `"module"` option lands in Node 23+; we still target
    // Node 22 per package.json engines). Bundling the ESM source down to a
    // single CJS file at SEA-build time keeps the runtime invariant —
    // `import pc from 'picocolors'` becomes `require('picocolors')` inside
    // the bundle. The npm-installed `dist/cmemmov.js` entry stays ESM
    // (chunked output, see config #1 above); only the SEA entry is CJS.
    // The SEA entry uses `src/cli-sea.ts` (a thin wrapper that always
    // invokes main()), not `src/cli.ts`. cli.ts has an `import.meta.url`
    // self-execute guard that does not survive ESM → CJS bundling: tsup
    // emits `var import_meta = {}` as a polyfill, so `import.meta.url` is
    // undefined and `fileURLToPath(undefined)` throws ERR_INVALID_ARG_TYPE.
    // The binary's only purpose is to be the CLI; the guard is unnecessary.
    entry: { 'cmemmov-bundled': 'src/cli-sea.ts' },
    format: ['cjs'],
    dts: false,
    clean: false,
    splitting: false,
    // `noExternal: [/.*/]` inlines EVERY npm dependency into the bundle.
    // SEA's embedded `require()` only resolves Node built-ins (`fs`,
    // `path`, etc.); external npm modules fail with ERR_UNKNOWN_BUILTIN_MODULE
    // because no `node_modules` directory sits next to the embedded blob.
    // The npm-installed `dist/cmemmov.js` entry (config #1 above) leaves
    // deps as runtime imports — only this SEA entry needs full inlining.
    noExternal: [/.*/],
    outDir: 'dist',
    banner: {
      js: '#!/usr/bin/env node',
    },
    target: 'node22',
  },
]);
