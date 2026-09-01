// ============================================================================
// MongoDB connection. SERVER ONLY — never import from a client component.
//
// One client per process, cached on globalThis. Next's dev server re-evaluates
// modules on every edit; without the cache each hot reload opens a fresh
// connection pool and the server runs out of connections within minutes. In
// production the module is evaluated once and the cache is a no-op.
//
// The database name comes from the URI's path (…:27018/hrms), so there is
// exactly one place to change when moving to Atlas.
// ============================================================================
import { MongoClient, type Db, type ClientSession } from 'mongodb';

const uri = process.env.MONGO_URI ?? process.env.MONGODB_URI;

/** True when a connection string is configured. */
export function isMongoConfigured(): boolean {
  return Boolean(uri);
}

// Cached across hot reloads, namespaced so it cannot collide with anything else
// parked on globalThis.
const globalForMongo = globalThis as typeof globalThis & {
  __dalnexMongo?: Promise<MongoClient>;
  __dalnexTxnSupport?: boolean;
};

function connect(): Promise<MongoClient> {
  if (!uri) {
    throw new Error(
      'MONGO_URI is not set. Add it to .env.local, e.g.\n' +
        '  MONGO_URI=mongodb://localhost:27018/hrms',
    );
  }
  return new MongoClient(uri, {
    // Fail fast in dev rather than hanging for 30s when mongod is not running.
    serverSelectionTimeoutMS: 5_000,
    // Every write must be durable before a Server Action returns; the app
    // reports success to a human immediately afterwards.
    writeConcern: { w: 'majority' },
  }).connect();
}

/**
 * The shared, connected client. Throws (catchably) when unconfigured.
 *
 * A FAILED connect must not stay cached. `??=` would park the rejected promise
 * on globalThis, and since globalThis survives hot reloads, every later request
 * would replay that first ECONNREFUSED — long after mongod came back up — until
 * the dev server was killed. Dropping the entry on rejection lets the next call
 * dial again.
 */
export function client(): Promise<MongoClient> {
  if (globalForMongo.__dalnexMongo) return globalForMongo.__dalnexMongo;
  const pending = connect().catch((err) => {
    if (globalForMongo.__dalnexMongo === pending) {
      globalForMongo.__dalnexMongo = undefined;
      globalForMongo.__dalnexTxnSupport = undefined;
    }
    throw err;
  });
  return (globalForMongo.__dalnexMongo = pending);
}

/** The application database, as named in the connection string. */
export async function db(): Promise<Db> {
  return (await client()).db();
}

/**
 * True when the server can run multi-document transactions — i.e. it is a
 * replica set or a sharded cluster, not a standalone. Probed once and cached.
 */
export async function supportsTransactions(): Promise<boolean> {
  if (globalForMongo.__dalnexTxnSupport !== undefined) {
    return globalForMongo.__dalnexTxnSupport;
  }
  const hello = await (await db()).command({ hello: 1 });
  // `setName` is present on a replica set member; `msg: 'isdbgrid'` on mongos.
  const ok = Boolean(hello.setName) || hello.msg === 'isdbgrid';
  return (globalForMongo.__dalnexTxnSupport = ok);
}

let warnedStandalone = false;

/**
 * Run `fn` inside a multi-document transaction.
 *
 * Postgres gave the app implicit atomicity inside every plpgsql function; this
 * is the replacement, and it is not free — reach for it only where two or more
 * documents must land together (payroll run + payslips, punch event +
 * attendance day, exit clearance + employee status, comp-off settle).
 *
 * Every read and write inside `fn` must be handed the session, or it runs
 * outside the transaction and silently escapes the rollback.
 *
 * STANDALONE FALLBACK: a standalone mongod cannot start a transaction at all,
 * which would make local development impossible. Rather than fail, `fn` runs
 * with `session: undefined` — the writes still happen, they are just not
 * atomic — and a warning is printed once per process naming the fix. Atlas and
 * any replica set take the real path, so production is always transactional.
 */
export async function withTransaction<T>(
  fn: (session: ClientSession | undefined) => Promise<T>,
): Promise<T> {
  if (!(await supportsTransactions())) {
    if (!warnedStandalone) {
      warnedStandalone = true;
      console.warn(
        '\n[mongo] This server is a STANDALONE, so multi-document writes are ' +
          'NOT atomic and change streams are unavailable.\n' +
          '        Convert it to a single-node replica set:\n' +
          '          1. add  replication:\\n  replSetName: rs0  to mongod.cfg\n' +
          '          2. restart mongod\n' +
          "          3. mongosh --port 27018 --eval \"rs.initiate()\"\n" +
          '        Then add ?replicaSet=rs0&directConnection=true to MONGO_URI.\n',
      );
    }
    return fn(undefined);
  }

  const session = (await client()).startSession();
  try {
    // session.withTransaction retries transient commit errors, which a
    // hand-rolled start/commit/abort does not.
    return await session.withTransaction(() => fn(session), {
      readConcern: { level: 'snapshot' },
      writeConcern: { w: 'majority' },
    });
  } finally {
    await session.endSession();
  }
}
