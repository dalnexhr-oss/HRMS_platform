// ============================================================================
// Database setup — collections, validators, indexes, and the first super admin.
//
//   npm run db:setup                     schema only
//   npm run db:setup -- --admin --email you@company.com
//
// Idempotent: re-running creates nothing twice and never touches a user unless
// --admin names one.
//
// The schema itself lives in scripts/schema.mjs (generated translation of the
// SQL DDL + hand-written overrides). This file only applies it, so there is one
// place to look for "what is the shape" and one for "how is it installed".
// ============================================================================
import { MongoClient } from 'mongodb';
import { randomBytes, randomUUID, scrypt } from 'node:crypto';
import { promisify, parseArgs } from 'node:util';
import { buildSchema } from './schema.mjs';

const scryptAsync = promisify(scrypt);

// These MUST match src/lib/auth/password.ts, or the admin created here cannot
// sign in. Duplicated rather than imported because that module is TypeScript
// and uses path aliases; the encoding format is the contract between them.
const N = 65_536, R = 8, P = 1, KEYLEN = 64, MAXMEM = 192 * 1024 * 1024;

async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password.normalize('NFKC'), salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return ['scrypt', N, R, P, salt.toString('base64'), hash.toString('base64')].join('$');
}

const { values } = parseArgs({
  options: {
    admin: { type: 'boolean', default: false },
    email: { type: 'string' },
    password: { type: 'string' },
    name: { type: 'string' },
  },
  allowPositionals: true,
});

const uri = process.env.MONGO_URI ?? process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGO_URI is not set. Add it to .env.local, e.g.');
  console.error('  MONGO_URI=mongodb://localhost:27018/hrms');
  process.exit(1);
}

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5_000 });
await client.connect();
const db = client.db();
console.log(`connected: ${uri.replace(/\/\/[^@]*@/, '//<credentials>@')}`);

// Transactions and change streams both need a replica set. A standalone gives
// neither, silently — finding that out during payroll is worse than here.
const hello = await db.command({ hello: 1 });
if (hello.setName) {
  console.log(`replica set: ${hello.setName} — transactions and change streams OK`);
} else {
  console.log('replica set: NONE (standalone)');
  console.log('  → multi-document writes are not atomic, change streams unavailable.');
  console.log('  → add "replication: { replSetName: rs0 }" to mongod.cfg, restart,');
  console.log('    then run: mongosh --port 27018 --eval "rs.initiate()"');
}

const schema = buildSchema();
const existing = new Set(
  (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name),
);

let created = 0, updated = 0, indexed = 0;
const problems = [];

for (const [name, def] of Object.entries(schema)) {
  try {
    if (existing.has(name)) {
      // 'moderate' only validates documents that already conform, so applying
      // this to a populated collection cannot lock out existing rows.
      await db.command({ collMod: name, validator: def.validator, validationLevel: 'moderate' });
      updated++;
    } else {
      await db.createCollection(name, { validator: def.validator, validationLevel: 'moderate' });
      created++;
    }
  } catch (e) {
    problems.push(`validator ${name}: ${e.message}`);
    continue;
  }

  for (const index of def.indexes) {
    try {
      await db.collection(name).createIndex(index.keys, index.options);
      indexed++;
    } catch (e) {
      // An index that already exists with different options is a real conflict,
      // not something to paper over — report it and keep going.
      problems.push(`index ${name}.${index.options?.name}: ${e.message}`);
    }
  }
}

console.log(`\ncollections created: ${created}, validators updated: ${updated}, indexes ensured: ${indexed}`);
if (problems.length) {
  console.log(`\n${problems.length} problem(s):`);
  for (const p of problems) console.log('  ' + p);
}

if (values.admin) {
  const email = (values.email ?? process.env.SEED_ADMIN_EMAIL ?? '').trim().toLowerCase();
  if (!email) {
    console.error('\n--admin needs an email: --email you@company.com');
    await client.close();
    process.exit(1);
  }

  const password = values.password ?? process.env.SEED_ADMIN_PASSWORD ?? randomBytes(12).toString('base64url');
  const generated = !values.password && !process.env.SEED_ADMIN_PASSWORD;
  const now = new Date();
  const users = db.collection('users');
  const found = await users.findOne({ email }, { collation: { locale: 'en', strength: 2 } });

  if (found) {
    // Reset rather than refuse: the usual reason to re-run is a forgotten
    // password on the only admin account. token_version bumps, so any session
    // issued against the old password stops working immediately.
    await users.updateOne({ _id: found._id }, {
      $set: { password_hash: await hashPassword(password), role: 'super_admin', disabled: false, updated_at: now },
      $inc: { token_version: 1 },
    });
    console.log(`\nadmin reset:   ${email} (role forced to super_admin, sessions revoked)`);
  } else {
    await users.insertOne({
      _id: randomUUID(), email, password_hash: await hashPassword(password),
      full_name: values.name ?? 'Super Admin', role: 'super_admin', branch_id: null, avatar: null,
      employee_id: null, disabled: false, token_version: 0, tab_access: {},
      email_verified_at: now, last_sign_in_at: null, created_at: now, updated_at: now,
    });
    console.log(`\nadmin created: ${email}`);
  }

  if (generated) {
    console.log(`password:      ${password}`);
    console.log('               ^ shown once — copy it now, then change it after signing in.');
  }
}

await client.close();
console.log('\ndone.');
process.exit(problems.length ? 1 : 0);
