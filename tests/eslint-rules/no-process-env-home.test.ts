import { describe, it } from 'vitest';
import { RuleTester } from 'eslint';
import rule from '../../eslint-rules/no-process-env-home.js';

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

describe('no-process-env-home', () => {
  it('passes valid code and fails invalid code', () => {
    tester.run('no-process-env-home', rule as Parameters<typeof tester.run>[1], {
      valid: [
        { code: 'import os from "node:os"; const h = os.homedir();' },
        { code: 'const x = process.env.PATH;' },
      ],
      invalid: [
        {
          code: 'const h = process.env.HOME;',
          errors: [{ messageId: 'useOsHomedir' }],
        },
        {
          code: "const h = process.env['HOME'];",
          errors: [{ messageId: 'useOsHomedir' }],
        },
      ],
    });
  });
});
