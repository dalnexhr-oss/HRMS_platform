// Preserve permanent employee/login IDs and apply the planned identity changes atomically.
import { randomUUID } from 'node:crypto';

export async function applyLinks({
  client,
  database,
  config,
  priorTerminal,
  branch,
  ignoredEmployeeIds,
  plan,
  users,
}) {
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      const now = new Date();
      const coordinate = (value, limit) =>
        value != null &&
        Number.isFinite(Number(String(value))) &&
        Math.abs(Number(String(value))) <= limit
          ? Number(String(value))
          : null;
      await database.collection('attendance_devices').updateOne(
        { _id: config.deviceId },
        {
          $set: {
            serial_number: config.serialNumber,
            enabled: priorTerminal?.enabled ?? true,
            ignored_employee_ids: ignoredEmployeeIds,
            branch_id: branch?._id ?? priorTerminal?.branch_id ?? null,
            latitude: branch
              ? coordinate(branch.geofence_lat, 90)
              : (priorTerminal?.latitude ?? null),
            longitude: branch
              ? coordinate(branch.geofence_lng, 180)
              : (priorTerminal?.longitude ?? null),
            updated_at: now,
          },
          $setOnInsert: { created_at: now },
        },
        { upsert: true, session },
      );
      for (const row of plan.filter((item) => item.action === 'link')) {
        const updated = await database.collection('employees').updateOne(
          {
            _id: row.employeeId,
            ...row.before,
            deleted_at: null,
            status: { $in: ['active', 'on_notice'] },
          },
          { $set: { ...row.after, updated_at: now } },
          { session },
        );
        if (updated.matchedCount !== 1) {
          throw new Error(`Employee ${row.userId} changed after the plan was read.`);
        }
        for (const userId of row.loginIds) {
          const previous = users.find((user) => user._id === userId);
          const saved = await database
            .collection('users')
            .updateOne(
              { _id: userId, employee_id: row.employeeId, full_name: previous.full_name ?? null },
              { $set: { full_name: row.after.full_name, updated_at: now } },
              { session },
            );
          if (saved.matchedCount !== 1) {
            throw new Error(`Linked login changed for ${row.userId}.`);
          }
        }
        await database.collection('device_employee_links').updateOne(
          { _id: `${config.deviceId}:${row.deviceUid}`, employee_id: row.employeeId },
          {
            $set: {
              device_id: config.deviceId,
              serial_number: config.serialNumber,
              device_uid: row.deviceUid,
              employee_id: row.employeeId,
              updated_at: now,
            },
            $addToSet: {
              user_ids: { $each: [...new Set([row.userId, row.before.code, row.after.code])] },
            },
            $setOnInsert: { enabled: true, created_at: now },
          },
          { upsert: true, session },
        );
      }
      await database.collection('activity_log').insertOne(
        {
          _id: randomUUID(),
          actor_id: null,
          employee_id: null,
          event_type: 'device_identity_sync',
          message: `Linked ${plan.filter((row) => row.action === 'link').length} terminal identities to existing HRMS employees.`,
          metadata: {
            device_id: config.deviceId,
            serial_number: config.serialNumber,
            changes: plan
              .filter((row) => row.action === 'link')
              .map(({ employeeId, deviceUid, before, after }) => ({
                employeeId,
                deviceUid,
                before,
                after,
              })),
          },
          occurred_at: now,
        },
        { session },
      );
    });
  } finally {
    await session.endSession();
  }
}
