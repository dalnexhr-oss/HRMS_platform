import { PolicyAdmin } from '@/components/policies/PolicyAdmin';
import { getAllPolicies } from '@/lib/queries';

export default async function PoliciesPage() {
  const policies = await getAllPolicies();

  return (
    <div className="wrap grid">
      <PolicyAdmin policies={policies} />
      <p className="muted" style={{ fontSize: 12 }}>
        Published policies appear on every employee&rsquo;s dashboard, where they can read and
        acknowledge them. Acknowledgements are recorded per employee.
      </p>
    </div>
  );
}
