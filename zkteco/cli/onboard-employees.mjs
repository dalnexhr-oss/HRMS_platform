// Command-line options only; the workflow is independently maintained under admin/.
import { parseArgs } from 'node:util';
import { onboardEmployees } from '../admin/onboard/onboard-employees.mjs';
import { runCommand } from './command-errors.mjs';

runCommand(async () => {
  const { values } = parseArgs({
    options: {
      file: { type: 'string' },
      inventory: { type: 'string' },
      rules: { type: 'string' },
      config: { type: 'string', default: '.local/zkteco/config.json' },
      branch: { type: 'string' },
      apply: { type: 'boolean', default: false },
    },
  });
  await onboardEmployees(values);
});
