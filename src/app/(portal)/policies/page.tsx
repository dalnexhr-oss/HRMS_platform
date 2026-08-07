import { PolicyAdmin } from '@/components/policies/PolicyAdmin';
import { getAllPolicies, getPolicyAckCounts, getActiveEmployeeCount } from '@/lib/queries';

export default async function PoliciesPage() {
  const [policies, ackCounts, headcount] = await Promise.all([
    getAllPolicies(),
    getPolicyAckCounts(),
    getActiveEmployeeCount(),
  ]);

  return (
    <div className="wrap grid">
      <PolicyAdmin policies={policies} ackCounts={ackCounts} headcount={headcount} />
      <p className="muted" style={{ fontSize: 12 }}>
        Published policies appear on every employee&rsquo;s dashboard, where they can read and
        acknowledge them. The count on each published policy is how many active employees have
        marked it as read.
      </p>
    </div>
  );
}
