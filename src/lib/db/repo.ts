// ============================================================================
// The scoped repository. SERVER ONLY.
//
// This is the machinery that applies policies.ts. It exists so that "forgot to
// filter by employee" stops being a mistake anyone can make: a caller cannot
// obtain a raw collection handle from here, only a wrapper that has already
// ANDed the policy filter into whatever query it is given.
//
// Behaviour on denial mirrors what Postgres did, because the calling code was
// written against it:
//   * READS return nothing. RLS filtered rows out silently; a find over rows
//     you cannot see returned zero, it did not error. Screens already handle
//     an empty list, and erroring instead would turn "you have no claims" into
//     a crash.
//   * WRITES throw. RLS raised on an INSERT or UPDATE that violated a policy,
//     and silence here would report success for a write that never happened.
//
// The escape hatch is systemCollection(), for scheduled jobs that run with no
// signed-in user. It is named to be greppable — every call site is a place
// where the security boundary is deliberately not applied.
// ============================================================================
import 'server-only';
import type {
  AggregateOptions,
  ClientSession,
  CountDocumentsOptions,
  Document,
  Filter,
  FindOptions,
  OptionalUnlessRequiredId,
  UpdateFilter,
  UpdateOptions,
} from 'mongodb';
import { db } from '@/lib/db/mongo';
import { policyFor, type CollectionPolicy } from '@/lib/db/policies';
import { currentScope, SYSTEM_SCOPE, type Scope } from '@/lib/db/scope';

/** Thrown when a write is refused. Carries a message safe to show a user. */
export class ScopeError extends Error {
  readonly userFacing = true;
  constructor(message: string) {
    super(message);
    this.name = 'ScopeError';
  }
}

/** Matches nothing. Used to express "denied" as a filter rather than a branch. */
const MATCH_NOTHING = { _id: { $in: [] as string[] } };

function and<T extends Document>(scope: Document, query: Filter<T>): Filter<T> {
  // $and rather than a spread: a spread silently drops the policy's constraint
  // whenever the caller happens to filter on the same field, which is exactly
  // the case that matters (`{ employee_id: someoneElse }`).
  const clauses = [scope, query].filter((c) => c && Object.keys(c).length > 0);
  if (clauses.length === 0) return {} as Filter<T>;
  if (clauses.length === 1) return clauses[0] as Filter<T>;
  return { $and: clauses } as Filter<T>;
}

export class ScopedCollection<T extends Document> {
  constructor(
    private readonly name: string,
    private readonly policy: CollectionPolicy,
    private readonly scope: Scope,
    /**
     * The transaction this handle takes part in, if any.
     *
     * withTransaction() hands `fn` a session, but until this existed there was
     * no way to give it to a repository — so every read and write inside a
     * "transaction" ran on the normal pool, outside it, and a rollback rolled
     * back nothing. Obtain a session-bound handle with `.inSession(session)`.
     */
    private readonly session?: ClientSession,
  ) {}

  private async raw() {
    return (await db()).collection<T>(this.name);
  }

  /** Merge the transaction session into a driver options object. */
  private opts<O extends object>(options?: O): O {
    if (!this.session) return (options ?? {}) as O;
    return { ...(options ?? {}), session: this.session } as O;
  }

  /**
   * The same collection and scope, enlisted in `session`.
   *
   * The policy is carried over unchanged: joining a transaction must never
   * widen what the caller may see or write.
   */
  inSession(session: ClientSession | undefined): ScopedCollection<T> {
    if (!session) return this;
    return new ScopedCollection<T>(this.name, this.policy, this.scope, session);
  }

  /** The policy's read filter, or a match-nothing filter when denied. */
  private readFilter(): Document {
    return this.policy.read(this.scope) ?? MATCH_NOTHING;
  }

  /** The policy's write filter. Throws rather than silently matching nothing. */
  private writeFilter(): Document {
    const filter = this.policy.write(this.scope);
    if (filter === null) {
      throw new ScopeError('You do not have permission to change this.');
    }
    return filter;
  }

  /**
   * Apply the policy's WITH CHECK, if it declares one, to the row this update
   * would produce.
   *
   * Only $set is inspected: it is the operator every write in this codebase
   * uses to change a field a policy cares about. An update that does not set
   * the checked field leaves it as it was, and writeFilter() has already
   * limited which rows that can be.
   */
  private assertCheck(update: UpdateFilter<T>): void {
    if (!this.policy.check) return;
    const fields = ((update as Document).$set ?? {}) as Document;
    const refusal = this.policy.check(this.scope, fields);
    if (refusal) throw new ScopeError(refusal);
  }

  // --- reads ---------------------------------------------------------------

  async find(query: Filter<T> = {}, options?: FindOptions): Promise<T[]> {
    const collection = await this.raw();
    return collection.find(and(this.readFilter(), query), this.opts(options)).toArray() as Promise<T[]>;
  }

