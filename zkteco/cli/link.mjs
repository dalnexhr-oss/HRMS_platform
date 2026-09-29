// Command-line options only; the workflow is independently maintained under admin/.
import { parseArgs } from 'node:util';
import { linkEmployees } from '../admin/link/link-employees.mjs';
import { runCommand } from './support.mjs';

runCommand(async () => {
  const { values } = parseArgs({
    options: {
      inventory: { type: 'string' },
      file: { type: 'string' },
      mapping: { type: 'string' },
      branch: { type: 'string' },
      apply: { type: 'boolean', default: false },
      defer: { type: 'string', multiple: true, default: [] },
      'ignore-employee': { type: 'string', multiple: true, default: [] },
      config: { type: 'string', default: '.local/zkteco/config.json' },
    },
  });
  await linkEmployees(values);
});
