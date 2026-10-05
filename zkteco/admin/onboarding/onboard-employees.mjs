// Orchestrate workbook onboarding. A private snapshot is saved before any --apply writes.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import nextEnv from '@next/env';
import { MongoClient, BSON } from 'mongodb';
import { readEmployeeWorkbook } from '../employees/read-employee-workbook.mjs';
import { readSalaryRules } from './salary-rules.mjs';
import { loadOnboardingContext } from './load-onboarding-context.mjs';
import { buildOnboardingPlan } from './plan-onboarding.mjs';
import { saveOnboarding } from './save-onboarding.mjs';
import { verifyOnboarding } from './verify-onboarding.mjs';

const json = async (file) => JSON.parse(await readFile(file, 'utf8'));

export async function onboardEmployees(values) {
  if (!values.file || !values.inventory || !values.rules || !values.branch) {
    throw new Error('Supply --file, --inventory, --rules and --branch. Use --apply to save.');
  }
  const importedEmployees = await readEmployeeWorkbook(values.file, { details: true });
  const inventory = await json(values.inventory);
  const config = await json(values.config);
  const rules = await json(values.rules);
  const sourceHash = createHash('sha256')
    .update(await readFile(values.file))
    .digest('hex');
  if (inventory.serialNumber !== config.serialNumber) {
    throw new Error('Inventory serial differs from configured terminal.');
  }
  const salary = readSalaryRules(rules, importedEmployees);
  nextEnv.loadEnvConfig(process.cwd(), true);
  const client = await new MongoClient(process.env.MONGO_URI ?? process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 5000,
  }).connect();
  try {
    const database = client.db();
    const { employees, users, branch, links, ignored, items } = await loadOnboardingContext(
      database,
      config,
      values,
    );
    const plan = buildOnboardingPlan({
      importedEmployees,
      employees,
      inventory,
      links,
      ignored,
      rules,
      ...salary,
    });
    const reportPath = `.local/zkteco/onboard-plan-${Date.now()}.json`;
    await mkdir('.local/zkteco', { recursive: true });
    await writeFile(
      reportPath,
      BSON.EJSON.stringify(
        {
          sourceFile: values.file,
          sourceHash,
          branch: branch.name,
          rules,
          employees,
          users,
          links,
          plan,
        },
        null,
        2,
      ),
      { flag: 'wx', mode: 0o600 },
    );
    console.log(
      JSON.stringify(
        {
          report: reportPath,
          create: plan.filter((row) => row.action === 'create').map((row) => row.fields.code),
          update: plan.filter((row) => row.action === 'update').map((row) => row.fields.code),
          female: plan
            .filter((row) => row.fields.gender === 'Female')
            .map((row) => row.fields.code),
          salary: rules,
          branch: branch.name,
          onboardingTasksPerNewEmployee: items.length,
        },
        null,
        2,
      ),
    );
    if (!values.apply) {
      return;
    }
    await saveOnboarding({ client, database, config, plan, branch, sourceHash, items });
    await verifyOnboarding({ database, config, plan, employees, reportPath });
    console.log(
      JSON.stringify({
        saved: plan.length,
        created: plan.filter((row) => row.action === 'create').length,
        totalEmployees: await database.collection('employees').countDocuments(),
        terminalLinks: await database
          .collection('device_employee_links')
          .countDocuments({ device_id: config.deviceId }),
        users: await database.collection('users').countDocuments(),
        message:
          'Saved and read back. No users, attendance, device credentials or existing leave balances deleted or replaced.',
      }),
    );
  } finally {
    await client.close();
  }
}
