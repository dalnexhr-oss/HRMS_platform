// Backfill employees.branch_name and employees.department_name from their referenced records.
//
// Run npm run db:backfill-names to preview, or add -- --write to apply. Only these two fields are
// updated; updated_at is left unchanged.
//
// Null references remain unassigned. Dangling references are reported and left untouched to
// preserve any cached name. Mismatched names are corrected and counted separately. Re-running after
// a successful write produces no changes.
import { MongoClient } from 'mongodb';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: { write: { type: 'boolean', default: false } },
  allowPositionals: true,
});
const WRITE = values.write;

const uri = process.env.MONGO_URI ?? process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGO_URI is not set. Add it to .env.local, e.g.');
  console.error('  MONGO_URI=mongodb://localhost:27018/hrms');
  process.exit(1);
}

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5_000 });
await client.connect();
const db = client.db();
console.log(`connected: ${uri}`);
console.log(WRITE ? 'mode: WRITE\n' : 'mode: dry run (pass --write to apply)\n');

const employees = db.collection('employees');

/** id -> name, for a lookup collection. */
async function nameById(collection) {
  const map = new Map();
  for (const row of await db
    .collection(collection)
    .find({}, { projection: { name: 1 } })
    .toArray()) {
    map.set(row._id, typeof row.name === 'string' ? row.name : null);
  }
  return map;
}

const branchName = await nameById('branches');
const departmentName = await nameById('departments');
console.log(`lookup: ${branchName.size} branches, ${departmentName.size} departments`);

const all = await employees
  .find(
    {},
    {
      projection: {
        code: 1,
        full_name: 1,
        branch_id: 1,
        branch_name: 1,
        department_id: 1,
        department_name: 1,
      },
    },
  )
  .toArray();
console.log(`employees: ${all.length}\n`);

const filled = []; // null/missing -> a real name
const corrected = []; // stale name -> the reference's name
const dangling = []; // id set, referenced row missing — left alone
const unassigned = []; // no reference at all — legitimately null
const ops = [];

for (const e of all) {
  const patch = {};

  for (const [idField, nameField, lookup, label] of [
    ['branch_id', 'branch_name', branchName, 'branch'],
    ['department_id', 'department_name', departmentName, 'department'],
  ]) {
    const id = e[idField] ?? null;
    const stored = e[nameField] ?? null;

    if (id === null) {
      // No reference: legitimately unassigned. Only normalise a MISSING field
      // to an explicit null so the shape is uniform; never invent a name.
      if (!(nameField in e)) {
        patch[nameField] = null;
      }
      unassigned.push(`${e.code} ${label}`);
      continue;
    }

    const resolved = lookup.get(id);
    if (resolved === undefined) {
      dangling.push(
        `${e.code} ${label}_id=${id} (no such ${label}; ${nameField} left as ${JSON.stringify(stored)})`,
      );
      continue;
    }
    if (resolved === null) {
      dangling.push(
        `${e.code} ${label} ${id} has no name of its own; ${nameField} left as ${JSON.stringify(stored)}`,
      );
      continue;
    }

    if (stored === resolved) {
      // already correct — do not churn
      continue;
    }

    patch[nameField] = resolved;
    (stored === null ? filled : corrected).push(
      `${e.code} ${nameField}: ${JSON.stringify(stored)} -> ${JSON.stringify(resolved)}`,
    );
  }

  if (Object.keys(patch).length > 0) {
    ops.push({ updateOne: { filter: { _id: e._id }, update: { $set: patch } } });
  }
}

const show = (title, rows) => {
  console.log(`${title}: ${rows.length}`);
  for (const r of rows.slice(0, 25)) {
    console.log(`   ${r}`);
  }
  if (rows.length > 25) {
    console.log(`   … and ${rows.length - 25} more`);
  }
};

show('to FILL (was null/missing)', filled);
show('to CORRECT (disagreed with its reference)', corrected);
show('DANGLING references, left untouched', dangling);
console.log(`legitimately unassigned (no reference): ${unassigned.length}`);

if (ops.length === 0) {
  console.log('\nNothing to do — every employee already matches its references.');
} else if (!WRITE) {
  console.log(
    `\n${ops.length} employee document(s) would be updated. Re-run with --write to apply.`,
  );
} else {
  const res = await employees.bulkWrite(ops, { ordered: false });
  console.log(`\nmatched ${res.matchedCount}, modified ${res.modifiedCount}`);
}

// verification
console.log('\n--- verification ---');
let wrong = 0;
let stillNull = 0;
let okUnassigned = 0;
for (const e of await employees
  .find(
    {},
    { projection: { code: 1, branch_id: 1, branch_name: 1, department_id: 1, department_name: 1 } },
  )
  .toArray()) {
  for (const [idField, nameField, lookup] of [
    ['branch_id', 'branch_name', branchName],
    ['department_id', 'department_name', departmentName],
  ]) {
    const id = e[idField] ?? null;
    const stored = e[nameField] ?? null;
    if (id === null) {
      if (stored === null) {
        okUnassigned++;
      } else {
        console.log(`  !! ${e.code}: ${nameField}=${JSON.stringify(stored)} with no ${idField}`);
        wrong++;
      }
      continue;
    }
    const resolved = lookup.get(id);
    if (resolved === undefined || resolved === null) {
      // dangling, reported above
      continue;
    }
    if (stored === resolved) {
      continue;
    }
    if (stored === null) {
      stillNull++;
    } else {
      wrong++;
    }
    console.log(
      `  !! ${e.code}: ${nameField}=${JSON.stringify(stored)} but ${idField} resolves to ${JSON.stringify(resolved)}`,
    );
  }
}
console.log(
  `  resolvable references matching their name : ${WRITE || ops.length === 0 ? 'all' : 'pending --write'}`,
);
console.log(`  still null despite a valid reference      : ${stillNull}`);
console.log(`  mismatched                               : ${wrong}`);
console.log(`  correctly null (no reference)             : ${okUnassigned}`);

await client.close();
console.log('\ndone.');
process.exit(wrong === 0 && (stillNull === 0 || !WRITE) ? 0 : 1);
