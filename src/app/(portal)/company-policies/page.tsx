import './company-policies.css';
import { PoliciesScreen } from '@/components/company-policies/PoliciesScreen';
import { getAllPolicies, getPolicyAckCounts } from '@/lib/queries/policies';
import { getActiveEmployeeCount } from '@/lib/queries/employees';

async function PoliciesPage() {
  const [policies, ackCounts, headcount] = await Promise.all([
    getAllPolicies(),
    getPolicyAckCounts(),
    getActiveEmployeeCount(),
  ]);

  return <PoliciesScreen policies={policies} ackCounts={ackCounts} headcount={headcount} />;
}

export { PoliciesPage as default };
