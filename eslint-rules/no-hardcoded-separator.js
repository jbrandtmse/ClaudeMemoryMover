/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow hardcoded path separators; use path.sep, path.join, or path.resolve.' },
    messages: {
      usePathApi:
        "Hardcoded path separator '{{sep}}' detected. Use path.sep, path.join(), or path.resolve() instead.",
    },
    schema: [],
  },
  create(context) {
    return {
      Literal(node) {
        if (node.value === '/' || node.value === '\\') {
          context.report({
            node,
            messageId: 'usePathApi',
            data: { sep: String(node.value) },
          });
        }
      },
    };
  },
};
