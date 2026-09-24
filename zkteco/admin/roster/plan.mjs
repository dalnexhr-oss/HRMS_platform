// Match existing employees only; preserve canonical MongoDB IDs.
import { normalName } from './names.mjs';

function planHrms(employees, records) {
  const used = new Set();
  return employees.map((employee) => {
    const byCode = records.filter((record) => record.code === employee.userId);
    const byName = records.filter(
      (record) => normalName(record.full_name) === normalName(employee.name),
    );
    const matches = byCode.length ? byCode : byName;
    if (
      matches.length !== 1 ||
      (byCode.length && byName.some((record) => record._id !== byCode[0]._id))
    ) {
      return { ...employee, action: matches.length || byName.length ? 'conflict' : 'missing' };
    }
    const record = matches[0];
    if (used.has(record._id)) {
      return { ...employee, action: 'conflict' };
    }
    used.add(record._id);
    return {
      ...employee,
      action: 'link',
      employeeId: record._id,
      before: {
        code: record.code,
        full_name: record.full_name,
        designation: record.designation ?? null,
      },
    };
  });
}

export { planHrms };
