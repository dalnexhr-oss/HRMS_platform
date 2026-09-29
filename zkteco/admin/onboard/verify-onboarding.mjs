// Confirm written source fields and ensure out-of-roster records are unchanged.
import { BSON } from 'mongodb';

export async function verifyOnboarding({ database, config, plan, employees, reportPath }) {
  for (const row of plan) {
    const saved = await database.collection('employees').findOne({ _id: row.employeeId });
    const link = await database
      .collection('device_employee_links')
      .findOne({ _id: `${config.deviceId}:${row.deviceUid}` });
    for (const [key, value] of Object.entries(row.fields)) {
      if (String(saved?.[key]) !== String(value)) {
        throw new Error(`Read-back differs for ${row.fields.code}.${key}; see ${reportPath}.`);
      }
    }
    if (link?.employee_id !== row.employeeId) {
      throw new Error(`Read-back of terminal link failed for ${row.fields.code}.`);
    }
  }
  for (const before of employees.filter(
    (employee) => !plan.some((row) => row.employeeId === employee._id),
  )) {
    const saved = await database.collection('employees').findOne({ _id: before._id });
    if (BSON.EJSON.stringify(saved) !== BSON.EJSON.stringify(before)) {
      throw new Error(`An out-of-roster employee changed concurrently; see ${reportPath}.`);
    }
  }
}
