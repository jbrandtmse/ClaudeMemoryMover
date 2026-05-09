import noProcessEnvHome from './no-process-env-home.js';
import noHardcodedSeparator from './no-hardcoded-separator.js';
import noConsoleOutsideOutput from './no-console-outside-output.js';
import noRawJsonParse from './no-raw-json-parse.js';

/** @type {import('eslint').Linter.Plugin} */
const plugin = {
  meta: { name: 'cmemmov', version: '0.0.1' },
  rules: {
    'no-process-env-home': noProcessEnvHome,
    'no-hardcoded-separator': noHardcodedSeparator,
    'no-console-outside-output': noConsoleOutsideOutput,
    'no-raw-json-parse': noRawJsonParse,
  },
};

export default plugin;
