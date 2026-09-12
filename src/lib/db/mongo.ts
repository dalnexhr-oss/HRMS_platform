// MongoDB connection pooling and transaction lifecycle management. SERVER ONLY.
//
// Maintains a singleton MongoClient across Next.js development hot-reloads via globalThis.
// Production instances reuse the initialized connection pool across invocations.
import { MongoClient, type Db, type ClientSession } from 'mongodb';

const uri = process.env.MONGO_URI ?? process.env.MONGODB_URI;

// True when a connection string is configured.
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

// Returns the shared MongoClient instance. Rejections are evicted immediately to avoid caching transient connection failures across hot reloads.
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

// The application database, as named in the connection string.
export async function db(): Promise<Db> {
  return (await client()).db();
}

// Checks whether the deployment topology supports multi-document transactions (replica set or mongos). Cached after initial probe.
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
 * Executes an operation within a multi-document transaction with snapshot isolation.
 *
 * All operations within `fn` must use the passed ClientSession to participate in the transaction.
 * In standalone development environments lacking replica set support, falls back to non-transactional
 * execution with a single warning.
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
    // withTransaction automatically retries transient transaction and commit errors.
    return await session.withTransaction(() => fn(session), {
      readConcern: { level: 'snapshot' },
      writeConcern: { w: 'majority' },
    });
  } finally {
    await session.endSession();
  }
}
