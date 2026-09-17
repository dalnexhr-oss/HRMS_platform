/**
 * Apply collection policies to every repository operation. Reads hide unauthorized rows; invalid
 * writes throw ScopeError. Internal jobs can explicitly request system scope.
 */
import 'server-only';
import { db } from '@/lib/db/mongo';
import { policyFor } from '@/lib/db/policies';
import { currentScope, systemScope } from '@/lib/db/scope';
import type { CollectionPolicy } from '@/lib/db/policies';
import type { Scope } from '@/lib/db/scope';
import type { AggregateOptions, ClientSession, CountDocumentsOptions, Document, Filter, FindOptions, OptionalUnlessRequiredId, UpdateFilter, UpdateOptions } from 'mongodb';

// Thrown when a write is refused. Carries a message safe to show a user.
export class ScopeError extends Error {
  readonly userFacing = true;
  constructor(message: string) {
    super(message);
    this.name = 'ScopeError';
  }
}

// Matches nothing. Used to express "denied" as a filter rather than a branch.
const matchNothing = { _id: { $in: [] as string[] } };

function and<T extends Document>(scope: Document, query: Filter<T>): Filter<T> {
  // $and rather than a spread: a spread silently drops the policy's constraint
  // whenever the caller happens to filter on the same field, which is exactly
  // the case that matters (`{ employee_id: someoneElse }`).
  const clauses = [scope, query].filter((c) => c && Object.keys(c).length > 0);
  if (clauses.length === 0) {
    return {} as Filter<T>;
  }
  if (clauses.length === 1) {
    return clauses[0] as Filter<T>;
  }
  return { $and: clauses } as Filter<T>;
}

export class ScopedCollection<T extends Document> {
  constructor(
    private readonly name: string,
    private readonly policy: CollectionPolicy,
    private readonly scope: Scope,
    // Use inSession(session) to bind repository operations to the transaction supplied by
    // withTransaction.
    private readonly session?: ClientSession,
  ) {}

  private async raw() {
    return (await db()).collection<T>(this.name);
  }

  // Merge the transaction session into a driver options object.
  private opts<O extends object>(options?: O): O {
    if (!this.session) {
      return (options ?? {}) as O;
    }
    return { ...(options ?? {}), session: this.session } as O;
  }

  // The same collection and scope, enlisted in `session`. The policy is carried over unchanged:
  // joining a transaction must never widen what the caller may see or write.
  inSession(session: ClientSession | undefined): ScopedCollection<T> {
    if (!session) {
      return this;
    }
    return new ScopedCollection<T>(this.name, this.policy, this.scope, session);
  }

  // The policy's read filter, or a match-nothing filter when denied.
  private readFilter(): Document {
    return this.policy.read(this.scope) ?? matchNothing;
  }

  // The policy's write filter. Throws rather than silently matching nothing.
  private writeFilter(): Document {
    const filter = this.policy.write(this.scope);
    if (filter === null) {
      throw new ScopeError('You do not have permission to change this.');
    }
    return filter;
  }

  // Apply the policy's update check to $set fields. Other operators must not modify checked fields
  // without extending this validation.
  private assertCheck(update: UpdateFilter<T>): void {
    if (!this.policy.check) {
      return;
    }
    const fields = ((update as Document).$set ?? {}) as Document;
    const refusal = this.policy.check(this.scope, fields);
    if (refusal) {
      throw new ScopeError(refusal);
    }
  }

  // reads

  async find(query: Filter<T> = {}, options?: FindOptions): Promise<T[]> {
    const collection = await this.raw();
    return collection.find(and(this.readFilter(), query), this.opts(options)).toArray() as Promise<
      T[]
    >;
  }

  async findOne(query: Filter<T> = {}, options?: FindOptions): Promise<T | null> {
    const collection = await this.raw();
    return collection.findOne(
      and(this.readFilter(), query),
      this.opts(options),
    ) as Promise<T | null>;
  }

  async countDocuments(query: Filter<T> = {}, options?: CountDocumentsOptions): Promise<number> {
    const collection = await this.raw();
    return collection.countDocuments(and(this.readFilter(), query), this.opts(options));
  }

