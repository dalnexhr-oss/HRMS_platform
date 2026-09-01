// One-shot generator: SQL DDL -> scripts/schema.mjs (validators + indexes).
// Deleted after it runs; scripts/schema.mjs is the artefact that is kept.
import fs from 'node:fs';

const sql = fs.readdirSync('supabase/migrations')
  .filter((f) => f.endsWith('.sql')).sort()
  .map((f) => fs.readFileSync('supabase/migrations/' + f, 'utf8')).join('\n');

const constants = fs.readFileSync('src/lib/constants.ts', 'utf8');
const STATES = [...constants.match(/INDIAN_STATES\s*=\s*\[([\s\S]*?)\]/)[1]
  .matchAll(/'([^']+)'/g)].map((m) => m[1]);

// Enum values, including every `alter type ... add value` that followed.
//
// COMMENTS ARE STRIPPED FIRST, and that is not cosmetic. The body used to be
// captured with `([^)]*)`, a character class that stops at the first closing
// paren — and notification_kind documents its values with trailing comments
// that contain parentheses:
//
//     'policy',   -- a policy was published (needs acknowledgement)
//     'request',  -- a request was raised (-> approvers)
//
// so the capture ended inside that first comment and the enum was generated
// with two of its twelve values. Every notification the app raises for a
// request, an approval, a reimbursement, a comp-off, a ticket, payroll or a
// system event was then rejected by the collection validator as error 121.
// Stripping comments also removes the `create type zz_t` that only ever
// appeared inside one, which the old pass picked up as a real type.
const withoutComments = sql.replace(/--.*$/gm, '');
const ENUMS = {};
for (const m of withoutComments.matchAll(/create type ([a-z_]+)\s+as enum\s*\(([\s\S]*?)\)\s*;/gi)) {
  ENUMS[m[1]] = [...m[2].matchAll(/'([^']*)'/g)].map((x) => x[1]);
}
for (const m of withoutComments.matchAll(/alter type ([a-z_]+) add value (?:if not exists )?'([^']*)'/gi)) {
  (ENUMS[m[1]] ??= []).push(m[2]);
}
ENUMS.indian_state = STATES;
// 'viewer' was superseded; the app's AppRole union is the authority.
ENUMS.app_role = ['super_admin', 'admin', 'hr', 'manager', 'employee'];
ENUMS.notification_kind ??= [];

// Columns added by later migrations, keyed by table.
const EXTRA = {};
for (const m of sql.matchAll(/alter table (?:public\.)?([a-z_]+)\s*((?:\s*add column[^;]*)+);/gi)) {
  const table = m[1];
  for (const c of m[2].matchAll(/add column (?:if not exists )?([a-z_]+)\s+([a-z_]+(?:\([0-9, ]*\))?)/gi)) {
    (EXTRA[table] ??= []).push({ name: c[1], type: c[2] });
  }
}

const DATE_RE = '^[0-9]{4}-[0-9]{2}-[0-9]{2}$';
const TIME_RE = '^[0-9]{2}:[0-9]{2}$';

