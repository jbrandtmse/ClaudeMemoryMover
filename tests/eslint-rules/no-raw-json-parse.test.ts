import { describe, it } from 'vitest';
import { RuleTester } from 'eslint';
import rule from '../../eslint-rules/no-raw-json-parse.js';

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

describe('no-raw-json-parse', () => {
  it('allows JSON.parse in bundle-parser.ts only', () => {
    tester.run('no-raw-json-parse', rule as Parameters<typeof tester.run>[1], {
      valid: [
        { code: 'const x = JSON.parse(text);', filename: 'src/services/bundle-parser.ts' },
        { code: 'const x = JSON.stringify(obj);', filename: 'src/commands/export.ts' },
      ],
      invalid: [
        {
          code: 'const x = JSON.parse(bundleText);',
          filename: 'src/commands/import.ts',
          errors: [{ messageId: 'useBundleParser' }],
        },
        {
          code: 'const data = JSON.parse(fs.readFileSync(path, "utf8"));',
          filename: 'src/core/bundle-schema.ts',
          errors: [{ messageId: 'useBundleParser' }],
        },
      ],
    });
  });
});
