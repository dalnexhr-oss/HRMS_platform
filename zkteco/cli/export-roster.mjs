// Command-line options only; the workflow is independently maintained under admin/.
import { parseArgs } from 'node:util';
import { exportRoster } from '../admin/roster/export-device-roster.mjs';
import { runCommand } from './command-errors.mjs';

runCommand(async () => {
  const { values } = parseArgs({
    options: {
      file: { type: 'string' },
      out: { type: 'string', default: '.local/zkteco/employees.json' },
      'check-hrms': { type: 'boolean', default: false },
      'apply-hrms': { type: 'boolean', default: false },
    },
  });
  await exportRoster(values);
});
