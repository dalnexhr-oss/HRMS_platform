// ============================================================================
// Rename a nav slug inside users.tab_access.
//
//   node --env-file=.env.local scripts/rename-tab-slug.mjs <from> <to>
//
// The per-user tab-access map is keyed by nav slug (see lib/access.ts), so
// renaming a route without moving these keys silently resets everyone's setting
// for that tab back to the default. Idempotent: a user already carrying the new
// key is left alone, and a user with neither is untouched.
// ============================================================================
import { MongoClient } from 'mongodb';

const [from, to] = process.argv.slice(2);
if (!from || !to) {
  console.error('usage: node --env-file=.env.local scripts/rename-tab-slug.mjs <from> <to>');
  process.exit(1);
}

const uri = process.env.MONGO_URI ?? process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGO_URI is not set.');
  process.exit(1);
}

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5_000 });
await client.connect();
const users = client.db().collection('users');

const affected = await users
  .find({ [`tab_access.${from}`]: { $exists: true } }, { projection: { email: 1, tab_access: 1 } })
  .toArray();

if (affected.length === 0) {
  console.log(`No account carries tab_access.${from} — nothing to migrate.`);
} else {
  for (const u of affected) {
    console.log(`  ${u.email}: ${from}=${u.tab_access[from]} -> ${to}`);
  }
  const result = await users.updateMany(
    { [`tab_access.${from}`]: { $exists: true } },
    { $rename: { [`tab_access.${from}`]: `tab_access.${to}` } },
  );
  console.log(`\nmigrated ${result.modifiedCount} account(s).`);
}

await client.close();
