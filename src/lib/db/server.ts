// Create policy-scoped clients for requests and system clients for internal jobs.
import 'server-only';
import { createQueryClient, createSystemQueryClient } from '@/lib/db/query-client';
import { isMongoConfigured } from '@/lib/db/mongo';
import { registerDbFunctions } from '@/lib/db/functions';
import { registerPayrollFunctions } from '@/lib/db/payroll';
import type { QueryClient } from '@/lib/db/query-client';

// Register RPC handlers once at client initialization boundary.
registerDbFunctions();
registerPayrollFunctions();

// Request-scoped client. Every query it runs is filtered by the caller's policy.
export async function createClient(): Promise<QueryClient> {
  if (!isMongoConfigured()) {
    throw new Error('MONGO_URI is not set. Add it to .env.local and restart.');
  }
  return createQueryClient();
}

// Server-only client for privileged background jobs.
export function createServiceClient(): QueryClient {
  if (!isMongoConfigured()) {
    throw new Error(
      'createServiceClient: MONGO_URI is not set, so privileged operations ' +
        '(night sweep, payroll compute) are unavailable.',
    );
  }
  return createSystemQueryClient();
}

// Returns true when the underlying database connection is configured and available for service operations.
export function isServiceRoleConfigured(): boolean {
  return isMongoConfigured();
}
