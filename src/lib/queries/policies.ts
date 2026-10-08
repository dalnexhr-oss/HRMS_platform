import 'server-only';
import { createClient } from '@/lib/db/server-client';
import { fail } from '@/lib/queries/shared';
import { scoped } from '@/lib/db/scoped-repository';
import { collections } from '@/lib/db/collection-registry';
import type { Policy } from '@/types/database';

// policies
interface PolicyView {
  id: string;
  title: string;
  category: string | null;
  version: number;
  effective_date: string | null;
  body: string;
  published: boolean;
  acknowledged: boolean;
}

/** Published policies for an employee, flagged with whether they've acknowledged. */
async function getEmployeePolicies(employeeId: string | null): Promise<PolicyView[]> {
  const queryClient = await createClient();
  const { data, error } = await queryClient
    .from('policies')
    .select('id, title, category, version, effective_date, body, published')
    .eq('published', true)
    .order('category');
  if (error) {
    fail('getEmployeePolicies: could not load policies', error);
  }

  let acked = new Set<string>();
  if (employeeId) {
    const { data: acks, error: acksError } = await queryClient
      .from('policy_acknowledgements')
      .select('policy_id')
      .eq('employee_id', employeeId);
    if (acksError) {
      fail('getEmployeePolicies: could not load acknowledgements', acksError);
    }
    acked = new Set((acks ?? []).map((a: any) => a.policy_id));
  }
  return (data ?? []).map((p: any) => ({ ...p, acknowledged: acked.has(p.id) }));
}

/**
 * Count policy receipts by policy ID. Collection policies let staff see all receipts and employees
 * see only their own.
 */
async function getPolicyAckCounts(): Promise<Record<string, number>> {
  const acks = await scoped(collections.policyAcknowledgements);
  // Counted in the database rather than by pulling every receipt across and
  // tallying them in JavaScript, which is what the row-by-row version did.
  const rows = await acks.aggregate<{ _id: string; n: number }>([
    { $group: { _id: '$policy_id', n: { $sum: 1 } } },
  ]);
  return Object.fromEntries(rows.map((r) => [r._id, r.n]));
}

/** All policies for the admin management screen. */
async function getAllPolicies(): Promise<Policy[]> {
  const policies = await scoped(collections.policies);
  const rows = await policies.find({}, { sort: { updated_at: -1 } });
  return rows.map((r) => ({ ...r, id: r._id })) as unknown as Policy[];
}

export { getEmployeePolicies, getPolicyAckCounts, getAllPolicies };

export type { PolicyView };
