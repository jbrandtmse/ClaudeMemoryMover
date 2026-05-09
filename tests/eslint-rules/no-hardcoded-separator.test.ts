import { describe, it } from 'vitest';
import { RuleTester } from 'eslint';
import rule from '../../eslint-rules/no-hardcoded-separator.js';

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

describe('no-hardcoded-separator', () => {
  it('passes valid code and fails invalid code', () => {
    tester.run('no-hardcoded-separator', rule as Parameters<typeof tester.run>[1], {
      valid: [
        { code: 'import path from "node:path"; const p = path.join(a, b);' },
        { code: "const url = 'https://example.com/path';" },
        { code: "const re = /\\//;" },
      ],
      invalid: [
        {
          code: "const sep = '/';",
          errors: [{ messageId: 'usePathApi' }],
        },
        {
          code: "const sep = '\\\\';",
          errors: [{ messageId: 'usePathApi' }],
        },
      ],
    });
  });
});
