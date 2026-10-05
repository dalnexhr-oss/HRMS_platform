// Read Employee.xlsx without modifying it.
import ExcelJS from 'exceljs';
import { cleanEmployeeName } from './normalize-employee-names.mjs';
import { parseEmployeeDate } from './parse-employee-dates.mjs';

async function readEmployeeWorkbook(file, { details = false } = {}) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);
  const employees = [];
  const ids = new Set();
  for (const sheet of workbook.worksheets) {
    let columns;
    sheet.eachRow((row, rowNumber) => {
      if (!columns) {
        const headers = new Map();
        row.eachCell((cell, column) => headers.set(cell.text.trim().toLowerCase(), column));
        if (headers.has('empl id') && headers.has('name of the employee')) {
          columns = {
            id: headers.get('empl id'),
            name: headers.get('name of the employee'),
            designation: headers.get('designation'),
            email: headers.get('email id'),
            phone: headers.get('personal contact'),
            joining: headers.get('date of joining'),
            birth: headers.get('date of birth'),
          };
        }
        return;
      }
      const userId = row.getCell(columns.id).text.trim();
      const name = cleanEmployeeName(row.getCell(columns.name).text);
      if (!userId && !name) {
        return;
      }
      if (!/^[\w.-]+$/.test(userId) || !name || ids.has(userId.toLowerCase())) {
        throw new Error(`Invalid or duplicate employee at ${sheet.name}!${rowNumber}.`);
      }
      ids.add(userId.toLowerCase());
      const employee = {
        userId,
        name,
        designation: columns.designation ? row.getCell(columns.designation).text.trim() : '',
        email: columns.email ? row.getCell(columns.email).text.trim().toLowerCase() : '',
        row: rowNumber,
      };
      if (details) {
        if (!columns.joining) {
          throw new Error('The workbook must have Date of Joining.');
        }
        employee.dateOfJoining = parseEmployeeDate(
          row.getCell(columns.joining),
          `${userId} joining date`,
        );
        employee.dateOfBirth = columns.birth
          ? parseEmployeeDate(row.getCell(columns.birth), `${userId} birth date`)
          : null;
        employee.mobilePersonal = columns.phone ? row.getCell(columns.phone).text.trim() : '';
        employee.sourceName = row.getCell(columns.name).text.trim();
        if (!employee.dateOfJoining) {
          throw new Error(`${userId} has no joining date.`);
        }
      }
      employees.push(employee);
    });
  }
  if (!employees.length) {
    throw new Error('No employees found. Expected Empl ID and Name of the Employee headers.');
  }
  return employees;
}

export { readEmployeeWorkbook };