  async findOne(query: Filter<T> = {}, options?: FindOptions): Promise<T | null> {
    const collection = await this.raw();
    return collection.findOne(and(this.readFilter(), query), this.opts(options)) as Promise<T | null>;
  }

  async countDocuments(query: Filter<T> = {}, options?: CountDocumentsOptions): Promise<number> {
    const collection = await this.raw();
    return collection.countDocuments(and(this.readFilter(), query), this.opts(options));
  }

  async distinct<K extends keyof T & string>(key: K, query: Filter<T> = {}): Promise<unknown[]> {
    const collection = await this.raw();
    return collection.distinct(key, and(this.readFilter(), query) as Filter<T>, this.opts());
  }

  /**
   * Aggregate with the scope filter prepended as a $match.
   *
   * The caller's pipeline runs AFTER it, so it can only narrow further.
   *
   * This scopes the BASE collection only. A $lookup inside the pipeline reads a
   * different collection, with a policy this cannot reach, so the pipeline must
   * carry that filter itself — readFilterFor() is how, and pgcompat's
   * embedStages() does exactly that for every embedded select.
   */
  async aggregate<R extends Document = Document>(
    pipeline: Document[],
    options?: AggregateOptions,
  ): Promise<R[]> {
    const collection = await this.raw();
    return collection
      .aggregate<R>([{ $match: this.readFilter() }, ...pipeline], this.opts(options))
      .toArray();
  }

  /**
   * The rows the WRITE policy admits — i.e. exactly the rows an update or a
   * delete carrying the same query is going to touch.
   *
   * find() answers a different question, and the difference is the whole
   * reason this exists. The read policy is almost always the wider of the two
   * (an employee may SEE a claim they may no longer EDIT), so reading with it
   * before a write and reporting those rows as "what the write did" turns a
   * refusal into a success. Every `wroteNothing()` guard in the app is built
   * on the row set a write hands back; this is the filter those guards are
   * actually asking about.
   *
   * Throws exactly as a write would when the policy denies writing outright.
   */
  async findForWrite(query: Filter<T> = {}, options?: FindOptions): Promise<T[]> {
    const collection = await this.raw();
    return collection
      .find(and(this.writeFilter(), query), this.opts(options))
      .toArray() as Promise<T[]>;
  }

  // --- writes --------------------------------------------------------------

  async insertOne(doc: OptionalUnlessRequiredId<T>): Promise<string> {
    const refusal = this.policy.insert(this.scope, doc as Document);
    if (refusal) throw new ScopeError(refusal);
    const collection = await this.raw();
    const result = await collection.insertOne(doc, this.opts());
    return String(result.insertedId);
  }

