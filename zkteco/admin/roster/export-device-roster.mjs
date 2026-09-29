// Export device identity fields, optionally reconcile existing HRMS records.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readRoster } from './read-employee-workbook.mjs';
import { reconcileRoster } from './reconcile-hrms-roster.mjs';

export async function exportRoster(values) {
  const employees = values.file
    ? await readRoster(values.file)
    : JSON.parse(await readFile(values.out, 'utf8'));
  await mkdir(path.dirname(values.out), { recursive: true });
  await writeFile(values.out, `${JSON.stringify(employees, null, 2)}\n`);
  console.log(
    `Prepared ${employees.length} employees in ${values.out}. Source workbook unchanged.`,
  );
  if (!values['check-hrms'] && !values['apply-hrms']) {
    return;
  }
  await reconcileRoster(employees, values);
}
