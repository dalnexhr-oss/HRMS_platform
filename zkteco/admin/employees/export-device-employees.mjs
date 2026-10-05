// Export device identity fields, optionally reconcile existing HRMS records.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readEmployeeWorkbook } from './read-employee-workbook.mjs';
import { updateHrmsEmployees } from './update-hrms-employees.mjs';

export async function exportDeviceEmployees(values) {
  const employees = values.file
    ? await readEmployeeWorkbook(values.file)
    : JSON.parse(await readFile(values.out, 'utf8'));
  await mkdir(path.dirname(values.out), { recursive: true });
  await writeFile(values.out, `${JSON.stringify(employees, null, 2)}\n`);
  console.log(
    `Prepared ${employees.length} employees in ${values.out}. Source workbook unchanged.`,
  );
  if (!values['check-hrms'] && !values['apply-hrms']) {
    return;
  }
  await updateHrmsEmployees(employees, values);
}
