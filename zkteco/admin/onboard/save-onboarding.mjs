// Commit employee fields, required new-employee records, links, and audit in one transaction.
import { randomUUID } from 'node:crypto';
import { createEmployee } from './create-employee.mjs';

export async function applyOnboarding({
  client,
  database,
  config,
  plan,
  branch,
  sourceHash,
  items,
}) {
  const session = client.startSession();
  const year = Number(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric' }).format(
      new Date(),
    ),
  );
  try {
    await session.withTransaction(async () => {
      const now = new Date();
      const annualSetting = await database
        .collection('settings')
        .findOne({ key: 'leave_annual_pl' }, { session });
      const configuredAnnual = Number(String(annualSetting?.value ?? 15).replace(/^"|"$/g, ''));
      const annual = Number.isFinite(configuredAnnual) ? configuredAnnual : 15;
      for (const row of plan) {
        if (row.action === 'create') {
          await createEmployee({
            database,
            session,
            row,
            branch,
            sourceHash,
            now,
            year,
            annual,
            items,
          });
        } else {
          const updated = await database
            .collection('employees')
            .updateOne(
              { _id: row.employeeId, code: row.before.code, updated_at: row.before.updated_at },
              { $set: { ...row.fields, updated_at: now } },
              { session },
            );
          if (updated.matchedCount !== 1) {
            throw new Error(`Employee ${row.fields.code} changed while preparing the import.`);
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
            $addToSet: { user_ids: row.fields.code },
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
          event_type: 'employee_workbook_import',
          message: `Imported ${plan.length} workbook employees; created ${plan.filter((row) => row.action === 'create').length} new records.`,
          metadata: {
            source: 'Employee.xlsx',
            sha256: sourceHash,
            branch_id: branch._id,
            created: plan.filter((row) => row.action === 'create').map((row) => row.employeeId),
            updated: plan.filter((row) => row.action === 'update').map((row) => row.employeeId),
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
