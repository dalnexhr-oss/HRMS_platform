// Read back committed identities before reporting a successful administration command.
export async function verifyLinks(database, config, plan, report) {
  for (const row of plan.filter((item) => item.action === 'link')) {
    const employee = await database.collection('employees').findOne({ _id: row.employeeId });
    const link = await database
      .collection('device_employee_links')
      .findOne({ _id: `${config.deviceId}:${row.deviceUid}` });
    if (
      !employee ||
      employee.code !== row.after.code ||
      employee.full_name !== row.after.full_name ||
      link?.employee_id !== row.employeeId
    ) {
      throw new Error(`Identity read-back failed for ${row.userId}; see ${report}.`);
    }
  }
}
