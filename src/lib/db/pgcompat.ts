// ============================================================================
// A PostgREST-shaped query builder backed by MongoDB. SERVER ONLY.
//
// WHY THIS EXISTS, and what it is not.
//
// The app had ~500 Supabase call sites written in PostgREST's idiom
// (`.from(t).select(c).eq(a, b).order(d)` returning `{ data, error }`).
// Hand-rewriting every one of them is not a reliable operation at that volume:
// the failure mode is a single dropped `.eq()` that silently widens a query,
// and there is no compiler check that would catch it.
//
// So this translates that idiom to MongoDB instead. Crucially it does so
// THROUGH lib/db/repo.ts, which means every query it runs still has the
// collection's access policy ANDed into it. The compatibility layer cannot be
// used to escape scoping — that was the one property worth protecting.
//
// This is an adapter, not the destination. Code ported natively (the auth
// layer, the org core, payroll) uses `scoped()` directly and is easier to read
// for it. Anything still on this builder can be moved over file by file, and
// the builder deleted when the last one goes.
//
// NOT SUPPORTED, deliberately — each throws rather than silently doing the
// wrong thing:
//   * `.or()` across embedded resources
//   * full-text search
//   * `.explain()`
// ============================================================================
import 'server-only';
import type { Document, Filter } from 'mongodb';
import { NotSignedInError, readFilterFor, scoped, scopedFor, type ScopedCollection } from '@/lib/db/repo';
import { currentScope, SYSTEM_SCOPE, type Scope } from '@/lib/db/scope';
import { db } from '@/lib/db/mongo';
import { COLUMN_DEFAULTS, NOW, TODAY, type DefaultValue } from '@/lib/db/defaults';
import { isView, runView } from '@/lib/db/views';
import { relationshipFor } from '@/lib/db/relationships';
// ONE definition of "today in IST", shared by this file, views.ts, functions.ts
// and scheduler.ts. It used to be written out in each of them, twice over in
// two different ways — Intl here, `Date.now() + 5.5h` in the other three — and
// the cron ledger's run key and the rows a job then wrote were computed by
// different copies. A date-boundary fix has one place to land now.
import { todayIST } from '@/lib/format';

export interface PgResult<T> {
  data: T;
  error: PgError | null;
  count?: number | null;
}

export interface PgError {
  message: string;
  code?: string;
  details?: string;
}

/** Postgres SQLSTATEs the app already branches on, so they must survive. */
const DUPLICATE_KEY = '23505';
const CHECK_VIOLATION = '23514';

function toPgError(e: unknown): PgError {
  const err = e as { code?: number | string; message?: string; errInfo?: unknown };
  if (err?.code === 11000) {
    return { message: 'duplicate key value violates unique constraint', code: DUPLICATE_KEY };
  }
  if (err?.code === 121) {
    return {
      message: 'new row violates check constraint',
      code: CHECK_VIOLATION,
      details: JSON.stringify(err.errInfo ?? {}),
    };
  }
  return { message: err?.message ?? String(e) };
}

/** `id` is `_id` in MongoDB; everything else keeps its name. */
function col(name: string): string {
  return name === 'id' ? '_id' : name;
}

/** Documents come back with `_id`; callers expect `id`. Both are provided. */
function outward<T extends Document>(doc: T | null): T | null {
  if (!doc) return null;
  if ('_id' in doc && !('id' in doc)) return { ...doc, id: doc._id } as T;
  return doc;
}

// ---------------------------------------------------------------------------
// Embedded selects
// ---------------------------------------------------------------------------

interface Embed {
  /** Collection to join, e.g. 'branches'. */
  table: string;
  /** Alias in the result, e.g. 'branches' or 'actor'. */
  alias: string;
  /** Selected columns. A single '*' means every column. */
  fields: string[];
  /** Embeds nested INSIDE this one, e.g. employees(…, branches(name)). */
  embeds: Embed[];
  /** Field on the local document, or `_id` when the child holds the key. */
  localField: string;
  /** Field on the joined document, `_id` for an ordinary to-one join. */
  foreignField: string;
  /** Many rows may match — PostgREST returns an array, so no $unwind. */
  toMany: boolean;
  /** PostgREST's `!inner` — drop rows with no match. */
  inner: boolean;
  /** PostgREST's aggregate form, `children(count)`. */
  count: boolean;
}

/**
 * Split a select list on its TOP-LEVEL commas, leaving nested groups alone.
 */
function splitFields(select: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of select) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current);
  return parts;
}

/**
 * Parse a PostgREST select list into plain fields plus embedded resources.
 *
 * `'id, name, branches(name), actor:profiles(full_name)'`
 *   -> fields ['id','name'], embeds [branches, actor->profiles]
 *
 * NESTING IS THE POINT. The previous implementation matched an embed with
 * `\(([^)]*)\)$`, a character class that cannot contain a closing paren — so
 * `employees(code, full_name, branches(name))` failed to match and fell
 * through to `fields.push(part)`. That produced a projection on a field
 * literally named `employees(code, full_name, branches(name))`, which no
 * document has: no join ran, and the payroll table, the statutory returns and
 * the punch log all rendered blank employee columns with no error anywhere.
 * Here the body is taken by matching the FIRST '(' to the final ')' and parsed
 * recursively, so depth is unlimited.
 *
 * `parentTable` is needed because an embed's join key depends on BOTH sides —
 * see lib/db/relationships.ts.
 */
