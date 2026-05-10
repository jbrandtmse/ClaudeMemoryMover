const BANNED_IDENTIFIERS = new Set(['log', 'error', 'warn', 'info', 'debug', 'trace', 'table', 'dir']);
const ALLOWED_SUFFIX = ['src/ui/output.ts', 'src\\ui\\output.ts'];

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Restrict console.* and process.stdout/stderr writes to src/ui/output.ts.' },
    messages: {
      useOutputModule:
        'Direct console/process stream writes are banned outside src/ui/output.ts. Use the Output module.',
    },
    schema: [],
  },
  create(context) {
    const filename = context.filename ?? context.getFilename();
    if (ALLOWED_SUFFIX.some((s) => filename.endsWith(s))) return {};

    return {
      CallExpression(node) {
        const callee = node.callee;

        // console.log / console.error / console.warn
        if (
          callee.type === 'MemberExpression' &&
          callee.object.type === 'Identifier' &&
          callee.object.name === 'console' &&
          callee.property.type === 'Identifier' &&
          BANNED_IDENTIFIERS.has(callee.property.name)
        ) {
          context.report({ node, messageId: 'useOutputModule' });
          return;
        }

        // process.stdout.write / process.stderr.write
        if (
          callee.type === 'MemberExpression' &&
          callee.object.type === 'MemberExpression' &&
          callee.object.object.type === 'Identifier' &&
          callee.object.object.name === 'process' &&
          callee.object.property.type === 'Identifier' &&
          (callee.object.property.name === 'stdout' || callee.object.property.name === 'stderr') &&
          callee.property.type === 'Identifier' &&
          callee.property.name === 'write'
        ) {
          context.report({ node, messageId: 'useOutputModule' });
        }
      },
    };
  },
};
