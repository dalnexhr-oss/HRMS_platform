// ============================================================================
// One-time backfill: employees.branch_name / employees.department_name.
//
//   npm run db:backfill-names              report only, writes nothing
//   npm run db:backfill-names -- --write   apply
//
// WHY THIS EXISTS. The Mongo port replaced the branches/departments JOIN with
// two denormalised columns on the employee — v_today_board groups by
// branch_name, v_celebrations reads both, fn_on_leave_today reads branch_name,
// and getEmployees renders them with no join to fall back on. For a while
// nothing wrote them: only renaming a branch back-filled branch_name
// (actions/employees.ts now writes both on create and update). Any employee
// saved before that fix can still be carrying a null, which the board renders
// as "Unassigned".
//
// WHAT IT WILL AND WILL NOT DO.
//   * The reference is the source of truth: the name is READ from the branch /
//     department document that branch_id / department_id points at.
//   * A null reference means legitimately unassigned. It is left null — an
//     employee with no department genuinely has no department name, and
//     inventing one would be worse than the blank.
//   * A DANGLING reference (an id pointing at a row that no longer exists) is
//     reported and left untouched. Nulling the cached name would destroy the
//     only remaining record of it, and guessing a replacement is invention.
//   * A cached name that DISAGREES with its reference is corrected, and counted
//     separately so the change is never silent.
//   * Only these two fields are ever written. No updated_at, no touch of
//     anything else — this is a repair, not an edit anyone made.
//
// IDEMPOTENT: the update set is computed by comparing the stored value with the
// resolved one, so a second run finds nothing to do and reports 0.
// ============================================================================
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
  for (const row of await db.collection(collection).find({}, { projection: { name: 1 } }).toArray()) {
    map.set(row._id, typeof row.name === 'string' ? row.name : null);
  }
  return map;
}

const branchName = await nameById('branches');
const departmentName = await nameById('departments');
console.log(`lookup: ${branchName.size} branches, ${departmentName.size} departments`);

const all = await employees
  .find({}, { projection: { code: 1, full_name: 1, branch_id: 1, branch_name: 1, department_id: 1, department_name: 1 } })
  .toArray();
console.log(`employees: ${all.length}\n`);

const filled = [];    // null/missing -> a real name
const corrected = []; // stale name -> the reference's name
const dangling = [];  // id set, referenced row missing — left alone
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
      if (!(nameField in e)) patch[nameField] = null;
      unassigned.push(`${e.code} ${label}`);
      continue;
    }

    const resolved = lookup.get(id);
    if (resolved === undefined) {
      dangling.push(`${e.code} ${label}_id=${id} (no such ${label}; ${nameField} left as ${JSON.stringify(stored)})`);
      continue;
    }
    if (resolved === null) {
      dangling.push(`${e.code} ${label} ${id} has no name of its own; ${nameField} left as ${JSON.stringify(stored)}`);
      continue;
    }

    if (stored === resolved) continue; // already correct — do not churn

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
  for (const r of rows.slice(0, 25)) console.log('   ' + r);
  if (rows.length > 25) console.log(`   … and ${rows.length - 25} more`);
};

show('to FILL (was null/missing)', filled);
show('to CORRECT (disagreed with its reference)', corrected);
show('DANGLING references, left untouched', dangling);
console.log(`legitimately unassigned (no reference): ${unassigned.length}`);

if (ops.length === 0) {
  console.log('\nNothing to do — every employee already matches its references.');
} else if (!WRITE) {
  console.log(`\n${ops.length} employee document(s) would be updated. Re-run with --write to apply.`);
} else {
  const res = await employees.bulkWrite(ops, { ordered: false });
  console.log(`\nmatched ${res.matchedCount}, modified ${res.modifiedCount}`);
}

// --- verification ----------------------------------------------------------
console.log('\n--- verification ---');
let wrong = 0, stillNull = 0, okUnassigned = 0;
for (const e of await employees
  .find({}, { projection: { code: 1, branch_id: 1, branch_name: 1, department_id: 1, department_name: 1 } })
  .toArray()) {
  for (const [idField, nameField, lookup] of [
    ['branch_id', 'branch_name', branchName],
    ['department_id', 'department_name', departmentName],
  ]) {
    const id = e[idField] ?? null;
    const stored = e[nameField] ?? null;
    if (id === null) {
      if (stored === null) okUnassigned++;
      else { console.log(`  !! ${e.code}: ${nameField}=${JSON.stringify(stored)} with no ${idField}`); wrong++; }
      continue;
    }
    const resolved = lookup.get(id);
    if (resolved === undefined || resolved === null) continue; // dangling, reported above
    if (stored === resolved) continue;
    if (stored === null) stillNull++;
    else wrong++;
    console.log(`  !! ${e.code}: ${nameField}=${JSON.stringify(stored)} but ${idField} resolves to ${JSON.stringify(resolved)}`);
  }
}
console.log(`  resolvable references matching their name : ${WRITE || ops.length === 0 ? 'all' : 'pending --write'}`);
console.log(`  still null despite a valid reference      : ${stillNull}`);
console.log(`  mismatched                               : ${wrong}`);
console.log(`  correctly null (no reference)             : ${okUnassigned}`);

await client.close();
console.log('\ndone.');
process.exit(wrong === 0 && (stillNull === 0 || !WRITE) ? 0 : 1);
