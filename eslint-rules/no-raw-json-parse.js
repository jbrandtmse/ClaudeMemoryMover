const ALLOWED_SUFFIX = [
  'src/services/bundle-parser.ts',
  'src\\services\\bundle-parser.ts',
  'src/services/claude-reader.ts',
  'src\\services\\claude-reader.ts',
];

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Restrict JSON.parse of bundle bytes to src/services/bundle-parser.ts.' },
    messages: {
      useBundleParser:
        'JSON.parse of bundle bytes is banned outside src/services/bundle-parser.ts. Route parsing through the Zod schema.',
    },
    schema: [],
  },
  create(context) {
    const filename = context.filename ?? context.getFilename();
    if (ALLOWED_SUFFIX.some((s) => filename.endsWith(s))) return {};
    // Test files commonly parse stringified JSON for assertions; this is legitimate.
    if (filename.endsWith('.test.ts')) return {};

    return {
      CallExpression(node) {
        const callee = node.callee;
        if (
          callee.type === 'MemberExpression' &&
          callee.object.type === 'Identifier' &&
          callee.object.name === 'JSON' &&
          callee.property.type === 'Identifier' &&
          callee.property.name === 'parse'
        ) {
          context.report({ node, messageId: 'useBundleParser' });
        }
      },
    };
  },
};
