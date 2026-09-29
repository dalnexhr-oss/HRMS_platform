// Produce source-field updates without deleting records or replacing permanent IDs.
import { randomUUID } from 'node:crypto';
import { decimal } from './salary-rules.mjs';

const normal = (value) =>
  String(value ?? '')
    .trim()
    .toLowerCase();

export function buildOnboardingPlan({
  roster,
  employees,
  inventory,
  links,
  ignored,
  rules,
  gross,
  basic,
  hra,
  special,
}) {
  const plan = roster.map((row) => {
    const matches = employees.filter((employee) => normal(employee.code) === normal(row.userId));
    if (matches.length > 1) {
      throw new Error(`Duplicate HRMS code ${row.userId}.`);
    }
    const existing = matches[0];
    if (existing && (ignored.includes(existing._id) || existing.deleted_at)) {
      throw new Error(`${row.userId} matches an excluded/deleted record.`);
    }
    if (
      !existing &&
      employees.some(
        (employee) =>
          !ignored.includes(employee._id) && normal(employee.full_name) === normal(row.name),
      )
    ) {
      throw new Error(`Resolve the existing name match for ${row.userId} before onboarding.`);
    }
    const devices = inventory.users.filter((device) => device.user_id === row.userId);
    if (devices.length !== 1) {
      throw new Error(`Expected one terminal user for ${row.userId}.`);
    }
    const device = devices[0];
    const employeeId = existing?._id ?? randomUUID();
    const previousLink = links.find((link) => link.device_uid === String(device.uid));
    if (previousLink && previousLink.employee_id !== employeeId) {
      throw new Error(`Terminal UID ${device.uid} already links another employee.`);
    }
    if (row.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.email)) {
      throw new Error(`Invalid workbook email for ${row.userId}.`);
    }
    const fields = {
      code: row.userId,
      full_name: row.name,
      designation: row.designation || null,
      date_of_joining: row.dateOfJoining,
      date_of_birth: row.dateOfBirth,
      gender: rules.femaleCodes.includes(row.userId) ? 'Female' : 'Male',
      gross_monthly: decimal(gross),
      basic_da: decimal(basic),
      hra: decimal(hra),
      special_allowance: decimal(special),
      ...(row.mobilePersonal ? { mobile_personal: row.mobilePersonal } : {}),
      ...(row.email
        ? { [row.email.endsWith('@dalnex.com') ? 'email_official' : 'email_personal']: row.email }
        : {}),
    };
    // Optional workbook blanks never erase existing values.
    if (existing && !row.dateOfBirth) {
      delete fields.date_of_birth;
    }
    if (existing && !row.designation) {
      delete fields.designation;
    }
    return {
      action: existing ? 'update' : 'create',
      employeeId,
      deviceUid: String(device.uid),
      before: existing ?? null,
      fields,
      sourceRow: row.row,
      sourceName: row.sourceName,
    };
  });
  return plan;
}
