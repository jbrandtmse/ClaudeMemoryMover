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
    files: ['**/*.{js,cjs,mjs}'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'eslint-rules/**'],
  },
);
