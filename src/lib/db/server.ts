// ============================================================================
// The data client, in the shape the app already calls.
//
// `createClient()` stays async and `createServiceClient()` stays sync so no
// call site had to change when the database did — only the import path.
//
// What DID change underneath, and it matters:
//   * createClient() no longer carries a connection or a cookie jar. The
//     session is resolved per query inside the scoped repository, so there is
//     nothing to construct and nothing to leak between requests.
//   * createServiceClient() is no longer "a client holding a key that bypasses
//     RLS". It is a client bound to the system scope. Same power, but the
//     bypass is a scope you can grep for rather than a credential in an env var.
// ============================================================================
import 'server-only';
import { pgClient, systemPgClient, type PgClient } from '@/lib/db/pgcompat';
import { isMongoConfigured } from '@/lib/db/mongo';
import { registerDbFunctions } from '@/lib/db/functions';
import { registerPayrollFunctions } from '@/lib/db/payroll';

// The TypeScript replacements for the plpgsql functions the app calls through
// .rpc(). Registered here because every path that can reach an rpc() goes
// through a client from this module first, and registration is idempotent.
registerDbFunctions();
registerPayrollFunctions();

/** Request-scoped client. Every query it runs is filtered by the caller's policy. */
export async function createClient(): Promise<PgClient> {
  if (!isMongoConfigured()) {
    throw new Error('MONGO_URI is not set. Add it to .env.local and restart.');
  }
  return pgClient();
}

/**
 * System client for privileged, non-user jobs (night sweep, payroll compute).
 * SERVER ONLY. Bypasses every collection policy — never import into a client
 * component, and never reach it from a request path.
 */
export function createServiceClient(): PgClient {
  if (!isMongoConfigured()) {
    throw new Error(
      'createServiceClient: MONGO_URI is not set, so privileged operations ' +
        '(night sweep, payroll compute) are unavailable.',
    );
  }
  return systemPgClient();
}

/**
 * True when privileged operations can run.
 *
 * Under Supabase this asked "is the secret key present?", which could be false
 * on a working install. There is no separate credential now: if the database is
 * reachable at all, system jobs can run.
 */
export function isServiceRoleConfigured(): boolean {
  return isMongoConfigured();
}
