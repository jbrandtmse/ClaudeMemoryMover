import { describe, it } from 'vitest';
import { RuleTester } from 'eslint';
import rule from '../../eslint-rules/no-console-outside-output.js';

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

describe('no-console-outside-output', () => {
  it('allows console in output.ts', () => {
    tester.run('no-console-outside-output', rule as Parameters<typeof tester.run>[1], {
      valid: [
        { code: 'console.log("hello");', filename: 'src/ui/output.ts' },
        { code: 'process.stdout.write("x");', filename: 'src/ui/output.ts' },
        { code: 'console.info("hello");', filename: 'src/ui/output.ts' },
        { code: 'console.debug("hello");', filename: 'src/ui/output.ts' },
      ],
      invalid: [
        {
          code: 'console.log("hello");',
          filename: 'src/commands/export.ts',
          errors: [{ messageId: 'useOutputModule' }],
        },
        {
          code: 'console.error("fail");',
          filename: 'src/core/error.ts',
          errors: [{ messageId: 'useOutputModule' }],
        },
        {
          code: 'process.stderr.write("x");',
          filename: 'src/services/write-gate.ts',
          errors: [{ messageId: 'useOutputModule' }],
        },
        // Newly banned identifiers (Story 3.0 expansion):
        {
          code: 'console.info("x");',
          filename: 'src/commands/import.ts',
          errors: [{ messageId: 'useOutputModule' }],
        },
        {
          code: 'console.debug("x");',
          filename: 'src/commands/import.ts',
          errors: [{ messageId: 'useOutputModule' }],
        },
        {
          code: 'console.trace("x");',
          filename: 'src/commands/import.ts',
          errors: [{ messageId: 'useOutputModule' }],
        },
        {
          code: 'console.table({ a: 1 });',
          filename: 'src/commands/import.ts',
          errors: [{ messageId: 'useOutputModule' }],
        },
        {
          code: 'console.dir({ a: 1 });',
          filename: 'src/commands/import.ts',
          errors: [{ messageId: 'useOutputModule' }],
        },
      ],
    });
  });
});