  async insertMany(docs: OptionalUnlessRequiredId<T>[]): Promise<number> {
    for (const doc of docs) {
      const refusal = this.policy.insert(this.scope, doc as Document);
      if (refusal) throw new ScopeError(refusal);
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

  /**
   * Update if present, insert if not.
   *
   * Both gates apply: the write filter decides which existing row may be
   * touched, and the insert rule decides whether the row that would be created
   * is allowed. Checking only one is how an employee ends up able to conjure a
   * row for somebody else by picking an id that does not exist yet.
   *
   * The write filter is FOLDED into the query rather than ANDed — see
   * upsertFilter() for why and() is the wrong tool for this one operation.
   */
  async upsertOne(
    query: Filter<T>,
    update: UpdateFilter<T>,
    insertShape: Document,
  ): Promise<void> {
    const refusal = this.policy.insert(this.scope, insertShape);
    if (refusal) throw new ScopeError(refusal);
    const filter = upsertFilter(this.writeFilter(), query as Document, insertShape);
    this.assertCheck(update);
    const collection = await this.raw();
    await collection.updateOne(filter as Filter<T>, update, this.opts({ upsert: true }));
  }
}

/**
 * The filter for an upsert: the write policy folded INTO the conflict key.
 *
 * and() cannot be used here. It carries the policy as a second $and clause,
 * and an upsert seeds the document it would INSERT from the query's equality
 * fields — when the same path appears in two clauses MongoDB refuses the whole
 * write (error 54, "cannot infer query fields to set, path '…' is matched
 * twice"). Every employee-scoped upsert had exactly that shape: the policy
 * contributes `{employee_id: me}` and the conflict key names employee_id
 * again. So a punch wrote its punch_events row and then failed to rewrite the
 * day — the employee's own clock moved while the admin board, which reads
 * attendance_days, did not. Staff never saw it because their filter is `{}`.
 *
 * Folding keeps the property and() protects. A policy field the key does not
 * name is added to the flat filter — and seeded onto an inserted row, which is
 * what the policy demands of a new row anyway. A policy field the key DOES
 * name is checked against the key's value here, in code; the key's single
 * occurrence then stands. Disagreement means the caller is reaching for a row
 * outside their scope, and that throws exactly as writeFilter() does when
 * denied, rather than letting a match-nothing filter fall through to an insert.
 *
 * Only the operators the policies actually emit are understood. Anything else
 * throws: a filter that silently matched everything is the failure this file
 * exists to prevent.
 */
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

/** Whether one policy constraint — an equality or an operator object — admits `value`. */
function admits(constraint: unknown, value: unknown): boolean {
  if (!isOperatorObject(constraint)) return same(constraint, value);
  for (const [op, operand] of Object.entries(constraint as Document)) {
    switch (op) {
      case '$eq': if (!same(operand, value)) return false; break;
      case '$ne': if (same(operand, value)) return false; break;
      case '$in': if (!(operand as unknown[]).some((o) => same(o, value))) return false; break;
      case '$nin': if ((operand as unknown[]).some((o) => same(o, value))) return false; break;
      default:
        throw new Error(`repo: cannot fold policy operator '${op}' into an upsert key`);
    }
  }
  return true;
}

function isOperatorObject(v: unknown): boolean {
  if (v === null || typeof v !== 'object' || v instanceof Date || Array.isArray(v)) return false;
  const keys = Object.keys(v as Document);
  return keys.length > 0 && keys.every((k) => k.startsWith('$'));
}

/** Equality the way a policy means it: by value, including Dates and arrays. */
function same(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  }
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return a === b;
}

/** Thrown when a scoped repository is requested with nobody signed in. */
export class NotSignedInError extends Error {
  readonly userFacing = true;
  constructor() {
    super('You are not signed in.');
    this.name = 'NotSignedInError';
  }
}

/**
 * The read filter a collection's policy admits for `scope`, as a plain filter.
 * Denial comes back as a match-nothing filter rather than null, so a caller can
 * drop it into a pipeline without branching.
 *
 * This exists for $lookup. aggregate() prepends the BASE collection's filter,
 * but a joined collection is a DIFFERENT collection with its own policy, and
 * nothing was applying it — every `select('…, employees(gross_monthly, …)')`
 * read employee documents with no employees policy in front of them. Fails
 * closed for an unlisted collection, exactly as build() does.
 */
export function readFilterFor(
  collection: string,
  scope: Scope,
  viaParent?: string,
): Document {
  const policy = policyFor(collection);
  if (!policy) return MATCH_NOTHING;
  // Reached through a parent this collection names as a gateway: the parent's
  // own filter has already decided reachability, exactly as the SQL `exists
  // (select 1 from <parent> …)` policy did. See CollectionPolicy.readableVia.
  if (viaParent && policy.readableVia?.includes(viaParent)) return {};
  return policy.read(scope) ?? MATCH_NOTHING;
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

/**
 * A collection scoped to the signed-in caller.
 *
 * Throws NotSignedInError when there is no session, so a page that forgets its
 * auth check fails loudly instead of querying as nobody.
 */
export async function scoped<T extends Document>(
  name: string,
  session?: ClientSession,
): Promise<ScopedCollection<T>> {
  const scope = await currentScope();
  if (!scope) throw new NotSignedInError();
  return build<T>(name, scope, session);
}

/** A collection scoped to a caller you already resolved. */
export function scopedFor<T extends Document>(
  name: string,
  scope: Scope,
  session?: ClientSession,
): ScopedCollection<T> {
  return build<T>(name, scope, session);
}

/**
 * UNSCOPED access for scheduled jobs, migrations and maintenance — the
 * equivalent of the old service-role key.
 *
 * Every call site is a place where the security boundary is deliberately not
 * applied, so this name is meant to be greppable in review. It must never
 * produce rows that are then handed back to the caller of a request: use it for
 * work that is the same regardless of who triggered it (the nightly jobs, the
 * expired-notice purge), never to answer "what may this user see".
 *
 * When the answer to that question is expressible but not by a per-collection
 * policy, use afterParentCheck() instead — it says so at the call site.
 */
export function systemCollection<T extends Document>(name: string): ScopedCollection<T> {
  return build<T>(name, SYSTEM_SCOPE);
}

/**
 * UNSCOPED access to a child collection whose access rule the CALLER has
 * already applied by resolving the parent.
 *
 * policies.ts decides on one document at a time and cannot join, so a rule of
 * the shape "you may read a comment when you may read its ticket" is not
 * expressible there — the port's first attempt at approximating one on the
 * child's own columns produced a different, wrong rule (an employee stopped
 * seeing the staff replies on their own ticket). The caller instead reads the
 * parents through a scoped handle and then reads children for exactly the
 * parent ids that came back, which is the original rule precisely.
 *
 * Unlike systemCollection(), this IS reachable from a request. That is the
 * point of the separate name: it marks the places where the check exists but
 * lives in the caller, so a reviewer knows to go and look at it.
 */
export function afterParentCheck<T extends Document>(name: string): ScopedCollection<T> {
  return build<T>(name, SYSTEM_SCOPE);
}
