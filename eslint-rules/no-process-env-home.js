/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow process.env.HOME; use os.homedir() instead.' },
    messages: {
      useOsHomedir:
        'Use os.homedir() instead of process.env.HOME — process.env.HOME is unreliable on Windows.',
    },
    schema: [],
  },
  create(context) {
    return {
      MemberExpression(node) {
        if (
          node.object.type === 'MemberExpression' &&
          node.object.object.type === 'Identifier' &&
          node.object.object.name === 'process' &&
          node.object.property.type === 'Identifier' &&
          node.object.property.name === 'env'
        ) {
          const prop = node.property;
          const name =
            prop.type === 'Identifier'
              ? prop.name
              : prop.type === 'Literal' && typeof prop.value === 'string'
                ? prop.value
                : null;
          if (name === 'HOME') {
            context.report({ node, messageId: 'useOsHomedir' });
          }
        }
      },
    };
  },
};
