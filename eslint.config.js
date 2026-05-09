import tseslint from 'typescript-eslint';
import cmemmovPlugin from './eslint-rules/index.js';

export default tseslint.config(
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.eslint.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['src/**/*.ts'],
    plugins: { cmemmov: cmemmovPlugin },
    rules: {
      'cmemmov/no-process-env-home': 'error',
      'cmemmov/no-hardcoded-separator': 'error',
      'cmemmov/no-console-outside-output': 'error',
      'cmemmov/no-raw-json-parse': 'error',
    },
  },
  // Base block: applies fs-write + homedir restrictions to all src/**/*.ts.
  // Subsequent blocks below override this rule for specific files that
  // legitimately need one of the restricted imports.
  {
    files: ['src/**/*.ts'],
    ignores: ['src/**/*.test.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          {
            name: 'node:fs/promises',
            importNames: ['writeFile', 'rename', 'unlink', 'copyFile', 'rmdir', 'rm'],
            message: 'Direct fs write ops must go through WriteGate (src/services/write-gate.ts).',
          },
          {
            name: 'fs/promises',
            importNames: ['writeFile', 'rename', 'unlink', 'copyFile', 'rmdir', 'rm'],
            message: 'Direct fs write ops must go through WriteGate (src/services/write-gate.ts).',
          },
          {
            name: 'node:fs',
            importNames: ['writeFileSync', 'renameSync', 'unlinkSync', 'copyFileSync', 'rmdirSync', 'rmSync'],
            message: 'Direct fs write ops must go through WriteGate (src/services/write-gate.ts).',
          },
          {
            name: 'fs',
            importNames: ['writeFileSync', 'renameSync', 'unlinkSync', 'copyFileSync', 'rmdirSync', 'rmSync'],
            message: 'Direct fs write ops must go through WriteGate (src/services/write-gate.ts).',
          },
          {
            name: 'node:os',
            importNames: ['homedir'],
            message: 'os.homedir() must only be called in services/claude-locator.ts.',
          },
          {
            name: 'os',
            importNames: ['homedir'],
            message: 'os.homedir() must only be called in services/claude-locator.ts.',
          },
        ],
      }],
    },
  },
  // Override for write-gate.ts and backup-service.ts: they own atomic
  // filesystem operations and must be allowed to import fs-write functions.
  // The homedir restriction still applies to them.
  {
    files: ['src/services/write-gate.ts', 'src/services/backup-service.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          {
            name: 'node:os',
            importNames: ['homedir'],
            message: 'os.homedir() must only be called in services/claude-locator.ts.',
          },
          {
            name: 'os',
            importNames: ['homedir'],
            message: 'os.homedir() must only be called in services/claude-locator.ts.',
          },
        ],
      }],
    },
  },
  // Override for commands/export.ts: writes the export bundle artifact to a
  // user-supplied output path outside ~/.claude/. WriteGate is reserved for
  // writes to the user's Claude Code home; bundle output uses fs directly.
  // The homedir restriction still applies.
  {
    files: ['src/commands/export.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          {
            name: 'node:os',
            importNames: ['homedir'],
            message: 'os.homedir() must only be called in services/claude-locator.ts.',
          },
          {
            name: 'os',
            importNames: ['homedir'],
            message: 'os.homedir() must only be called in services/claude-locator.ts.',
          },
        ],
      }],
    },
  },
  // Override for claude-locator.ts: the only file allowed to call os.homedir().
  // The fs-write restriction still applies to it.
  {
    files: ['src/services/claude-locator.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          {
            name: 'node:fs/promises',
            importNames: ['writeFile', 'rename', 'unlink', 'copyFile', 'rmdir', 'rm'],
            message: 'Direct fs write ops must go through WriteGate (src/services/write-gate.ts).',
          },
          {
            name: 'fs/promises',
            importNames: ['writeFile', 'rename', 'unlink', 'copyFile', 'rmdir', 'rm'],
            message: 'Direct fs write ops must go through WriteGate (src/services/write-gate.ts).',
          },
          {
            name: 'node:fs',
            importNames: ['writeFileSync', 'renameSync', 'unlinkSync', 'copyFileSync', 'rmdirSync', 'rmSync'],
            message: 'Direct fs write ops must go through WriteGate (src/services/write-gate.ts).',
          },
          {
            name: 'fs',
            importNames: ['writeFileSync', 'renameSync', 'unlinkSync', 'copyFileSync', 'rmdirSync', 'rmSync'],
            message: 'Direct fs write ops must go through WriteGate (src/services/write-gate.ts).',
          },
        ],
      }],
    },
  },
  {
    files: ['**/*.{js,cjs,mjs}'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'eslint-rules/**'],
  },
);