  async distinct<K extends keyof T & string>(key: K, query: Filter<T> = {}): Promise<unknown[]> {
    const collection = await this.raw();
    return collection.distinct(key, and(this.readFilter(), query) as Filter<T>, this.opts());
  }

  // Prepend the base collection's scope filter. Each $lookup must apply the joined collection's
  // policy separately using readFilterFor.
  async aggregate<R extends Document = Document>(
    pipeline: Document[],
    options?: AggregateOptions,
  ): Promise<R[]> {
    const collection = await this.raw();
    return collection
      .aggregate<R>([{ $match: this.readFilter() }, ...pipeline], this.opts(options))
      .toArray();
  }

  // Find rows allowed by the write policy before a mutation. Read access may be broader, so using
  // find() could report success for rows the caller cannot change. Denied writes throw.
  async findForWrite(query: Filter<T> = {}, options?: FindOptions): Promise<T[]> {
    const collection = await this.raw();
    return collection.find(and(this.writeFilter(), query), this.opts(options)).toArray() as Promise<
      T[]
    >;
  }

  // writes

  async insertOne(doc: OptionalUnlessRequiredId<T>): Promise<string> {
    const refusal = this.policy.insert(this.scope, doc as Document);
    if (refusal) {
      throw new ScopeError(refusal);
    }
    const collection = await this.raw();
    const result = await collection.insertOne(doc, this.opts());
    return String(result.insertedId);
  }

  async insertMany(docs: Array<OptionalUnlessRequiredId<T>>): Promise<number> {
    for (const doc of docs) {
      const refusal = this.policy.insert(this.scope, doc as Document);
      if (refusal) {
        throw new ScopeError(refusal);
      }
    }
    const collection = await this.raw();
    const result = await collection.insertMany(docs, this.opts());
    return result.insertedCount;
  }

  async updateOne(
    query: Filter<T>,
    update: UpdateFilter<T>,
    options?: UpdateOptions,
  ): Promise<number> {
    const filter = and(this.writeFilter(), query);
    this.assertCheck(update);
    const collection = await this.raw();
    const result = await collection.updateOne(filter, update, this.opts(options));
    return result.matchedCount;
  }

  async updateMany(query: Filter<T>, update: UpdateFilter<T>): Promise<number> {
    const filter = and(this.writeFilter(), query);
    this.assertCheck(update);
    const collection = await this.raw();
    const result = await collection.updateMany(filter, update, this.opts());
    return result.matchedCount;
  }

  async deleteOne(query: Filter<T>): Promise<number> {
    const collection = await this.raw();
    const result = await collection.deleteOne(and(this.writeFilter(), query), this.opts());
    return result.deletedCount;
  }

  async deleteMany(query: Filter<T>): Promise<number> {
    const collection = await this.raw();
    const result = await collection.deleteMany(and(this.writeFilter(), query), this.opts());
    return result.deletedCount;
  }

  // Upserts require both write and insert permission. Merge the policy into the conflict key with
  // upsertFilter so MongoDB can infer inserted fields correctly.
  async upsertOne(query: Filter<T>, update: UpdateFilter<T>, insertShape: Document): Promise<void> {
    const refusal = this.policy.insert(this.scope, insertShape);
    if (refusal) {
      throw new ScopeError(refusal);
    }
    const filter = upsertFilter(this.writeFilter(), query as Document, insertShape);
    this.assertCheck(update);
    const collection = await this.raw();
    await collection.updateOne(filter as Filter<T>, update, this.opts({ upsert: true }));
  }
}

// Merge the write policy into the upsert conflict key. Repeated equality paths inside $and prevent
// MongoDB from inferring an inserted document. Add missing policy fields and verify overlapping
// values; reject conflicts and unsupported operators to keep the write scoped.
function upsertFilter(policy: Document, query: Document, insertShape: Document): Document {
  const merged: Document = { ...query };
  const side: Document[] = [];

  for (const [field, constraint] of Object.entries(policy)) {
    // $or / $nor are never used to seed an inserted document, so they cannot
    // trip the matched-twice rule; they ride alongside as their own clause.
    if (field.startsWith('$')) {
      side.push({ [field]: constraint });
      continue;
    }

    if (!(field in query)) {
      // The row that would be inserted must also satisfy the policy — refuse
      // now rather than create a row the caller could never write again.
      if (field in insertShape && !admits(constraint, insertShape[field])) {
        throw new ScopeError('You do not have permission to change this.');
      }
      merged[field] = constraint;
      continue;
    }

    if (!admits(constraint, query[field])) {
      throw new ScopeError('You do not have permission to change this.');
    }
  }

  return side.length ? { $and: [merged, ...side] } : merged;
}

