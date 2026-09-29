// Legacy --check-hrms / --apply-hrms support; normal linking also updates login names.
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import nextEnv from '@next/env';
import { MongoClient } from 'mongodb';
import { planHrms } from './plan-roster-reconciliation.mjs';

export async function reconcileRoster(employees, values) {
  nextEnv.loadEnvConfig(process.cwd(), true);
  const uri = process.env.MONGO_URI ?? process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGO_URI is not configured.');
  }
  const client = await new MongoClient(uri, { serverSelectionTimeoutMS: 5000 }).connect();
  try {
    const db = client.db();
    const collection = db.collection('employees');
    const records = await collection
      .find({}, { projection: { _id: 1, code: 1, full_name: 1, designation: 1 } })
      .toArray();
    const plan = planHrms(employees, records);
    const planPath = path.join(path.dirname(values.out), `hrms-plan-${Date.now()}.json`);
    await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, { flag: 'wx' });
    console.log(
      JSON.stringify({
        linked: plan.filter((row) => row.action === 'link').length,
        missing: plan.filter((row) => row.action === 'missing').map((row) => row.userId),
        conflicts: plan.filter((row) => row.action === 'conflict').map((row) => row.userId),
        plan: planPath,
      }),
    );
    if (!values['apply-hrms']) {
      return;
    }
    if (plan.some((row) => row.action === 'conflict')) {
      throw new Error('Resolve identity conflicts in HRMS before applying employee updates.');
    }
    const session = client.startSession();
    try {
      await session.withTransaction(async () => {
        for (const row of plan.filter((item) => item.action === 'link')) {
          const result = await collection.updateOne(
            { _id: row.employeeId, ...row.before },
            {
              $set: {
                code: row.userId,
                full_name: row.name,
                designation: row.designation,
                updated_at: new Date(),
              },
            },
            { session },
          );
          if (result.matchedCount !== 1) {
            throw new Error(`Employee ${row.userId} changed after the plan was prepared.`);
          }
        }
      });
    } finally {
      await session.endSession();
    }
    for (const row of plan.filter((item) => item.action === 'link')) {
      const saved = await collection.findOne({ _id: row.employeeId });
      if (
        saved.code !== row.userId ||
        saved.full_name !== row.name ||
        saved.designation !== row.designation
      ) {
        throw new Error(`Read-back failed for ${row.userId}. See backup ${planPath}.`);
      }
    }
    console.log(
      'Existing HRMS employee identities updated and verified. Missing employees need normal HRMS onboarding.',
    );
  } finally {
    await client.close();
  }
}
