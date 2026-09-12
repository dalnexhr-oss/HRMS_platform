// Data access client factory. SERVER ONLY.
//
// Provides scoped client instances for authenticated user requests (subject to collection policies)
// and system-scoped instances for privileged asynchronous batch jobs (night sweep, payroll compute).
import 'server-only';
import { pgClient, systemPgClient, type PgClient } from '@/lib/db/pgcompat';
import { isMongoConfigured } from '@/lib/db/mongo';
import { registerDbFunctions } from '@/lib/db/functions';
import { registerPayrollFunctions } from '@/lib/db/payroll';

// Register RPC handlers once at client initialization boundary.
registerDbFunctions();
registerPayrollFunctions();

// Request-scoped client. Every query it runs is filtered by the caller's policy.
export async function createClient(): Promise<PgClient> {
  if (!isMongoConfigured()) {
    throw new Error('MONGO_URI is not set. Add it to .env.local and restart.');
  }
  return pgClient();
}

// System-scoped client for privileged background processing (cron jobs, payroll execution). SERVER ONLY.
export function createServiceClient(): PgClient {
  if (!isMongoConfigured()) {
    throw new Error(
      'createServiceClient: MONGO_URI is not set, so privileged operations ' +
        '(night sweep, payroll compute) are unavailable.',
    );
  }
  return systemPgClient();
}

// Returns true when the underlying database connection is configured and available for service operations.
export function isServiceRoleConfigured(): boolean {
  return isMongoConfigured();
}
