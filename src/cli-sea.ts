// Entry point for the Node SEA single-executable binary (Story 5.2).
//
// The default `src/cli.ts` entry uses an ESM-only `import.meta.url` guard
// to decide whether to auto-invoke `main()`. That guard does not survive
// the CJS bundle SEA requires on Node 22 (`import_meta.url` becomes
// `undefined`, which crashes `fileURLToPath()` at runtime). This wrapper
// always calls `main()` — the binary's ONLY purpose is to BE the CLI, so
// there is no "imported as a library" branch to protect against.
import { main } from './cli.js';

void main();
