import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { createRequire, registerHooks } from 'node:module';
import nextEnv from '@next/env';
import { MongoClient } from 'mongodb';

const collectionNames = [
  'employees',
  'branches',
  'attendance_days',
  'payroll_runs',
  'payslips',
  'payslip_adjustments',
  'settings',
  'pt_slabs',
  'users',
  'password_reset_tokens',
  'punch_events',
  'employee_documents',
];

// Only this marker and Node's resolution of Next entry points need adaptation. Application
// functions, sessions, repository policies, MongoDB operations, and transactions remain real.
export async function databaseFixture() {
  nextEnv.loadEnvConfig(process.cwd(), true);
  const uri = process.env.MONGO_URI ?? process.env.MONGODB_URI;
  assert.ok(uri, 'Configure MONGO_URI before running database integration tests.');
  const name = `hrms_test_${randomUUID().replaceAll('-', '')}`;
  const sourceClient = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  const client = new MongoClient(uri, { dbName: name, monitorCommands: true });
  let owned = false;
  let source;
  let database;
  const validators = new Map();

  async function close() {
    try {
      if (owned) {
        assert.match(name, /^hrms_test_[a-f0-9]{32}$/);
        assert.equal(database.databaseName, name);
        assert.notEqual(name, source.databaseName);
        await database.dropDatabase();
      }
    } finally {
      await client.close();
      await sourceClient.close();
      delete globalThis.__dalnexMongo;
      delete globalThis.__dalnexTxnSupport;
    }
  }

  try {
    await sourceClient.connect();
    source = sourceClient.db();
    const hello = await source.command({ hello: 1 });
    assert.ok(
      hello.setName || hello.msg === 'isdbgrid',
      'These tests require MongoDB transactions.',
    );
    const existing = await sourceClient.db('admin').admin().listDatabases({
      nameOnly: true,
      filter: { name },
    });
    assert.equal(existing.databases.length, 0);
    await client.connect();
    database = client.db();
    assert.equal(database.databaseName, name);
    assert.notEqual(database.databaseName, source.databaseName);
    owned = true;

    // Clone deployed validation and indexes, never business records.
    for (const collection of collectionNames) {
      const [info] = await source.listCollections({ name: collection }).toArray();
      assert.ok(info, `Missing source collection: ${collection}`);
      validators.set(collection, info.options);
      const options = Object.fromEntries(
        ['validator', 'validationLevel', 'validationAction', 'collation']
          .filter((key) => key in info.options)
          .map((key) => [key, info.options[key]]),
      );
      await database.createCollection(collection, options);
      for (const index of await source.collection(collection).listIndexes().toArray()) {
        if (index.name === '_id_') {
          continue;
        }
        const { key, v, ns, ...indexOptions } = index;
        await database.collection(collection).createIndex(key, indexOptions);
      }
    }

    globalThis.__dalnexMongo = Promise.resolve(client);
    globalThis.__dalnexTxnSupport = undefined;
    globalThis.AsyncLocalStorage = AsyncLocalStorage;
    registerHooks({
      resolve(specifier, context, nextResolve) {
        if (specifier === 'server-only') {
          return { url: 'database-test:server-only', shortCircuit: true };
        }
        if (['next/headers', 'next/cache', 'next/navigation', 'next/server'].includes(specifier)) {
          return nextResolve(`${specifier}.js`, context);
        }
        return nextResolve(specifier, context);
      },
      load(url, context, nextLoad) {
        return url === 'database-test:server-only'
          ? { format: 'module', source: 'export {};', shortCircuit: true }
          : nextLoad(url, context);
      },
    });

    const require = createRequire(import.meta.url);
    const {
      workAsyncStorage,
    } = require('next/dist/server/app-render/work-async-storage.external.js');
    const {
      workUnitAsyncStorage,
    } = require('next/dist/server/app-render/work-unit-async-storage.external.js');
    const { ResponseCookies } = require('next/dist/server/web/spec-extension/cookies.js');
    const { signSession } = await import('../../src/lib/auth/jwt.ts');
    const { sessionCookie } = await import('../../src/lib/auth/session-shared.ts');

    async function asUser(user, fn) {
      const cookies = new ResponseCookies(new Headers());
      cookies.set(
        sessionCookie,
        await signSession({
          sub: user._id,
          email: user.email,
          role: user.role,
          eid: user.employee_id,
          ver: user.token_version,
        }),
      );
      const request = {
        type: 'request',
        phase: 'action',
        cookies,
        mutableCookies: cookies,
        userspaceMutableCookies: cookies,
        headers: new Headers(),
        url: { pathname: '/integration-test', search: '' },
      };
      return workAsyncStorage.run(
        { route: '/integration-test', isStaticGeneration: false, incrementalCache: {} },
        () => workUnitAsyncStorage.run(request, fn),
      );
    }

    async function reset() {
      for (const collection of await database.listCollections({}, { nameOnly: true }).toArray()) {
        await database.collection(collection.name).deleteMany({});
      }
    }

    async function rejectDocuments(collection, extraCondition, fn) {
      const options = validators.get(collection);
      await database.command({
        collMod: collection,
        validator: { $and: [options.validator, extraCondition] },
        validationLevel: 'strict',
      });
      try {
        return await fn();
      } finally {
        await database.command({
          collMod: collection,
          validator: options.validator,
          validationLevel: options.validationLevel ?? 'strict',
        });
      }
    }

    return { database, client, asUser, reset, rejectDocuments, close };
  } catch (error) {
    await close();
    throw error;
  }
}
