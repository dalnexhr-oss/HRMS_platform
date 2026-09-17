/**
 * Build MongoDB queries and dispatch server-side database functions.
 * Collection access is checked through repo.ts using the query's access scope.
 */
import 'server-only';
import { NotSignedInError, ScopeError, readFilterFor, scoped, scopedFor } from '@/lib/db/repo';
import { queryErrorCodes } from '@/lib/db/errors';
import { currentScope, systemScope } from '@/lib/db/scope';
import { db } from '@/lib/db/mongo';
import { columnDefaults, now, today } from '@/lib/db/defaults';
import { isView, runView } from '@/lib/db/views';
import { relationshipFor } from '@/lib/db/relationships';
import { todayIST } from '@/lib/format';
import type { Document, Filter } from 'mongodb';
import type { Scope } from '@/lib/db/scope';
import type { ScopedCollection } from '@/lib/db/repo';
import type { DefaultValue } from '@/lib/db/defaults';

export interface QueryResult<T> {
  data: T;
  error: QueryError | null;
  count?: number | null;
}

export interface QueryError {
  message: string;
  code?: string;
  details?: string;
}

function toQueryError(e: unknown): QueryError {
  if (e instanceof ScopeError) {
    return { message: e.message, code: queryErrorCodes.permissionDenied };
  }
  if (e instanceof NotSignedInError) {
    return { message: e.message, code: queryErrorCodes.notSignedIn };
  }
  const err = e as { code?: number | string; message?: string; errInfo?: unknown };
  if (err?.code === 11000) {
    return {
      message: 'A record with these values already exists.',
      code: queryErrorCodes.duplicateKey,
    };
  }
  if (err?.code === 121) {
    return {
      message: 'Document validation failed.',
      code: queryErrorCodes.validationFailed,
      details: JSON.stringify(err.errInfo ?? {}),
    };
  }
  return { message: err?.message ?? String(e) };
}

// `id` is `_id` in MongoDB; everything else keeps its name.
function col(name: string): string {
  return name === 'id' ? '_id' : name;
}

// Documents come back with `_id`; callers expect `id`. Both are provided.
function outward<T extends Document>(doc: T | null): T | null {
  if (!doc) {
    return null;
  }
  if ('_id' in doc && !('id' in doc)) {
    return { ...doc, id: doc._id } as T;
  }
  return doc;
}

// Embedded selects

interface Embed {
  // Collection to join, e.g. 'branches'.
  table: string;
  // Alias in the result, e.g. 'branches' or 'actor'.
  alias: string;
  // Selected columns. A single '*' means every column.
  fields: string[];
  // Embeds nested INSIDE this one, e.g. employees(…, branches(name)).
  embeds: Embed[];
  // Field on the local document, or `_id` when the child holds the key.
  localField: string;
  // Field on the joined document, `_id` for an ordinary to-one join.
  foreignField: string;
  // Multiple matches remain an array, so no $unwind is needed.
  toMany: boolean;
  // `!inner` drops rows with no matching related document.
  inner: boolean;
  // `children(count)` returns the number of related documents.
  count: boolean;
}

// Split a select list on its TOP-LEVEL commas, leaving nested groups alone.
function splitFields(select: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of select) {
    if (ch === '(') {
      depth++;
    }
    if (ch === ')') {
      depth--;
    }
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) {
    parts.push(current);
  }
  return parts;
}

/**
 * Recursively parses a select clause into scalar fields and embedded relations.
 * Handles nested sub-resources (e.g. `'id, name, branches(name), actor:profiles(full_name)'`).
 */