function parseSelect(select: string, parentTable: string): { fields: string[]; embeds: Embed[] } {
  const fields: string[] = [];
  const embeds: Embed[] = [];

  for (const raw of splitFields(select)) {
    const part = raw.trim();
    if (!part) continue;

    const open = part.indexOf('(');
    if (open === -1) {
      fields.push(part);
      continue;
    }

    // An embed must be `head(body)` with the body closing at the very end.
    // Anything else is malformed and is reported rather than silently treated
    // as a column name.
    if (!part.endsWith(')')) {
      throw new Error(`pgcompat: malformed embed in select list: '${part}'`);
    }
    const head = part.slice(0, open).trim();
    const body = part.slice(open + 1, -1);

    const parsed = /^(?:([\w]+):)?([\w]+)(!inner)?$/.exec(head);
    if (!parsed) {
      throw new Error(`pgcompat: malformed embed in select list: '${part}'`);
    }
    const [, aliasRaw, tableRaw, inner] = parsed;
    const alias = aliasRaw ?? tableRaw;

    const relationship = relationshipFor(parentTable, alias);
    if (!relationship) {
      throw new Error(
        `pgcompat: no relationship declared for '${alias}' on '${parentTable}'. ` +
          'Add one to src/lib/db/relationships.ts — an embed is never joined on a guess.',
      );
    }

    const nested = parseSelect(body, relationship.table);
    // `children(count)` is PostgREST's aggregate, not a column called 'count'.
    const count =
      nested.embeds.length === 0 && nested.fields.length === 1 && nested.fields[0] === 'count';

    embeds.push({
      table: relationship.table,
      alias,
      fields: count ? [] : nested.fields,
      embeds: nested.embeds,
      localField: relationship.localField,
      foreignField: relationship.foreignField,
      toMany: relationship.toMany,
      inner: Boolean(inner),
      count,
    });
  }
  return { fields, embeds };
}

/**
 * The $lookup (+ $unwind) stages for one embed, recursing into its own embeds.
 *
 * The sub-pipeline is where nesting is expressed: a nested embed's stages run
 * INSIDE the parent's lookup, so `employees(code, branches(name))` resolves the
 * branch on each joined employee before the employee is projected.
 *
 * `scope` is the caller. It is threaded all the way down because EVERY joined
 * collection needs its own policy applied: repo.aggregate() prepends the filter
 * for the collection the query started from and says in as many words that a
 * $lookup inside the pipeline is not scoped — which left every embedded select
 * reading the joined collection with no rule in front of it. Postgres applied
 * the joined table's RLS through the join; this is that, restored.
 */
function embedStages(embed: Embed, scope: Scope, parent: string): Document[] {
  const sub: Document[] = [];

  // The joined collection's own read policy, first — before the nested embeds,
  // the projection and any $count, so none of them can see a row it excludes.
  // `parent` lets a collection that the SQL made readable THROUGH this join say
  // so (readableVia); without it, items and payslip_adjustments would vanish
  // from the employee's own dashboard, which is the opposite of what their SQL
  // policies granted.
  const child = collectionFor(embed.table);
  const joined = readFilterFor(child, scope, parent);
  if (Object.keys(joined).length > 0) sub.push({ $match: joined });

  for (const nested of embed.embeds) sub.push(...embedStages(nested, scope, child));

  if (embed.count) {
    // PostgREST returns `[{ count: n }]`, and $count produces exactly that —
    // including an empty array when there are no children, which the callers
    // already read as `?.[0]?.count ?? 0`.
    sub.push({ $count: 'count' });
  } else if (embed.fields.length > 0 && !embed.fields.includes('*')) {
    const projection: Document = {};
    for (const f of embed.fields) projection[col(f)] = 1;
    // Callers read `.id` on an embedded row (leave_salary_workings selects
    // `employees(id, …)`), and the document only carries `_id`.
    projection.id = '$_id';
    for (const child of embed.embeds) projection[child.alias] = 1;
    sub.push({ $project: projection });
  } else {
    // `(*)` means every column. It must NOT become `$project: {'*': 1}`, which
    // projects a field literally named '*' and returns nothing but _id — the
    // reason `payslip_adjustments(*)` came back empty even once its join key
    // was right.
    sub.push({ $addFields: { id: '$_id' } });
  }

  const stages: Document[] = [
    {
      $lookup: {
        from: collectionFor(embed.table),
        localField: embed.localField,
        foreignField: embed.foreignField,
        as: embed.alias,
        pipeline: sub,
      },
    },
  ];

  // A to-one embed is an object in PostgREST; a to-many (and the count
  // aggregate) is an array, so only the former unwinds.
  if (!embed.toMany && !embed.count) {
    stages.push({ $unwind: { path: `$${embed.alias}`, preserveNullAndEmptyArrays: !embed.inner } });
  } else if (embed.inner) {
    stages.push({ $match: { [`${embed.alias}.0`]: { $exists: true } } });
  }
  return stages;
}

/** Collections a PostgREST table name maps to when they differ. */
const TABLE_ALIASES: Record<string, string> = {
  // auth.users + public.profiles merged into one collection.
  profiles: 'users',
};

