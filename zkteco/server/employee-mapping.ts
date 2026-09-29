import 'server-only';
import { lockEmployeePunches } from '@/lib/punch-storage';
import type { ClientSession, Db, Document } from 'mongodb';
import type { DevicePunch } from './punch-protocol';

class UnknownDeviceEmployee extends Error {}

async function resolveDeviceEmployee(
  database: Db,
  event: DevicePunch,
  session: ClientSession | undefined,
) {
  const terminal = await database
    .collection<Document & { _id: string }>('attendance_devices')
    .findOne({ _id: event.deviceId, enabled: true }, { session });
  if (!terminal) {
    throw new UnknownDeviceEmployee('This terminal is not registered and enabled in HRMS.');
  }
  // The 40-byte attendance packet UID may differ from get_users().uid.
  // Resolve only a unique registered user-code alias for this verified terminal.
  const links = await database
    .collection<Document & { _id: string }>('device_employee_links')
    .find(
      {
        device_id: event.deviceId,
        serial_number: terminal.serial_number,
        user_ids: event.userId,
      },
      { session },
    )
    .limit(2)
    .toArray();
  const link = links[0];
  if (links.length !== 1 || !link || link.enabled !== true) {
    throw new UnknownDeviceEmployee(
      `No unique enabled HRMS link for terminal user ${event.userId} (attendance UID ${event.uid}).`,
    );
  }
  if (terminal.ignored_employee_ids?.includes(link.employee_id)) {
    throw new UnknownDeviceEmployee('This employee record is excluded from terminal attendance.');
  }
  const employee = await database
    .collection<Document & { _id: string }>('employees')
    .findOne(
      { _id: link.employee_id, status: { $in: ['active', 'on_notice'] }, deleted_at: null },
      { session, projection: { _id: 1 } },
    );
  if (!employee) {
    // Leave this event retryable: no receipt is committed until the HRMS link exists.
    throw new UnknownDeviceEmployee('The mapped HRMS employee is missing or inactive.');
  }
  await lockEmployeePunches(employee._id, session);
  const login = await database
    .collection('users')
    .findOne(
      { employee_id: employee._id },
      { session, projection: { _id: 1, disabled: 1, punch_access: 1 } },
    );
  if (login?.disabled) {
    throw new UnknownDeviceEmployee('The linked HRMS login is disabled.');
  }
  return { terminal, link, employee, login };
}

export { resolveDeviceEmployee, UnknownDeviceEmployee };
