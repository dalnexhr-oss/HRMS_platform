// New employee defaults and the existing leave/onboarding prerequisites. No login is created.
import { randomUUID } from 'node:crypto';
import { Decimal128 } from 'mongodb';

export async function createEmployee({
  database,
  session,
  row,
  branch,
  sourceHash,
  now,
  year,
  annual,
  items,
}) {
  await database.collection('employees').insertOne(
    {
      _id: row.employeeId,
      branch_id: branch._id,
      branch_name: branch.name,
      department_id: null,
      department_name: null,
      employment_type: 'employee',
      status: 'active',
      mobile_official: null,
      email_official: null,
      email_personal: null,
      ...row.fields,
      whatsapp: null,
      email: null,
      pan: null,
      aadhaar: null,
      pf_uan: null,
      esic_number: null,
      bank_name: null,
      bank_account_number: null,
      bank_ifsc: null,
      emergency_contact_name: null,
      emergency_contact_phone: null,
      emergency_contact_relation: null,
      resignation_date: null,
      last_working_day: null,
      notice_period_days: null,
      exit_reason: null,
      deleted_at: null,
      deleted_by: null,
      created_at: now,
      updated_at: now,
      import_source: {
        file: 'Employee.xlsx',
        sha256: sourceHash,
        row: row.sourceRow,
        original_name: row.sourceName,
      },
    },
    { session },
  );
  // The normal create flow provisions the current paid-leave year. New identities have no carry-forward.
  if (row.fields.date_of_joining <= `${year}-12-31`) {
    await database.collection('leave_balances').insertOne(
      {
        _id: randomUUID(),
        employee_id: row.employeeId,
        year,
        type: 'PL',
        balance: Decimal128.fromString(String(Math.round(annual * 10) / 10)),
        created_at: now,
        updated_at: now,
      },
      { session },
    );
  }
  for (const item of items) {
    await database.collection('onboarding_tasks').insertOne(
      {
        _id: randomUUID(),
        employee_id: row.employeeId,
        title: item.title,
        assignee_role: item.assignee_role ?? null,
        status: 'pending',
        due_date: row.fields.date_of_joining,
        done_by: null,
        done_at: null,
        created_at: now,
        updated_at: now,
      },
      { session },
    );
  }
}