function collectionFor(table: string): string {
  return TABLE_ALIASES[table] ?? table;
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

/** One `.order()` key: field, direction, and where its nulls belong. */
interface SortKey {
  field: string;
  dir: 1 | -1;
  /** True ⇒ nulls sort after every value, regardless of direction (Postgres). */
  nullsLast: boolean;
}

/**
 * Whether Mongo's native sort already puts this key's nulls where the caller
 * asked. Native treats null/missing as smaller than everything: nulls FIRST
 * ascending, LAST descending. `_id` is never null, so it never needs help.
 */
function nullRankNeeded(k: SortKey): boolean {
  if (k.field === '_id') return false;
  const nativeNullsLast = k.dir === -1;
  return nativeNullsLast !== k.nullsLast;
}

/** Sort spec for a plain find() — only valid when no key needs a null rank. */
function nativeSortSpec(keys: SortKey[]): Record<string, 1 | -1> {
  const spec: Record<string, 1 | -1> = {};
  for (const k of keys) spec[k.field] = k.dir;
  return spec;
}

/**
 * Aggregation stages that realise Postgres null placement.
 *
 * Each key whose placement Mongo would get wrong gets a computed 0/1 rank —
 * 1 when the field is null OR missing (`$ifNull` folds the two, matching how
 * SQL saw the column) — sorted ahead of the field itself. Ranking is per key
 * and interleaved, so `ORDER BY a NULLS LAST, b` ranks a's nulls without
 * disturbing b. Postgres places nulls absolutely (LAST means last whether the
 * sort is ASC or DESC), which is why the rank's direction depends on
 * `nullsLast` alone, not on `dir`.
 *
 * Returns the stages to run before `$sort`, the `$sort` spec, and the helper
 * field names to strip afterwards. The helpers must not leak: a `(*)` select
 * has no `$project` to drop them, so the caller `$unset`s them instead.
 */
function sortStages(keys: SortKey[]): { pre: Document[]; sort: Document; helpers: string[] } {
  const rank: Document = {};
  const sort: Document = {};
  const helpers: string[] = [];
  keys.forEach((k, i) => {
    if (nullRankNeeded(k)) {
      const helper = `__nulls_${i}`;
      helpers.push(helper);
      rank[helper] = {
        $cond: [{ $eq: [{ $ifNull: [`$${k.field}`, null] }, null] }, 1, 0],
      };
      sort[helper] = k.nullsLast ? 1 : -1;
    }
    sort[k.field] = k.dir;
  });
  const pre: Document[] = helpers.length ? [{ $addFields: rank }] : [];
  return { pre, sort, helpers };
}

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------

type Mode = 'select' | 'insert' | 'update' | 'delete' | 'upsert';

class QueryBuilder<T = Document[]> implements PromiseLike<PgResult<T>> {
  /**
   * When true this query runs as the system rather than the signed-in caller —
   * the replacement for the service-role key. Reachable only through
   * systemPgClient(), never from a request path.
   */
  private asSystem = false;

  private filters: Filter<Document>[] = [];
  private sortKeys: SortKey[] = [];
  private limitN: number | null = null;
  private skipN = 0;
  private selectStr = '*';
  private mode: Mode = 'select';
  private payload: Document | Document[] = {};
  private wantSingle: 'one' | 'maybe' | null = null;
  private wantCount: 'exact' | 'planned' | null = null;
  private headOnly = false;
  private returning = false;
  private conflictKeys: string[] = [];
  private ignoreDuplicates = false;

  constructor(private readonly table: string, asSystem = false) {
    this.asSystem = asSystem;
  }

  /** The repository this query runs through — scoped, or system-wide. */
  private async repo(): Promise<ScopedCollection<Document>> {
    const name = collectionFor(this.table);
    return this.asSystem
      ? scopedFor<Document>(name, SYSTEM_SCOPE)
      : scoped<Document>(name);
  }

  /** Who this query runs as. Same rule as repo(), as a scope rather than a handle. */
  private async currentScope(): Promise<Scope> {
    if (this.asSystem) return SYSTEM_SCOPE;
    const scope = await currentScope();
    if (!scope) throw new NotSignedInError();
    return scope;
  }

  // --- shaping -------------------------------------------------------------

  /**
   * Callers may name the row shape: `.select<Row>('a, b')`. The cast is the
   * same promise PostgREST's client made — the database is not consulted about
   * whether the shape is right, the caller asserts it.
   */
  select<S = Document[]>(
    select = '*',
    opts?: { count?: 'exact' | 'planned'; head?: boolean },
  ): QueryBuilder<S> {
    this.selectStr = select;
    if (opts?.count) this.wantCount = opts.count;
    if (opts?.head) this.headOnly = true;
    // After insert/update/delete, .select() means "return the affected rows".
    if (this.mode !== 'select') this.returning = true;
    return this as unknown as QueryBuilder<S>;
  }

  insert(values: Document | Document[]): this {
    this.mode = 'insert';
    this.payload = values;
    return this;
  }

  update(values: Document): this {
    this.mode = 'update';
    this.payload = values;
    return this;
  }

  upsert(
    values: Document | Document[],
    opts?: { onConflict?: string; ignoreDuplicates?: boolean },
  ): this {
    this.mode = 'upsert';
    this.payload = values;
    this.conflictKeys = (opts?.onConflict ?? 'id').split(',').map((k) => col(k.trim()));
    // ON CONFLICT DO NOTHING: keep the existing row untouched rather than
    // overwriting it with the incoming values.
    this.ignoreDuplicates = opts?.ignoreDuplicates ?? false;
    return this;
  }

  delete(): this {
    this.mode = 'delete';
    return this;
  }

  // --- filters -------------------------------------------------------------

  eq(field: string, value: unknown): this { return this.push({ [col(field)]: value }); }
  neq(field: string, value: unknown): this { return this.push({ [col(field)]: { $ne: value } }); }
  gt(field: string, value: unknown): this { return this.push({ [col(field)]: { $gt: value } }); }
  gte(field: string, value: unknown): this { return this.push({ [col(field)]: { $gte: value } }); }
  lt(field: string, value: unknown): this { return this.push({ [col(field)]: { $lt: value } }); }
  lte(field: string, value: unknown): this { return this.push({ [col(field)]: { $lte: value } }); }
  in(field: string, values: unknown[]): this { return this.push({ [col(field)]: { $in: values } }); }

  /** `.is(f, null)` is the only form PostgREST really uses here. */
  is(field: string, value: null | boolean): this {
    return this.push({ [col(field)]: value });
  }

  like(field: string, pattern: string): this {
    return this.push({ [col(field)]: { $regex: likeToRegex(pattern) } });
  }

  ilike(field: string, pattern: string): this {
    return this.push({ [col(field)]: { $regex: likeToRegex(pattern), $options: 'i' } });
  }

  /** Array containment — `contains(f, [a,b])` means the array holds all of them. */
  contains(field: string, values: unknown[]): this {
    return this.push({ [col(field)]: { $all: values } });
  }

  /**
   * `not(f, 'is', null)` is PostgREST for IS NOT NULL.
   *
   * It used to build `{f: {$not: {$ne: null}}}` — the double negative cancels,
   * so it meant IS NULL, the exact opposite. sweep.ts asks for days that HAVE a
   * punch-in; it was handed the days with none, so the nightly auto-close
   * selected unclosable rows and reported success having closed nothing.
   */
  not(field: string, op: string, value: unknown): this {
    if (op === 'is') {
      return this.push({ [col(field)]: { $ne: value === 'null' ? null : value } });
    }
    return this.push({ [col(field)]: { $not: { [`$${op}`]: value } as object } });
  }

  /**
   * `or('a.eq.1,b.eq.2')` — the PostgREST string form, including the nested
   * `and(...)` / `or(...)` groups it allows.
   *
   * Splitting on every comma was not good enough. PostgREST nests groups, and
   * `or('a.lt.X,and(b.is.null,c.lt.X)')` split into three pieces mid-group: the
   * middle one parsed as the FIELD `and(b`, producing `{'and(b': null}`. A
   * missing field reads as null in MongoDB, so that clause matched every
   * document in the collection — and `purgeExpiredNotices()` put it behind a
   * `.delete()`, so publishing one notice erased all of them.
   */
  or(expression: string): this {
    return this.push({ $or: splitTop(expression).map(parseFilterNode) });
  }

  /** `filter(field, op, value)` — the explicit form of everything above. */
  filter(field: string, op: string, value: unknown): this {
    return this.push(operatorClause(field, op, value));
  }

  match(criteria: Document): this {
    const clause: Document = {};
    for (const [k, v] of Object.entries(criteria)) clause[col(k)] = v;
    return this.push(clause);
  }

  // --- modifiers -----------------------------------------------------------

  /**
   * Postgres semantics, including null placement — which MongoDB's native sort
   * gets BACKWARDS on both defaults. Postgres puts nulls LAST ascending and
   * FIRST descending; Mongo treats null/missing as the smallest value, so it
   * does the exact opposite in both directions.
   *
   * That is not a cosmetic difference. The comp-off FIFO
   * (`order('expires_on', { ascending: true, nullsFirst: false })` in
   * compoff.ts and attendance.ts) exists to spend the credit that expires
   * SOONEST; under Mongo's native order the undated, never-expiring credits
   * sorted first and were consumed while the dated ones quietly lapsed — the
   * precise harm the ordering is there to prevent, with no error anywhere.
   *
   * So each key records where its nulls go (the caller's nullsFirst, else the
   * Postgres default for its direction), and execution ranks nulls explicitly
   * whenever Mongo's native placement would disagree — see sortStages(). Keys
   * are kept as an ordered list: sort priority is call order, exactly as in
   * PostgREST.
   */
  order(field: string, opts?: { ascending?: boolean; nullsFirst?: boolean }): this {
    const dir: 1 | -1 = opts?.ascending === false ? -1 : 1;
    // Postgres defaults: ASC ⇒ NULLS LAST, DESC ⇒ NULLS FIRST.
    const nullsFirst = opts?.nullsFirst;
    const nullsLast = nullsFirst === undefined ? dir === 1 : !nullsFirst;
    const f = col(field);
    // Re-ordering the same field replaces the earlier key, as PostgREST does.
    this.sortKeys = this.sortKeys.filter((k) => k.field !== f);
    this.sortKeys.push({ field: f, dir, nullsLast });
    return this;
  }

  limit(n: number): this { this.limitN = n; return this; }

  range(from: number, to: number): this {
    this.skipN = from;
    this.limitN = to - from + 1;
    return this;
  }

  /** Exactly one row; an empty result is an error, as in PostgREST. */
  single<S = Document>(): QueryBuilder<S> {
    this.wantSingle = 'one';
    return this as unknown as QueryBuilder<S>;
  }

  /** One row or null. The common form here. */
  maybeSingle<S = Document>(): QueryBuilder<S | null> {
    this.wantSingle = 'maybe';
    return this as unknown as QueryBuilder<S | null>;
  }

  private push(clause: Filter<Document>): this {
    this.filters.push(clause);
    return this;
  }

  private where(): Filter<Document> {
    if (this.filters.length === 0) return {};
    if (this.filters.length === 1) return this.filters[0];
    return { $and: this.filters };
  }

  // --- execution -----------------------------------------------------------

  then<R1 = PgResult<T>, R2 = never>(
    onfulfilled?: ((value: PgResult<T>) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.run().then(onfulfilled, onrejected);
  }

  private async run(): Promise<PgResult<T>> {
    try {
      // Views are read-only, exactly as they were in Postgres.
      if (isView(this.table)) {
        if (this.mode !== 'select') {
          return {
            data: (this.wantSingle ? null : []) as T,
            error: { message: `cannot ${this.mode} a view` },
            count: null,
          };
        }
        return await this.runView();
      }

      const repo = await this.repo();
      switch (this.mode) {
        case 'select': return await this.runSelect(repo);
        case 'insert': return await this.runInsert(repo);
        case 'upsert': return await this.runUpsert(repo);
        case 'update': return await this.runUpdate(repo);
        case 'delete': return await this.runDelete(repo);
      }
    } catch (e) {
      // The shape the caller expects: an error object, never a throw. A thrown
      // ScopeError is a policy refusal and is reported the same way RLS did.
      return { data: (this.wantSingle ? null : []) as T, error: toPgError(e), count: null };
    }
  }

  /**
   * A view is materialised in full, then filtered in memory.
   *
   * That is a deliberate simplification and it is only safe because of what
   * these five views are: per-branch counts, today's celebrations, per-category
   * asset totals, one row per open exit case. All are bounded by headcount, so
   * "fetch then filter" costs nothing measurable. A view that grew with
   * TRANSACTIONS rather than people would need its filters pushed into the
   * pipeline instead.
   */
  private async runView(): Promise<PgResult<T>> {
    // asSystem has to be honoured HERE as well as in repo(). The view branch of
    // run() is taken before repo() is ever called, so a service-client read of
    // a view used to land in scoped() with no session, throw NotSignedInError
    // and come back as `{data: [], error: 'You are not signed in.'}` — an empty
    // board for the one caller whose whole purpose is running without a user.
    let rows = await runView(this.table, this.asSystem ? SYSTEM_SCOPE : undefined);
    rows = rows.filter((row) => matches(row, this.where()));

    if (this.sortKeys.length) {
      rows = [...rows].sort((a, b) => {
        for (const { field, dir, nullsLast } of this.sortKeys) {
          const av = a[field], bv = b[field];
          const aNull = av === null || av === undefined;
          const bNull = bv === null || bv === undefined;
          if (aNull || bNull) {
            if (aNull && bNull) continue;
            // Postgres places nulls absolutely: LAST is last whether the sort
            // is ascending or descending, so `dir` plays no part here.
            return aNull ? (nullsLast ? 1 : -1) : nullsLast ? -1 : 1;
          }
          if (av === bv) continue;
          return (av < bv ? -1 : 1) * dir;
        }
        return 0;
      });
    }

    const count = this.wantCount ? rows.length : null;
    if (this.headOnly) return { data: null as T, error: null, count: rows.length };

    if (this.skipN) rows = rows.slice(this.skipN);
    if (this.limitN != null) rows = rows.slice(0, this.limitN);

    if (this.wantSingle) {
      if (rows.length === 0) {
        if (this.wantSingle === 'maybe') return { data: null as T, error: null, count };
        return {
          data: null as T,
          error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' },
          count,
        };
      }
      return { data: rows[0] as T, error: null, count };
    }
    return { data: rows as T, error: null, count };
  }

  private async runSelect(repo: ScopedCollection<Document>): Promise<PgResult<T>> {
    const { fields, embeds } = parseSelect(this.selectStr, this.table);

    if (this.headOnly) {
      const count = await repo.countDocuments(this.where());
      return { data: null as T, error: null, count };
    }

    let rows: Document[];
    if (embeds.length > 0) {
      rows = await this.runWithEmbeds(repo, fields, embeds);
    } else if (this.sortKeys.some(nullRankNeeded)) {
      // A sort whose null placement Mongo would get backwards cannot be a plain
      // find(): the rank is a computed field, so the query becomes a pipeline.
      // repo.aggregate() prepends the scope filter, exactly as find() ANDs it.
      const { pre, sort, helpers } = sortStages(this.sortKeys);
      const pipeline: Document[] = [{ $match: this.where() }, ...pre, { $sort: sort }];
      if (this.skipN) pipeline.push({ $skip: this.skipN });
      if (this.limitN != null) pipeline.push({ $limit: this.limitN });
      const projection = buildProjection(fields);
      // An inclusive $project drops the helpers by omission; a `*` select has
      // no $project, so the helpers are stripped explicitly.
      pipeline.push(projection ? { $project: projection } : { $unset: helpers });
      rows = await repo.aggregate(pipeline);
    } else {
      const projection = buildProjection(fields);
      rows = await repo.find(this.where(), {
        ...(projection ? { projection } : {}),
        ...(this.sortKeys.length ? { sort: nativeSortSpec(this.sortKeys) } : {}),
        ...(this.limitN != null ? { limit: this.limitN } : {}),
        ...(this.skipN ? { skip: this.skipN } : {}),
      });
    }

    const mapped = rows.map((r) => outward(r)) as Document[];
    const count = this.wantCount ? await repo.countDocuments(this.where()) : null;

    if (this.wantSingle) {
      if (mapped.length === 0) {
        if (this.wantSingle === 'maybe') return { data: null as T, error: null, count };
        return {
          data: null as T,
          error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' },
          count,
        };
      }
      return { data: mapped[0] as T, error: null, count };
    }
    return { data: mapped as T, error: null, count };
  }

  /** Embedded resources become $lookup stages, run through the scoped aggregate. */
  private async runWithEmbeds(
    repo: ScopedCollection<Document>,
    fields: string[],
    embeds: Embed[],
  ): Promise<Document[]> {
    const pipeline: Document[] = [{ $match: this.where() }];

    // Each embed contributes its own stages and recurses into its nested ones,
    // carrying the caller's scope so each joined collection is filtered by its
    // own policy rather than inheriting the base collection's.
    const scope = await this.currentScope();
    const base = collectionFor(this.table);
    for (const e of embeds) pipeline.push(...embedStages(e, scope, base));

    let helperFields: string[] = [];
    if (this.sortKeys.length) {
      const { pre, sort, helpers } = sortStages(this.sortKeys);
      helperFields = helpers;
      pipeline.push(...pre, { $sort: sort });
    }
    if (this.skipN) pipeline.push({ $skip: this.skipN });
    if (this.limitN != null) pipeline.push({ $limit: this.limitN });

    const projection = buildProjection(fields);
    if (projection) {
      for (const e of embeds) projection[e.alias] = 1;
      pipeline.push({ $project: projection });
    } else if (helperFields.length) {
      // No $project to drop them by omission, so the rank helpers go here.
      pipeline.push({ $unset: helperFields });
    }

    return repo.aggregate(pipeline);
  }

  private async runInsert(repo: ScopedCollection<Document>): Promise<PgResult<T>> {
    const docs = (Array.isArray(this.payload) ? this.payload : [this.payload])
      .map(withId)
      .map((d) => withDefaults(this.table, d));

    // `insert([])` was a no-op success in PostgREST; the driver throws
    // "Batch cannot be empty". onboarding.ts inserts a template's items without
    // guarding for a template that has none.
    if (docs.length === 0) {
      return { data: (this.wantSingle ? null : []) as T, error: null, count: 0 };
    }

    await repo.insertMany(docs as never[]);
    const data = this.returning ? docs.map((d) => outward(d)) : [];
    return {
      data: (this.wantSingle ? (data[0] ?? null) : data) as T,
      error: null,
      count: docs.length,
    };
  }

  private async runUpsert(repo: ScopedCollection<Document>): Promise<PgResult<T>> {
    const inputs = (Array.isArray(this.payload) ? this.payload : [this.payload]).map(withId);
    const out: Document[] = [];
    for (const provided of inputs) {
      const doc = withDefaults(this.table, provided);
      const key: Document = {};
      for (const k of this.conflictKeys) key[k] = doc[k];

      if (this.ignoreDuplicates) {
        // DO NOTHING on conflict: everything moves to $setOnInsert, so an
        // existing row is matched and left exactly as it was.
        await repo.upsertOne(key, { $setOnInsert: doc }, doc);
      } else {
        // A default describes a NEW row only. Putting one in $set would stamp
        // created_at — and reset status — on every existing row this matches, so
        // the generated fields go to $setOnInsert alongside the key.
        const { _id, ...rest } = provided;
        const set = touched(this.table, rest);
        const onInsert: Document = { _id };
        for (const [field, value] of Object.entries(doc)) {
          // A field in $set must NOT also appear in $setOnInsert. MongoDB
          // rejects the pair outright — error 40, "would create a conflict at
          // '<field>'" — and `updated_at` landed in both every single time:
          // withDefaults() puts it in `doc` because the column carries a
          // default, and touched() puts it in `set` because that same default
          // is what marks the collection as carrying the old BEFORE UPDATE
          // trigger. So every upsert the app makes failed before it reached
          // the collection: punch in/out, the attendance correction and bulk
          // save, the register import, comp-off settle, settings, payslip
          // adjustments, the leave-salary snapshot and full-and-final.
          if (field in set) continue;
          onInsert[field] = value;
        }
        await repo.upsertOne(key, { $set: set, $setOnInsert: onInsert }, doc);
      }

      if (!this.returning) continue;
      // Read the row back rather than echoing the payload.
      //
      // The payload is not what is stored. An upsert that lands on an EXISTING
      // row keeps THAT row's `_id`, so echoing `doc` handed the caller a
      // freshly minted id belonging to no document — and, worse, made
      // `.upsert(...).select().maybeSingle()` unconditionally truthy, so the
      // "no row back means the write was filtered" branch after every upsert
      // in the app (attendance.ts's "your role may not have permission", and
      // its siblings) was unreachable code.
      const saved = await repo.findOne(key);
      if (saved) out.push(outward(saved) as Document);
    }
    return {
      data: (this.wantSingle ? (out[0] ?? null) : out) as T,
      error: null,
      count: inputs.length,
    };
  }

  private async runUpdate(repo: ScopedCollection<Document>): Promise<PgResult<T>> {
    const where = this.where();

    // Capture WHICH rows the WRITE will touch before writing, then re-read
    // those by id. Two opposite mistakes are being avoided here.
    //
    // Re-reading with the same filter AFTERWARDS finds nothing whenever the
    // update changes a column the filter tests — and
    // `.eq('status','pending').update({status:'approved'}).select()` is the
    // shape every approval path uses. `wroteNothing(data)` then reported a
    // failure on a write that had in fact succeeded: leave approval told the
    // reviewer "already reviewed by someone else" while the row flipped, and
    // the balance deduction and notifications behind that check never ran.
    //
    // Reading through the READ policy is the mirror-image mistake, and the
    // more dangerous one. The read policy is the wider of the two, so a row
    // the caller may see but may not write came back looking updated: an
    // employee's own already-approved reimbursement matched staffOrOwn on the
    // read while the write matched nothing, and the action went on to report
    // success, revalidate, log an event and notify for a write that never
    // happened. findForWrite() asks the question the guard is asking.
    const ids = this.returning
      ? (await repo.findForWrite(where, { projection: { _id: 1 } })).map((r) => r._id)
      : [];

    const matched = await repo.updateMany(where, {
      $set: touched(this.table, this.payload as Document),
    });

    const data =
      this.returning && matched > 0 && ids.length > 0
        ? (await repo.find({ _id: { $in: ids } })).map((r) => outward(r))
        : [];
    return {
      data: (this.wantSingle ? (data[0] ?? null) : data) as T,
      error: null,
      count: matched,
    };
  }

  private async runDelete(repo: ScopedCollection<Document>): Promise<PgResult<T>> {
    const where = this.where();
    // Read before deleting when the caller wants the rows back — afterwards
    // there is nothing left to return. Through the WRITE policy, for the same
    // reason as runUpdate: reading with the wider read policy handed back rows
    // as "deleted" for a delete that removed none of them.
    const doomed = this.returning ? await repo.findForWrite(where) : [];
    const removed = await repo.deleteMany(where);
    const data = removed > 0 ? doomed.map((r) => outward(r)) : [];
    return {
      data: (this.wantSingle ? (data[0] ?? null) : data) as T,
      error: null,
      count: removed,
    };
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function withId(doc: Document): Document {
  if (doc._id) return doc;
  if (doc.id) {
    const { id, ...rest } = doc;
    return { _id: id, ...rest };
  }
  return { _id: crypto.randomUUID(), ...doc };
}

function resolveDefault(value: DefaultValue): unknown {
  if (value === NOW) return new Date();
  // `current_date` meant the IST calendar date to this app; todayIST() is the
  // single definition of it. See the note on the import.
  if (value === TODAY) return todayIST();
  // A fresh object per document — sharing one literal would let two rows alias
  // the same jsonb value, so mutating one would change the other.
  if (value !== null && typeof value === 'object' && value.constructor === Object) return {};
  return value;
}

/**
 * Fill in the column defaults Postgres used to supply.
 *
 * MongoDB has no column defaults, so a ported INSERT that omitted `status`,
 * `created_at` or `updated_at` — every one of them NOT NULL with a DEFAULT in
 * the DDL — wrote an incomplete document and the collection validator rejected
 * it as error 121. Only ABSENT fields are filled: an explicit null the caller
 * passed is a real value and is left alone.
 */
function withDefaults(table: string, doc: Document): Document {
  const defaults = COLUMN_DEFAULTS[collectionFor(table)];
  if (!defaults) return doc;
  const out = { ...doc };
  for (const [field, value] of Object.entries(defaults)) {
    if (out[field] === undefined) out[field] = resolveDefault(value);
  }
  return out;
}

/**
 * The `set_updated_at()` BEFORE UPDATE trigger, which 12 tables carried.
 *
 * Applied to any collection whose DDL declared an `updated_at` default — the
 * same set the trigger covered. A caller that sets `updated_at` itself wins.
 */
function touched(table: string, payload: Document): Document {
  const defaults = COLUMN_DEFAULTS[collectionFor(table)];
  if (!defaults?.updated_at || payload.updated_at !== undefined) return payload;
  return { ...payload, updated_at: new Date() };
}

function buildProjection(fields: string[]): Document | null {
  if (fields.length === 0 || fields.includes('*')) return null;
  const p: Document = {};
  for (const f of fields) p[col(f)] = 1;
  return p;
}

/** SQL LIKE to a regex: % is any run, _ is any single character. */
function likeToRegex(pattern: string): string {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return `^${escaped.replace(/%/g, '.*').replace(/_/g, '.')}$`;
}

/**
 * Evaluate a filter against one in-memory document.
 *
 * Supports only the operators the view call sites actually use — equality,
 * $in, $ne and the comparisons. Anything else throws rather than quietly
 * matching everything, because a filter that silently does nothing on a view is
 * how a screen ends up showing another branch's rows.
 */
function matches(row: Document, filter: Document): boolean {
  for (const [key, cond] of Object.entries(filter)) {
    if (key === '$and') {
      if (!(cond as Document[]).every((c) => matches(row, c))) return false;
      continue;
    }
    if (key === '$or') {
      if (!(cond as Document[]).some((c) => matches(row, c))) return false;
      continue;
    }
    // parseFilterNode emits $nor for every negation — `not.and(...)`,
    // `not.or(...)` and `field.not.<op>.<value>`. Without this case the key fell
    // through to `row['$nor']`, which is undefined, and the comparison at the
    // bottom then rejected EVERY row: a view query carrying any negation
    // returned nothing at all.
    if (key === '$nor') {
      if ((cond as Document[]).some((c) => matches(row, c))) return false;
      continue;
    }

    const value = row[key === '_id' ? 'id' : key] ?? row[key];
    if (cond !== null && typeof cond === 'object' && !Array.isArray(cond)) {
      // $options belongs to $regex and has to be read BEFORE it, not skipped
      // when the loop reaches it. Dropping it made ilike() case-SENSITIVE on a
      // view while the identical call against a collection was not — so
      // filtering v_items for 'laptop' found nothing when the row said
      // 'Laptop', and only on the screens backed by a view.
      const regexFlags =
        typeof (cond as Document).$options === 'string' ? ((cond as Document).$options as string) : '';
      for (const [op, operand] of Object.entries(cond as Document)) {
        switch (op) {
          case '$eq': if (value !== operand) return false; break;
          case '$ne': if (value === operand) return false; break;
          case '$in': if (!(operand as unknown[]).includes(value)) return false; break;
          case '$nin': if ((operand as unknown[]).includes(value)) return false; break;
          case '$gt': if (!(value > (operand as never))) return false; break;
          case '$gte': if (!(value >= (operand as never))) return false; break;
          case '$lt': if (!(value < (operand as never))) return false; break;
          case '$lte': if (!(value <= (operand as never))) return false; break;
          case '$regex':
            if (!new RegExp(operand as string, regexFlags).test(String(value))) return false;
            break;
          case '$not': if (matches(row, { [key]: operand as Document })) return false; break;
          case '$options': break; // read above, alongside $regex
          default:
            throw new Error(`pgcompat: operator '${op}' is not supported on a view`);
        }
      }
      continue;
    }
    if (value !== cond) return false;
  }
  return true;
}

/**
 * Split a PostgREST boolean expression on its TOP-LEVEL commas, leaving the
 * commas inside a nested `and(...)` / `or(...)` group alone.
 */
function splitTop(expression: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of expression) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** One node of such an expression: a nested group, or a `field.op.value` triple. */
function parseFilterNode(part: string): Document {
  const group = /^(and|or|not\.and|not\.or)\((.*)\)$/s.exec(part);
  if (group) {
    const [, kind, inner] = group;
    const clauses = splitTop(inner).map(parseFilterNode);
    if (kind === 'and') return { $and: clauses };
    if (kind === 'or') return { $or: clauses };
    // PostgREST's negated groups: not.and(...) / not.or(...).
    return { $nor: [kind === 'not.and' ? { $and: clauses } : { $or: clauses }] };
  }

  const [field, op, ...rest] = part.split('.');
  if (!field || !op) {
    // Never fall through to something that quietly matches everything — that is
    // exactly how this became a delete-the-table bug.
    throw new Error(`pgcompat: cannot parse filter expression '${part}'`);
  }

  // PostgREST negates an operator by putting `not` BEFORE it: the shape is
  // `field.not.<op>.<value>`, so the real operator is the next segment.
  //
  // Splitting blindly made `status.not.eq.pending` parse as op='not' with the
  // value 'eq.pending', which the clause below turned into
  // `{status: {$ne: 'eq.pending'}}` — true of every document. The negation was
  // dropped and the filter widened to the whole collection, which is the one
  // failure mode the or() docstring says this file exists to prevent.
  if (op === 'not') {
    const [innerOp, ...innerRest] = rest;
    if (!innerOp) throw new Error(`pgcompat: cannot parse filter expression '${part}'`);
    return { $nor: [operatorClause(field, innerOp, innerRest.join('.'))] };
  }

  return operatorClause(field, op, rest.join('.'));
}

function operatorClause(field: string, op: string, value: unknown): Document {
  const f = col(field);
  switch (op) {
    case 'eq': return { [f]: value };
    case 'neq': return { [f]: { $ne: value } };
    case 'gt': return { [f]: { $gt: value } };
    case 'gte': return { [f]: { $gte: value } };
    case 'lt': return { [f]: { $lt: value } };
    case 'lte': return { [f]: { $lte: value } };
    case 'is': return { [f]: value === 'null' ? null : value };
    case 'in': {
      const list = typeof value === 'string'
        ? value.replace(/^\(|\)$/g, '').split(',')
        : (value as unknown[]);
      return { [f]: { $in: list } };
    }
    case 'like': return { [f]: { $regex: likeToRegex(String(value)) } };
    case 'ilike': return { [f]: { $regex: likeToRegex(String(value)), $options: 'i' } };
    default:
      throw new Error(`pgcompat: unsupported operator '${op}' on '${field}'`);
  }
}

// ---------------------------------------------------------------------------
// client
// ---------------------------------------------------------------------------

export interface PgClient {
  from<T = Document[]>(table: string): QueryBuilder<T>;
  rpc<T = unknown>(name: string, args?: Document): Promise<PgResult<T>>;
}

/**
 * A client with the surface the app already calls.
 *
 * Not async and takes no cookies: the session is resolved per query inside
 * scoped(), so there is nothing to construct up front. It stays a function so
 * `const dbc = await createClient()` keeps working unchanged.
 */
export function pgClient(asSystem = false): PgClient {
  return {
    from<T = Document[]>(table: string) {
      return new QueryBuilder<T>(table, asSystem);
    },
    async rpc<T = unknown>(name: string, args: Document = {}): Promise<PgResult<T>> {
      const fn = RPC.get(name);
      if (!fn) {
        return {
          data: null as T,
          error: { message: `pgcompat: no TypeScript implementation registered for '${name}'` },
        };
      }
      try {
        return { data: (await fn(args)) as T, error: null };
      } catch (e) {
        return { data: null as T, error: toPgError(e) };
      }
    },
  };
}

/**
 * The system client — what createServiceClient() used to return.
 *
 * Bypasses every collection policy, exactly as the service-role key bypassed
 * RLS. For scheduled jobs and migrations only; never reachable from a request.
 */
export function systemPgClient(): PgClient {
  return pgClient(true);
}

/**
 * Replacements for the plpgsql functions the app called through `.rpc()`.
 *
 * Registered rather than imported directly so a caller that has not been ported
 * yet gets a clear "not implemented" error instead of a silent null.
 */
const RPC = new Map<string, (args: Document) => Promise<unknown>>();

export function registerRpc(name: string, fn: (args: Document) => Promise<unknown>): void {
  RPC.set(name, fn);
}

/** Unscoped handle, for the few jobs that legitimately run as the system. */
export async function rawDb() {
  return db();
}