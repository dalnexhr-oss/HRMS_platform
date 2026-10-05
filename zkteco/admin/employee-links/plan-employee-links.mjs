// Resolve each enrolled device user to one existing, eligible employee.
import { cleanEmployeeName } from '../employees/normalize-employee-names.mjs';

const normal = (value) =>
  cleanEmployeeName(value ?? '')
    .normalize('NFKC')
    .toLowerCase();
const email = (value) =>
  String(value ?? '')
    .trim()
    .toLowerCase();

export function planEmployeeLinks({
  config,
  inventory,
  importedEmployees,
  mapping,
  values,
  employees,
  users,
  branches,
  priorLinks,
  priorTerminal,
}) {
  if (priorTerminal && priorTerminal.serial_number !== config.serialNumber) {
    throw new Error('This device ID is already bound to another serial.');
  }
  const ignoredEmployeeIds = [
    ...new Set([...(priorTerminal?.ignored_employee_ids ?? []), ...values['ignore-employee']]),
  ];
  for (const id of ignoredEmployeeIds) {
    if (!employees.some((row) => row._id === id)) {
      throw new Error(`Unknown ignored employee ID ${id}.`);
    }
  }
  const active = employees.filter(
    (row) =>
      !ignoredEmployeeIds.includes(row._id) &&
      !row.deleted_at &&
      ['active', 'on_notice'].includes(row.status),
  );
  const branch = values.branch
    ? branches.find(
        (row) => row._id === values.branch || normal(row.name) === normal(values.branch),
      )
    : null;
  if (values.branch && !branch) {
    throw new Error('No unique configured branch matches --branch.');
  }
  const plan = [];
  const used = new Set();
  for (const device of inventory.users) {
    const importedEmployee = importedEmployees.find((row) => row.userId === device.user_id);
    const expectedName = importedEmployee?.name ?? device.name;
    if (values.defer.includes(device.user_id)) {
      plan.push({
        deviceUid: String(device.uid),
        userId: device.user_id,
        name: expectedName,
        action: 'awaiting_confirmation',
      });
      continue;
    }
    const manual = mapping[device.user_id] ?? mapping[`uid:${device.uid}`];
    const codeMatches = active.filter((row) => row.code === device.user_id);
    const nameMatches = active.filter((row) => normal(row.full_name) === normal(expectedName));
    const emailMatches = importedEmployee?.email
      ? active.filter((row) =>
          [
            row.email_official,
            row.email_personal,
            ...users.filter((user) => user.employee_id === row._id).map((user) => user.email),
          ].some((value) => email(value) === email(importedEmployee.email)),
        )
      : [];
    const candidates = manual
      ? active.filter((row) => row._id === manual)
      : [
          ...new Map(
            [...codeMatches, ...nameMatches, ...emailMatches].map((row) => [row._id, row]),
          ).values(),
        ];
    const match = candidates.length === 1 ? candidates[0] : null;
    if (!match || used.has(match._id)) {
      plan.push({
        deviceUid: String(device.uid),
        userId: device.user_id,
        name: expectedName,
        action: candidates.length ? 'conflict' : 'unlinked',
        candidates: candidates.map((row) => ({
          id: row._id,
          code: row.code,
          name: row.full_name,
        })),
      });
      continue;
    }
    const existing = priorLinks.find((row) => row.device_uid === String(device.uid));
    if (
      existing &&
      (existing.employee_id !== match._id || existing.serial_number !== config.serialNumber)
    ) {
      throw new Error(
        `UID ${device.uid} is already bound to another identity. Review it manually.`,
      );
    }
    used.add(match._id);
    plan.push({
      deviceUid: String(device.uid),
      userId: device.user_id,
      name: expectedName,
      action: 'link',
      employeeId: match._id,
      before: {
        code: match.code,
        full_name: match.full_name,
        designation: match.designation ?? null,
      },
      after: {
        code: importedEmployee?.userId ?? match.code,
        full_name: expectedName,
        designation: importedEmployee?.designation ?? match.designation ?? null,
      },
      matchedBy: manual
        ? 'explicit employee ID'
        : codeMatches.length
          ? 'employee code'
          : emailMatches.length
            ? 'workbook email and HRMS identity'
            : 'exact full name',
      loginIds: users.filter((user) => user.employee_id === match._id).map((user) => user._id),
    });
  }
  return { plan, branch, ignoredEmployeeIds };
}
