// ============================================================================
// Generate src/lib/db/defaults.ts from the SQL DDL.
//
//   node scripts/gen-defaults.mjs
//
// Postgres filled a column's DEFAULT when an INSERT omitted it. MongoDB has no
// such notion, so every ported insert that relied on one was writing an
// incomplete document — and where the column was also NOT NULL, the collection
// validator rejected the write outright as error 121 ("new row violates check
// constraint" once pgcompat has translated it).
//
// The DEFAULT clauses are read straight out of supabase/**/*.sql so this file
// cannot drift from the schema it mirrors, and each value is coerced to the
// BSON type the validator actually demands (a money default has to be
// Decimal128, not 0).
// ============================================================================
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSchema } from './schema.mjs';

// --- collect the DDL --------------------------------------------------------

const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.sql')) files.push(p);
  }
})('supabase');
files.sort();

/** table -> column -> raw SQL default expression. Later migrations win. */
const raw = {};
for (const file of files) {
  const sql = readFileSync(file, 'utf8');

  const create = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_0-9]+)\s*\(([\s\S]*?)\n\s*\);/gi;
  let m;
  while ((m = create.exec(sql))) {
    const [, table, body] = m;
    raw[table] ??= {};
    for (const line of body.split('\n')) {
      const col = line.trim().replace(/,$/, '');
      if (!col || col.startsWith('--')) continue;
      if (/^(primary key|unique|foreign key|constraint|check|exclude)\b/i.test(col)) continue;
      const d = /^([a-z_0-9]+)\s+[^]*?\bdefault\s+(.+?)(?:\s+not\s+null)?$/i.exec(col);
      if (d) raw[table][d[1]] = d[2].trim();
    }
  }

  const alter =
    /alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?([a-z_0-9]+)\s+add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z_0-9]+)[^;]*?\bdefault\s+([^;]+?)(?:\s+not\s+null)?\s*;/gi;
  while ((m = alter.exec(sql))) {
    raw[m[1]] ??= {};
    raw[m[1]][m[2]] = m[3].trim();
  }
}

// --- coerce each default to the BSON type the validator wants ---------------

const schema = buildSchema();

/** The declared bsonType for a field, as a plain array. */
function typesOf(collection, field) {
  const v = schema[collection]?.validator;
  const js = v?.$jsonSchema ?? v?.$and?.find((c) => c.$jsonSchema)?.$jsonSchema;
  const spec = js?.properties?.[field];
  if (!spec) return null;
  if (spec.enum) return ['enum'];
  const t = spec.bsonType;
  return t == null ? null : Array.isArray(t) ? t : [t];
}

/**
 * Strip everything that trails the default expression in the DDL.
 *
 * A column line carries more than the default: `default 0 check (qty >= 0)`,
 * `default 0,        -- display order`, `default '{}'::jsonb`. Left in, the
 * value stops looking like a number and the default is silently dropped.
 */
function cleanExpr(expr) {
  return expr
    .replace(/\bcheck\s*\([^]*$/i, '')  // inline CHECK
    .replace(/--[^]*$/, '')             // trailing comment
    .replace(/::[a-z_ ]+/gi, '')        // cast
    .replace(/[,\s]+$/, '')
    .trim();
}

/**
 * SQL default -> the emitted TypeScript expression, or null to skip.
 *
 * `gen_random_uuid()` is skipped on purpose: the primary key becomes `_id`, and
 * pgcompat already mints one. A stray `id` default would write a second field.
 *
 * A field the validator does not describe still gets non-numeric defaults —
 * `activity_log.metadata` is required but has no declared property, and without
 * its `{}` every audit write would fail. Numbers are the one case that needs
 * the declared type, to tell Decimal128 money from a plain count.
 */
function coerce(collection, field, expr) {
  const e = cleanExpr(expr);
  const types = typesOf(collection, field);
  const isnt = (t) => types != null && !types.includes(t);

  if (/^gen_random_uuid\(\)$/i.test(e)) return null;
  if (/^now\(\)$/i.test(e)) return isnt('date') ? null : 'NOW';
  if (/^current_date$/i.test(e)) return types?.includes('date') ? 'NOW' : 'TODAY';
  if (/^(true|false)$/i.test(e)) return isnt('bool') ? null : e.toLowerCase();
  if (/^'\{\}'$/.test(e) || /^'\{\}'$/.test(e.replace(/\s/g, ''))) return '{}';

  // A quoted literal: an enum member or plain text.
  const quoted = /^'(.*)'$/.exec(e);
  if (quoted) return JSON.stringify(quoted[1]);

  // A bare number. Money is Decimal128; everything else stays numeric.
  if (/^-?\d+(?:\.\d+)?$/.test(e)) {
    if (types == null) return null;
    if (types.includes('decimal')) return `money('${Number(e).toFixed(2)}')`;
    if (types.some((t) => t === 'int' || t === 'long' || t === 'double')) return e;
    return null;
  }
  return null;
}

const out = {};
for (const [table, cols] of Object.entries(raw)) {
  if (!schema[table]) continue; // dropped, renamed, or never migrated
  for (const [field, expr] of Object.entries(cols)) {
    if (field === 'id') continue;
    const value = coerce(table, field, expr);
    if (value == null) continue;
    (out[table] ??= {})[field] = value;
  }
}

// --- emit -------------------------------------------------------------------

const lines = [];
lines.push('// ============================================================================');
lines.push('// GENERATED by scripts/gen-defaults.mjs — do not edit by hand.');
lines.push('//');
lines.push("// Postgres applied a column DEFAULT when an INSERT omitted it; MongoDB does");
lines.push('// not. Every value here was read out of the SQL DDL and coerced to the BSON');
lines.push('// type its collection validator declares, so an insert through pgcompat lands');
lines.push('// the same document Postgres would have stored.');
lines.push('//');
lines.push('// Regenerate with:  node scripts/gen-defaults.mjs');
lines.push('// ============================================================================');
lines.push("import { Decimal128 } from 'mongodb';");
lines.push('');
lines.push('/** Marker for `now()` — resolved per insert, never at module load. */');
lines.push("export const NOW = Symbol('now');");
lines.push('/** Marker for `current_date` — an IST calendar date, as `YYYY-MM-DD`. */');
lines.push("export const TODAY = Symbol('today');");
lines.push('');
lines.push('const money = (v: string): Decimal128 => Decimal128.fromString(v);');
lines.push('');
lines.push('export type DefaultValue = string | number | boolean | Decimal128 | object | symbol;');
lines.push('');
lines.push('/** collection -> field -> the value Postgres would have supplied. */');
lines.push('export const COLUMN_DEFAULTS: Record<string, Record<string, DefaultValue>> = {');
for (const table of Object.keys(out).sort()) {
  lines.push(`  ${table}: {`);
  for (const [field, value] of Object.entries(out[table])) {
    lines.push(`    ${field}: ${value},`);
  }
  lines.push('  },');
}
lines.push('};');
lines.push('');

writeFileSync('src/lib/db/defaults.ts', lines.join('\n'), 'utf8');

const fieldCount = Object.values(out).reduce((n, c) => n + Object.keys(c).length, 0);
console.log(`wrote src/lib/db/defaults.ts — ${Object.keys(out).length} collections, ${fieldCount} fields`);
