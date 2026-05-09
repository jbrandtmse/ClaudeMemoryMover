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
  {
    files: ['src/**/*.ts'],
    ignores: [
      'src/services/write-gate.ts',
      'src/services/backup-service.ts',
      'src/**/*.test.ts',
    ],
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
