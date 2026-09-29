// Read a snapshot, save a private preview, and apply only when --apply was requested.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import nextEnv from '@next/env';
import { BSON, MongoClient } from 'mongodb';
import { readRoster } from '../roster/read-employee-workbook.mjs';
import { provisionDeviceCollections } from '../../server/provision-device-collections.mjs';
import { buildLinkPlan } from './plan-employee-links.mjs';
import { applyLinks } from './save-employee-links.mjs';
import { verifyLinks } from './verify-employee-links.mjs';

const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));

export async function linkEmployees(values) {
  if (!values.inventory) {
    throw new Error('--inventory must name a recent read-only device inventory.');
  }
  const inventory = await readJson(values.inventory);
  const config = await readJson(values.config);
  if (!config.deviceId || !config.serialNumber || inventory.serialNumber !== config.serialNumber) {
    throw new Error('The inventory must match the configured terminal serial.');
  }
  const roster = values.file
    ? await readRoster(values.file)
    : await readJson('.local/zkteco/employees.json');
  const mapping = values.mapping ? await readJson(values.mapping) : {};
  nextEnv.loadEnvConfig(process.cwd(), true);
  const client = await new MongoClient(process.env.MONGO_URI ?? process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 5000,
  }).connect();
  try {
    const database = client.db();
    const [employees, users, branches, priorLinks, priorTerminal] = await Promise.all([
      database.collection('employees').find({}).toArray(),
      database
        .collection('users')
        .find({}, { projection: { password_hash: 0 } })
        .toArray(),
      database.collection('branches').find({}).toArray(),
      database.collection('device_employee_links').find({ device_id: config.deviceId }).toArray(),
      database.collection('attendance_devices').findOne({ _id: config.deviceId }),
    ]);
    const { plan, branch, ignoredEmployeeIds } = buildLinkPlan({
      config,
      inventory,
      roster,
      mapping,
      values,
      employees,
      users,
      branches,
      priorLinks,
      priorTerminal,
    });
    const report = `.local/zkteco/identity-plan-${Date.now()}.json`;
    await mkdir('.local/zkteco', { recursive: true });
    await writeFile(
      report,
      BSON.EJSON.stringify(
        {
          deviceId: config.deviceId,
          serialNumber: config.serialNumber,
          branch: branch?.name ?? null,
          employees,
          users,
          priorLinks,
          priorTerminal,
          ignoredEmployeeIds,
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
          report,
          employees: employees.length,
          users: users.length,
          linked: plan.filter((row) => row.action === 'link'),
          unresolved: plan.filter((row) => row.action !== 'link'),
          location: branch?.name ?? priorTerminal?.branch_id ?? 'Pending office confirmation',
        },
        null,
        2,
      ),
    );
    if (!values.apply) {
      return;
    }
    await provisionDeviceCollections(database);
    await applyLinks({
      client,
      database,
      config,
      priorTerminal,
      branch,
      ignoredEmployeeIds,
      plan,
      users,
    });
    await verifyLinks(database, config, plan, report);
    console.log(
      `Saved ${plan.filter((row) => row.action === 'link').length} employee links. Employee IDs, user links, passwords and roles retained. No attendance was imported.`,
    );
  } finally {
    await client.close();
  }
}
