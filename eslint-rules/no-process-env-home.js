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
    // True when `node` is the `process.env` member-expression in either form:
    //   - `process.env`              (Identifier `env`)
    //   - `process['env']`           (Literal     'env')
    function isProcessEnv(node) {
      if (node.type !== 'MemberExpression') return false;
      if (node.object.type !== 'Identifier' || node.object.name !== 'process') return false;
      const prop = node.property;
      if (!node.computed && prop.type === 'Identifier' && prop.name === 'env') return true;
      if (node.computed && prop.type === 'Literal' && prop.value === 'env') return true;
      return false;
    }

    return {
      // process.env.HOME / process.env['HOME'] / process['env'].HOME / process['env']['HOME']
      MemberExpression(node) {
        if (!isProcessEnv(node.object)) return;
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
      },
      // const { HOME } = process.env;
      // const { HOME } = process['env'];
      VariableDeclarator(node) {
        if (node.id.type !== 'ObjectPattern') return;
        if (node.init === null || node.init === undefined) return;
        if (!isProcessEnv(node.init)) return;
        for (const prop of node.id.properties) {
          if (prop.type !== 'Property') continue;
          const key = prop.key;
          const name =
            !prop.computed && key.type === 'Identifier'
              ? key.name
              : key.type === 'Literal' && typeof key.value === 'string'
                ? key.value
                : null;
          if (name === 'HOME') {
            context.report({ node: prop, messageId: 'useOsHomedir' });
          }
        }
      },
    };
  },
};