// Whether one policy constraint — an equality or an operator object — admits `value`.
function admits(constraint: unknown, value: unknown): boolean {
  if (!isOperatorObject(constraint)) {
    return same(constraint, value);
  }
  for (const [op, operand] of Object.entries(constraint as Document)) {
    switch (op) {
      case '$eq':
        if (!same(operand, value)) {
          return false;
        }
        break;
      case '$ne':
        if (same(operand, value)) {
          return false;
        }
        break;
      case '$in':
        if (!(operand as unknown[]).some((o) => same(o, value))) {
          return false;
        }
        break;
      case '$nin':
        if ((operand as unknown[]).some((o) => same(o, value))) {
          return false;
        }
        break;
      default:
        throw new Error(`repo: cannot fold policy operator '${op}' into an upsert key`);
    }
  }
  return true;
}

function isOperatorObject(v: unknown): boolean {
  if (v === null || typeof v !== 'object' || v instanceof Date || Array.isArray(v)) {
    return false;
  }
  const keys = Object.keys(v as Document);
  return keys.length > 0 && keys.every((k) => k.startsWith('$'));
}

// Equality the way a policy means it: by value, including Dates and arrays.
function same(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  }
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return a === b;
}

// Thrown when a scoped repository is requested with nobody signed in.
export class NotSignedInError extends Error {
  readonly userFacing = true;
  constructor() {
    super('You are not signed in.');
    this.name = 'NotSignedInError';
  }
}

// Return the collection's scoped read filter for use in $lookup pipelines. Joined collections need
// their own policies in addition to the base collection's filter. Denied or unlisted collections
// return a filter matching nothing.
export function readFilterFor(collection: string, scope: Scope, viaParent?: string): Document {
  const policy = policyFor(collection);
  if (!policy) {
    return matchNothing;
  }
  // Inherits reachability via an authorized parent collection.
  // See CollectionPolicy.readableVia.
  if (viaParent && policy.readableVia?.includes(viaParent)) {
    return {};
  }
  return policy.read(scope) ?? matchNothing;
}

function build<T extends Document>(
  name: string,
  scope: Scope,
  session?: ClientSession,
): ScopedCollection<T> {
  const policy = policyFor(name);
  if (!policy) {
    // Fail closed. An unlisted collection is a collection nobody has decided
    // the rules for yet, and guessing them is how data leaks.
    throw new Error(
      `No access policy declared for '${name}'. Add one to src/lib/db/policies.ts ` +
        'before querying it — collections are denied by default.',
    );
  }
  return new ScopedCollection<T>(name, policy, scope, session);
}

// A collection scoped to the signed-in caller. Throws NotSignedInError when there is no session, so
// a page that forgets its auth check fails loudly instead of querying as nobody.
export async function scoped<T extends Document>(
  name: string,
  session?: ClientSession,
): Promise<ScopedCollection<T>> {
  const scope = await currentScope();
  if (!scope) {
    throw new NotSignedInError();
  }
  return build<T>(name, scope, session);
}

// A collection scoped to a caller you already resolved.
export function scopedFor<T extends Document>(
  name: string,
  scope: Scope,
  session?: ClientSession,
): ScopedCollection<T> {
  return build<T>(name, scope, session);
}

// System-scoped access for background jobs, maintenance tasks, and schema routines.
// Bypasses collection-level security policies; results must not be returned directly to
// unauthenticated clients.
export function systemCollection<T extends Document>(name: string): ScopedCollection<T> {
  return build<T>(name, systemScope);
}

// System-scoped access for child entity queries where authorization has already been verified
// against the parent entity (e.g. ticket comments gated by verified ticket ownership).
export function afterParentCheck<T extends Document>(name: string): ScopedCollection<T> {
  return build<T>(name, systemScope);
}
