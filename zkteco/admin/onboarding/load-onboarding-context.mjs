// Read employee, terminal, branch, and onboarding-template state before planning.
const normal = (value) =>
  String(value ?? '')
    .trim()
    .toLowerCase();

export async function loadOnboardingContext(database, config, values) {
  const [employees, users, branchRows, terminal, links, template] = await Promise.all([
    database.collection('employees').find({}).toArray(),
    database
      .collection('users')
      .find({}, { projection: { password_hash: 0 } })
      .toArray(),
    database.collection('branches').find({}).toArray(),
    database.collection('attendance_devices').findOne({ _id: config.deviceId }),
    database.collection('device_employee_links').find({ device_id: config.deviceId }).toArray(),
    database
      .collection('onboarding_templates')
      .find({ active: true })
      .sort({ created_at: -1 })
      .limit(1)
      .next(),
  ]);
  const branches = branchRows.filter(
    (row) => row._id === values.branch || normal(row.name) === normal(values.branch),
  );
  if (branches.length !== 1) {
    throw new Error('Pick one existing branch.');
  }
  const branch = branches[0];
  if (
    !terminal ||
    terminal.serial_number !== config.serialNumber ||
    terminal.branch_id !== branch._id
  ) {
    throw new Error('Register the confirmed terminal branch using device:link first.');
  }
  const ignored = terminal.ignored_employee_ids ?? [];
  const items = template
    ? await database
        .collection('onboarding_template_items')
        .find({ template_id: template._id })
        .sort({ seq: 1 })
        .toArray()
    : [];
  return { employees, users, branch, links, ignored, items };
}