function parseSelect(select: string, parentTable: string): { fields: string[]; embeds: Embed[] } {
  const fields: string[] = [];
  const embeds: Embed[] = [];

  for (const raw of splitFields(select)) {
    const part = raw.trim();
    if (!part) {
      continue;
    }

    const open = part.indexOf('(');
    if (open === -1) {
      fields.push(part);
      continue;
    }

    // An embed must be `head(body)` with the body closing at the very end.
    // Anything else is malformed and is reported rather than silently treated
    // as a column name.
    if (!part.endsWith(')')) {
      throw new Error(`query-client: malformed embed in select list: '${part}'`);
    }
    const head = part.slice(0, open).trim();
    const body = part.slice(open + 1, -1);

    const parsed = /^(?:([\w]+):)?([\w]+)(!inner)?$/.exec(head);
    if (!parsed) {
      throw new Error(`query-client: malformed embed in select list: '${part}'`);
    }
    const [, aliasRaw, tableRaw, inner] = parsed;
    const alias = aliasRaw ?? tableRaw;

    const relationship = relationshipFor(parentTable, alias);
    if (!relationship) {
      throw new Error(
        `query-client: no relationship declared for '${alias}' on '${parentTable}'. ` +
          'Add one to src/lib/db/relationships.ts — an embed is never joined on a guess.',
      );
    }

    const nested = parseSelect(body, relationship.table);
    // `children(count)` requests an aggregate rather than a field named 'count'.
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
 * Builds MongoDB `$lookup` and `$unwind` aggregation stages for embedded relations.
 * Recursively embeds nested sub-pipelines and applies policy filters for each joined collection.
 */
function embedStages(embed: Embed, scope: Scope, parent: string): Document[] {
  const sub: Document[] = [];

  // Apply the joined collection's read policy before embeds, projections, and counts. parent
  // enables policies that grant access through an owned parent row.
  const child = collectionFor(embed.table);
  const joined = readFilterFor(child, scope, parent);
  if (Object.keys(joined).length > 0) {
    sub.push({ $match: joined });
  }

  for (const nested of embed.embeds) {
    sub.push(...embedStages(nested, scope, child));
  }

  if (embed.count) {
    // $count returns [{ count: n }], or an empty array when no documents match.
    // Callers read the result as `?.[0]?.count ?? 0`.
    sub.push({ $count: 'count' });
  } else if (embed.fields.length > 0 && !embed.fields.includes('*')) {
    const projection: Document = {};
    for (const f of embed.fields) {
      projection[col(f)] = 1;
    }
    // Callers read `.id` on an embedded row (leave_salary_workings selects
    // `employees(id, …)`), and the document only carries `_id`.
    projection.id = '$_id';
    for (const child of embed.embeds) {
      projection[child.alias] = 1;
    }
    sub.push({ $project: projection });
  } else {
    // A wildcard selects all fields, so omit projection rather than projecting a literal '*'
    // field.
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

  // A single related document is returned as an object; multiple documents and
  // count aggregates remain arrays, so only single-document relations unwind.
  if (!embed.toMany && !embed.count) {
    stages.push({ $unwind: { path: `$${embed.alias}`, preserveNullAndEmptyArrays: !embed.inner } });
  } else if (embed.inner) {
    stages.push({ $match: { [`${embed.alias}.0`]: { $exists: true } } });
  }
  return stages;
}

/** Query names that map to differently named MongoDB collections. */
const tableAliases: Record<string, string> = {
  // Profile queries read user documents.
  profiles: 'users',
};

function collectionFor(table: string): string {
  return tableAliases[table] ?? table;
}

// Sorting

/** One `.order()` key: field, direction, and where its nulls belong. */
interface SortKey {
  field: string;
  dir: 1 | -1;
  /** Whether null values sort after non-null values. */
  nullsLast: boolean;
}

/**
 * Whether Mongo's native sort already puts this key's nulls where the caller
 * asked. Native treats null/missing as smaller than everything: nulls FIRST
 * ascending, LAST descending. `_id` is never null, so it never needs help.
 */
function nullRankNeeded(k: SortKey): boolean {
  if (k.field === '_id') {
    return false;
  }
  const nativeNullsLast = k.dir === -1;
  return nativeNullsLast !== k.nullsLast;
}

/** Sort spec for a plain find() — only valid when no key needs a null rank. */
function nativeSortSpec(keys: SortKey[]): Record<string, 1 | -1> {
  const spec: Record<string, 1 | -1> = {};
  for (const k of keys) {
    spec[k.field] = k.dir;
  }
  return spec;
}

/**
 * Generates aggregation pipeline stages to enforce explicit null ordering semantics.
 * Computes an auxiliary rank field for keys where default BSON null ordering differs from requested placement.
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

// The builder

type Mode = 'select' | 'insert' | 'update' | 'delete' | 'upsert';

class QueryBuilder<T = Document[]> implements PromiseLike<QueryResult<T>> {
  /**
   * Run with system scope when explicitly requested by trusted server code.
   * The default scope uses the signed-in caller's collection policies.
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

  constructor(
    private readonly table: string,
    asSystem = false,
  ) {
    this.asSystem = asSystem;
  }

  /** The repository this query runs through — scoped, or system-wide. */
  private async repo(): Promise<ScopedCollection<Document>> {
    const name = collectionFor(this.table);
    return this.asSystem ? scopedFor<Document>(name, systemScope) : scoped<Document>(name);
  }

  /** Who this query runs as. Same rule as repo(), as a scope rather than a handle. */
  private async currentScope(): Promise<Scope> {
    if (this.asSystem) {
      return systemScope;
    }
    const scope = await currentScope();
    if (!scope) {
      throw new NotSignedInError();
    }
    return scope;
  }

  // shaping

  /**
   * Sets projection fields and optional count mode.
   * Type parameter asserts expected return shape without runtime schema validation.
   */
  select<S = Document[]>(
    select = '*',
    opts?: { count?: 'exact' | 'planned'; head?: boolean },
  ): QueryBuilder<S> {
    this.selectStr = select;
    if (opts?.count) {
      this.wantCount = opts.count;
    }
    if (opts?.head) {
      this.headOnly = true;
    }
    // After insert/update/delete, .select() means "return the affected rows".
    if (this.mode !== 'select') {
      this.returning = true;
    }
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

  // filters

  eq(field: string, value: unknown): this {
    return this.push({ [col(field)]: value });
  }
  neq(field: string, value: unknown): this {
    return this.push({ [col(field)]: { $ne: value } });
  }
  gt(field: string, value: unknown): this {
    return this.push({ [col(field)]: { $gt: value } });
  }
  gte(field: string, value: unknown): this {
    return this.push({ [col(field)]: { $gte: value } });
  }
  lt(field: string, value: unknown): this {
    return this.push({ [col(field)]: { $lt: value } });
  }
  lte(field: string, value: unknown): this {
    return this.push({ [col(field)]: { $lte: value } });
  }
  in(field: string, values: unknown[]): this {
    return this.push({ [col(field)]: { $in: values } });
  }

  /** Matches null or boolean values on a field. */
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

  /** Negated filter operator; handles null checks and sub-document negation. */
  not(field: string, op: string, value: unknown): this {
    if (op === 'is') {
      return this.push({ [col(field)]: { $ne: value === 'null' ? null : value } });
    }
    return this.push({ [col(field)]: { $not: { [`$${op}`]: value } as object } });
  }

  /** Parses logical OR filter expressions, including nested groups. */
  or(expression: string): this {
    return this.push({ $or: splitTop(expression).map(parseFilterNode) });
  }

  /** `filter(field, op, value)` — the explicit form of everything above. */
  filter(field: string, op: string, value: unknown): this {
    return this.push(operatorClause(field, op, value));
  }

  match(criteria: Document): this {
    const clause: Document = {};
    for (const [k, v] of Object.entries(criteria)) {
      clause[col(k)] = v;
    }
    return this.push(clause);
  }

  // modifiers

  /**
   * Configures sort direction and null placement semantics for a field.
   * Interleaves null-ranking stages when native ordering differs from requested placement.
   */
  order(field: string, opts?: { ascending?: boolean; nullsFirst?: boolean }): this {
    const dir: 1 | -1 = opts?.ascending === false ? -1 : 1;
    // Default null ordering: ASC => NULLS LAST, DESC => NULLS FIRST.
    const nullsFirst = opts?.nullsFirst;
    const nullsLast = nullsFirst === undefined ? dir === 1 : !nullsFirst;
    const f = col(field);
    // Replace duplicate sort specifications for the same field.
    this.sortKeys = this.sortKeys.filter((k) => k.field !== f);
    this.sortKeys.push({ field: f, dir, nullsLast });
    return this;
  }

  limit(n: number): this {
    this.limitN = n;
    return this;
  }

  range(from: number, to: number): this {
    this.skipN = from;
    this.limitN = to - from + 1;
    return this;
  }

  /** Exactly one matching document; throws if empty. */
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
    if (this.filters.length === 0) {
      return {};
    }
    if (this.filters.length === 1) {
      return this.filters[0];
    }
    return { $and: this.filters };
  }

  // execution

  then<R1 = QueryResult<T>, R2 = never>(
    onfulfilled?: ((value: QueryResult<T>) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.run().then(onfulfilled, onrejected);
  }

  private async run(): Promise<QueryResult<T>> {
    try {
      // Views are read-only aggregations.
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
        case 'select':
          return await this.runSelect(repo);
        case 'insert':
          return await this.runInsert(repo);
        case 'upsert':
          return await this.runUpsert(repo);
        case 'update':
          return await this.runUpdate(repo);
        case 'delete':
          return await this.runDelete(repo);
      }
    } catch (e) {
      // Return query failures and policy refusals in the error field expected by callers.
      return { data: (this.wantSingle ? null : []) as T, error: toQueryError(e), count: null };
    }
  }

  /**
   * Materialize bounded summary views before filtering in memory. Views that grow with transaction
   * volume need their filters pushed into the aggregation pipeline.
   */
  private async runView(): Promise<QueryResult<T>> {
    // Pass system scope to views explicitly because this branch runs before repo() is called.
    let rows = await runView(this.table, this.asSystem ? systemScope : undefined);
    rows = rows.filter((row) => matches(row, this.where()));

    if (this.sortKeys.length) {
      rows = [...rows].sort((a, b) => {
        for (const { field, dir, nullsLast } of this.sortKeys) {
          const av = a[field],
            bv = b[field];
          const aNull = av === null || av === undefined;
          const bNull = bv === null || bv === undefined;
          if (aNull || bNull) {
            if (aNull && bNull) {
              continue;
            }
            // Absolute null placement: nullsLast overrides sort direction.
            return aNull ? (nullsLast ? 1 : -1) : nullsLast ? -1 : 1;
          }
          if (av === bv) {
            continue;
          }
          return (av < bv ? -1 : 1) * dir;
        }
        return 0;
      });
    }

    const count = this.wantCount ? rows.length : null;
    if (this.headOnly) {
      return { data: null as T, error: null, count: rows.length };
    }

    if (this.skipN) {
      rows = rows.slice(this.skipN);
    }
    if (this.limitN != null) {
      rows = rows.slice(0, this.limitN);
    }

    if (this.wantSingle) {
      if (rows.length === 0) {
        if (this.wantSingle === 'maybe') {
          return { data: null as T, error: null, count };
        }
        return {
          data: null as T,
          error: {
            message: 'No matching document found',
            code: queryErrorCodes.noResult,
          },
          count,
        };
      }
      return { data: rows[0] as T, error: null, count };
    }
    return { data: rows as T, error: null, count };
  }

  private async runSelect(repo: ScopedCollection<Document>): Promise<QueryResult<T>> {
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
      if (this.skipN) {
        pipeline.push({ $skip: this.skipN });
      }
      if (this.limitN != null) {
        pipeline.push({ $limit: this.limitN });
      }
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
        if (this.wantSingle === 'maybe') {
          return { data: null as T, error: null, count };
        }
        return {
          data: null as T,
          error: {
            message: 'No matching document found',
            code: queryErrorCodes.noResult,
          },
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
    for (const e of embeds) {
      pipeline.push(...embedStages(e, scope, base));
    }

    let helperFields: string[] = [];
    if (this.sortKeys.length) {
      const { pre, sort, helpers } = sortStages(this.sortKeys);
      helperFields = helpers;
      pipeline.push(...pre, { $sort: sort });
    }
    if (this.skipN) {
      pipeline.push({ $skip: this.skipN });
    }
    if (this.limitN != null) {
      pipeline.push({ $limit: this.limitN });
    }

    const projection = buildProjection(fields);
    if (projection) {
      for (const e of embeds) {
        projection[e.alias] = 1;
      }
      pipeline.push({ $project: projection });
    } else if (helperFields.length) {
      // No $project to drop them by omission, so the rank helpers go here.
      pipeline.push({ $unset: helperFields });
    }

    return repo.aggregate(pipeline);
  }

  private async runInsert(repo: ScopedCollection<Document>): Promise<QueryResult<T>> {
    const docs = (Array.isArray(this.payload) ? this.payload : [this.payload])
      .map(withId)
      .map((d) => withDefaults(this.table, d));

    // Empty insert array is treated as a no-op returning an empty result.
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

  private async runUpsert(repo: ScopedCollection<Document>): Promise<QueryResult<T>> {
    const inputs = (Array.isArray(this.payload) ? this.payload : [this.payload]).map(withId);
    const out: Document[] = [];
    for (const provided of inputs) {
      const doc = withDefaults(this.table, provided);
      const key: Document = {};
      for (const k of this.conflictKeys) {
        key[k] = doc[k];
      }

      if (this.ignoreDuplicates) {
        // DO NOTHING on conflict: everything moves to $setOnInsert, so an
        // existing row is matched and left exactly as it was.
        await repo.upsertOne(key, { $setOnInsert: doc }, doc);
      } else {
        // Apply defaults with $setOnInsert so existing rows keep created_at and their current
        // status.
        const { _id, ...rest } = provided;
        const set = touched(this.table, rest);
        const onInsert: Document = { _id };
        for (const [field, value] of Object.entries(doc)) {
          // Remove $set fields from $setOnInsert. MongoDB rejects overlapping paths, including
          // updated_at supplied by both defaults and touched().
          if (field in set) {
            continue;
          }
          onInsert[field] = value;
        }
        await repo.upsertOne(key, { $set: set, $setOnInsert: onInsert }, doc);
      }

      if (!this.returning) {
        continue;
      }
      // Read back the stored row. An upsert into an existing document retains its ID, so echoing
      // the insertion payload would return an unused ID and misreport filtered writes.
      const saved = await repo.findOne(key);
      if (saved) {
        out.push(outward(saved) as Document);
      }
    }
    return {
      data: (this.wantSingle ? (out[0] ?? null) : out) as T,
      error: null,
      count: inputs.length,
    };
  }

  private async runUpdate(repo: ScopedCollection<Document>): Promise<QueryResult<T>> {
    const where = this.where();

    // Capture writable IDs before updating, then read those IDs back. The update may change fields
    // in the original filter. Use the write policy here: read access alone must not make a rejected
    // mutation appear successful.
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

  private async runDelete(repo: ScopedCollection<Document>): Promise<QueryResult<T>> {
    const where = this.where();
    // Read returned rows through the write policy before deleting, so the response cannot claim
    // inaccessible rows were deleted.
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

// helpers

function withId(doc: Document): Document {
  if (doc._id) {
    return doc;
  }
  if (doc.id) {
    const { id, ...rest } = doc;
    return { _id: id, ...rest };
  }
  return { _id: crypto.randomUUID(), ...doc };
}

function resolveDefault(value: DefaultValue): unknown {
  if (value === now) {
    return new Date();
  }
  // Calendar-day defaults use the shared IST business date.
  if (value === today) {
    return todayIST();
  }
  // Create a fresh object so documents do not share mutable default values.
  if (value !== null && typeof value === 'object' && value.constructor === Object) {
    return {};
  }
  return value;
}

/**
 * Injects pre-configured column defaults for omitted document properties.
 * Preserves explicit null values provided by the caller.
 */
function withDefaults(table: string, doc: Document): Document {
  const defaults = columnDefaults[collectionFor(table)];
  if (!defaults) {
    return doc;
  }
  const out = { ...doc };
  for (const [field, value] of Object.entries(defaults)) {
    if (out[field] === undefined) {
      out[field] = resolveDefault(value);
    }
  }
  return out;
}

/**
 * Stamp updated_at on collections that declare the default, unless the caller supplies an explicit
 * value.
 */
function touched(table: string, payload: Document): Document {
  const defaults = columnDefaults[collectionFor(table)];
  if (!defaults?.updated_at || payload.updated_at !== undefined) {
    return payload;
  }
  return { ...payload, updated_at: new Date() };
}

function buildProjection(fields: string[]): Document | null {
  if (fields.length === 0 || fields.includes('*')) {
    return null;
  }
  const p: Document = {};
  for (const f of fields) {
    p[col(f)] = 1;
  }
  return p;
}

/** SQL LIKE to a regex: % is any run, _ is any single character. */
function likeToRegex(pattern: string): string {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return `^${escaped.replace(/%/g, '.*').replace(/_/g, '.')}$`;
}

/**
 * Evaluate supported filters against an in-memory view row. Reject unsupported operators instead
 * of silently widening the result.
 */
function matches(row: Document, filter: Document): boolean {
  for (const [key, cond] of Object.entries(filter)) {
    if (key === '$and') {
      if (!(cond as Document[]).every((c) => matches(row, c))) {
        return false;
      }
      continue;
    }
    if (key === '$or') {
      if (!(cond as Document[]).some((c) => matches(row, c))) {
        return false;
      }
      continue;
    }
    // The parser represents group and field negation as $nor; evaluate its children before
    // ordinary field filters.
    if (key === '$nor') {
      if ((cond as Document[]).some((c) => matches(row, c))) {
        return false;
      }
      continue;
    }

    const value = row[key === '_id' ? 'id' : key] ?? row[key];
    if (cond !== null && typeof cond === 'object' && !Array.isArray(cond)) {
      // Read regex options with the pattern so ilike remains case-insensitive for views as well as
      // collections.
      const regexFlags =
        typeof (cond as Document).$options === 'string'
          ? ((cond as Document).$options as string)
          : '';
      for (const [op, operand] of Object.entries(cond as Document)) {
        switch (op) {
          case '$eq':
            if (value !== operand) {
              return false;
            }
            break;
          case '$ne':
            if (value === operand) {
              return false;
            }
            break;
          case '$in':
            if (!(operand as unknown[]).includes(value)) {
              return false;
            }
            break;
          case '$nin':
            if ((operand as unknown[]).includes(value)) {
              return false;
            }
            break;
          case '$gt':
            if (!(value > (operand as never))) {
              return false;
            }
            break;
          case '$gte':
            if (!(value >= (operand as never))) {
              return false;
            }
            break;
          case '$lt':
            if (!(value < (operand as never))) {
              return false;
            }
            break;
          case '$lte':
            if (!(value <= (operand as never))) {
              return false;
            }
            break;
          case '$regex':
            if (!new RegExp(operand as string, regexFlags).test(String(value))) {
              return false;
            }
            break;
          case '$not':
            if (matches(row, { [key]: operand as Document })) {
              return false;
            }
            break;
          case '$options':
            break; // read above, alongside $regex
          default:
            throw new Error(`query-client: operator '${op}' is not supported on a view`);
        }
      }
      continue;
    }
    if (value !== cond) {
      return false;
    }
  }
  return true;
}

/**
 * Splits boolean filter expressions on top-level commas while preserving nested groups.
 */
function splitTop(expression: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of expression) {
    if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
    }
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) {
    parts.push(current);
  }
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** One node of such an expression: a nested group, or a `field.op.value` triple. */
function parseFilterNode(part: string): Document {
  const group = /^(and|or|not\.and|not\.or)\((.*)\)$/s.exec(part);
  if (group) {
    const [, kind, inner] = group;
    const clauses = splitTop(inner).map(parseFilterNode);
    if (kind === 'and') {
      return { $and: clauses };
    }
    if (kind === 'or') {
      return { $or: clauses };
    }
    // Logical negation groups (e.g., not.and / not.or).
    return { $nor: [kind === 'not.and' ? { $and: clauses } : { $or: clauses }] };
  }

  const [field, op, ...rest] = part.split('.');
  if (!field || !op) {
    // Reject malformed filters so they cannot match every document during a write.
    throw new Error(`query-client: cannot parse filter expression '${part}'`);
  }

  // Negation prefix parsing: `field.not.<op>.<value>`.
  if (op === 'not') {
    const [innerOp, ...innerRest] = rest;
    if (!innerOp) {
      throw new Error(`query-client: cannot parse filter expression '${part}'`);
    }
    return { $nor: [operatorClause(field, innerOp, innerRest.join('.'))] };
  }

  return operatorClause(field, op, rest.join('.'));
}

function operatorClause(field: string, op: string, value: unknown): Document {
  const f = col(field);
  switch (op) {
    case 'eq':
      return { [f]: value };
    case 'neq':
      return { [f]: { $ne: value } };
    case 'gt':
      return { [f]: { $gt: value } };
    case 'gte':
      return { [f]: { $gte: value } };
    case 'lt':
      return { [f]: { $lt: value } };
    case 'lte':
      return { [f]: { $lte: value } };
    case 'is':
      return { [f]: value === 'null' ? null : value };
    case 'in': {
      const list =
        typeof value === 'string' ? value.replace(/^\(|\)$/g, '').split(',') : (value as unknown[]);
      return { [f]: { $in: list } };
    }
    case 'like':
      return { [f]: { $regex: likeToRegex(String(value)) } };
    case 'ilike':
      return { [f]: { $regex: likeToRegex(String(value)), $options: 'i' } };
    default:
      throw new Error(`query-client: unsupported operator '${op}' on '${field}'`);
  }
}

// client

export interface QueryClient {
  from<T = Document[]>(table: string): QueryBuilder<T>;
  rpc<T = unknown>(name: string, args?: Document): Promise<QueryResult<T>>;
}

/**
 * Construct the query adapter synchronously. Each query resolves its access scope at execution.
 */
export function createQueryClient(asSystem = false): QueryClient {
  return {
    from<T = Document[]>(table: string) {
      return new QueryBuilder<T>(table, asSystem);
    },
    async rpc<T = unknown>(name: string, args: Document = {}): Promise<QueryResult<T>> {
      const fn = rpc.get(name);
      if (!fn) {
        return {
          data: null as T,
          error: {
            message: `query-client: no TypeScript implementation registered for '${name}'`,
          },
        };
      }
      try {
        return { data: (await fn(args)) as T, error: null };
      } catch (e) {
        return { data: null as T, error: toQueryError(e) };
      }
    },
  };
}

/**
 * System-scoped client bypassing collection-level security policies.
 * Reserved for scheduled background jobs, maintenance tasks, and automated jobs.
 */
export function createSystemQueryClient(): QueryClient {
  return createQueryClient(true);
}

/**
 * Server-side function registry invoked through `.rpc()`.
 */
const rpc = new Map<string, (args: Document) => Promise<unknown>>();

export function registerRpc(name: string, fn: (args: Document) => Promise<unknown>): void {
  rpc.set(name, fn);
}

/** Unscoped handle, for the few jobs that legitimately run as the system. */
export async function rawDb() {
  return db();
}