function bson(type, notNull) {
  const base = type.replace(/\(.*/, '').toLowerCase();
  const nul = (t) => (notNull ? t : [t, 'null']);

  if (ENUMS[base]) {
    // An enum column carries its value set; null is expressed by allowing it.
    return notNull ? { enum: ENUMS[base] } : { enum: [...ENUMS[base], null] };
  }
  switch (base) {
    case 'uuid': case 'text': case 'citext':
      return { bsonType: nul('string') };
    case 'date':
      // Calendar day as a string — BSON Date is a UTC instant and drifts in IST.
      return { bsonType: nul('string'), pattern: DATE_RE };
    case 'time':
      return { bsonType: nul('string'), pattern: TIME_RE };
    case 'timestamptz': case 'timestamp':
      return { bsonType: nul('date') };
    case 'numeric': case 'decimal':
      // Money and coordinates alike: exact, never float64.
      return { bsonType: notNull ? 'decimal' : ['decimal', 'null'] };
    case 'integer': case 'int': case 'bigint': case 'smallint':
      return { bsonType: notNull ? ['int', 'long'] : ['int', 'long', 'null'] };
    case 'boolean': case 'bool':
      return { bsonType: nul('bool') };
    case 'jsonb': case 'json':
      return {};                        // free-form subdocument
    case 'text[]':
      return { bsonType: nul('array') };
    default:
      return {};                        // unknown: permit, do not guess
  }
}

const out = {};
for (const m of sql.matchAll(/create table (?:if not exists )?([a-z_]+)\s*\(([\s\S]*?)\n\);/gi)) {
  const table = m[1];
  if (table === 'profiles') continue;   // merged into users
  const body = m[2];

  const props = {};
  const required = [];
  const indexes = [];

  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
  for (const raw of lines) {
    const line = raw.replace(/--.*$/, '').trim().replace(/,$/, '');
    if (!line) continue;

    // unique (a, b)
    const uq = /^unique\s*\(([^)]*)\)/i.exec(line);
    if (uq) {
      const cols = uq[1].split(',').map((c) => c.trim());
      indexes.push({
        keys: Object.fromEntries(cols.map((c) => [c === 'id' ? '_id' : c, 1])),
        options: { unique: true, name: `${table}_${cols.join('_')}_unique` },
      });
      continue;
    }
    if (/^(constraint|check|primary key|foreign key|exclude)\b/i.test(line)) continue;

    const col = /^([a-z_]+)\s+([a-z_]+(?:\([0-9, ]*\))?)(.*)$/i.exec(line);
    if (!col) continue;
    const [, name, type, rest] = col;
    if (/^(unique|check|constraint|primary|references)$/i.test(name)) continue;

    const key = name === 'id' ? '_id' : name;
    const notNull = /not null/i.test(rest) || /primary key/i.test(rest);
    props[key] = bson(type, notNull);
    if (notNull) required.push(key);

    if (/\bunique\b/i.test(rest)) {
      indexes.push({ keys: { [key]: 1 }, options: { unique: true, name: `${table}_${name}_unique` } });
    }
    if (/references\s+/i.test(rest)) {
      // No foreign keys in MongoDB; the index is what keeps the lookup cheap.
      indexes.push({ keys: { [key]: 1 }, options: { name: `${table}_${name}` } });
    }
  }

  for (const e of EXTRA[table] ?? []) {
    const key = e.name === 'id' ? '_id' : e.name;
    if (!props[key]) props[key] = bson(e.type, false);
  }

  out[table] = {
    validator: { $jsonSchema: { bsonType: 'object', required, properties: props } },
    indexes,
  };
}

const banner = `// ============================================================================
// Collection validators and indexes. GENERATED from supabase/migrations/*.sql,
// then hand-adjusted — see the OVERRIDES block at the bottom, which is where
// anything the mechanical translation could not express lives.
//
// Translation rules, applied uniformly:
//   uuid, text        -> string            (uuid PKs keep their value, so every
//                                           existing foreign-key string stays valid)
//   date              -> "YYYY-MM-DD"      BSON Date is a UTC instant; a calendar
//                                          day round-tripped through it shifts in IST
//   time              -> "HH:MM"           BSON has no time-of-day type
//   timestamptz       -> BSON date         these genuinely are instants
//   numeric(p,s)      -> decimal           money is never float64
//   integer           -> int | long
//   jsonb             -> subdocument
//   enum type         -> enum, including every later \`alter type ... add value\`
//   unique (...)      -> unique index      the ONLY thing preventing duplicates now
//   references        -> plain index       no foreign keys exist to enforce
//
// NOT translated, because a JSON Schema cannot express them: cross-field CHECK
// constraints. Those appear in OVERRIDES as $expr clauses, or are enforced in
// the action that writes the collection.
// ============================================================================
`;

const body = Object.entries(out)
  .map(([t, v]) => `  ${JSON.stringify(t)}: ${JSON.stringify(v, null, 2).split('\n').join('\n  ')},`)
  .join('\n');

fs.writeFileSync('scripts/schema.generated.mjs',
  `${banner}\nexport const GENERATED = {\n${body}\n};\n`);

console.log(`generated ${Object.keys(out).length} collections`);
for (const [t, v] of Object.entries(out)) {
  console.log(`  ${t.padEnd(28)} ${Object.keys(v.validator.$jsonSchema.properties).length} fields, ${v.indexes.length} indexes`);
}
