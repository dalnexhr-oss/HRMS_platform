import { redirect } from 'next/navigation';
import { getSession } from '@/lib/server-auth';
import { ProfessionalTaxScreen } from '@/components/payroll/ProfessionalTaxScreen';
import { getPtSlabs } from '@/lib/queries/professional-tax';
import { getBranches } from '@/lib/queries/branches';
import type { AppRole } from '@/types/database';

// Match the slab actions' role gate.
const slabRoles: AppRole[] = ['super_admin', 'admin', 'hr'];

async function ProfessionalTaxPage() {
  const { profile } = await getSession();
  if (!profile || !slabRoles.includes(profile.role)) {
    redirect('/dashboard');
  }

  const [slabs, branches] = await Promise.all([getPtSlabs(), getBranches()]);
  // States that have a branch, so the screen can point out which of them still charge nothing.
  const branchStates = [...new Set(branches.map((b) => b.state).filter(Boolean))] as string[];

  return <ProfessionalTaxScreen slabs={slabs} branchStates={branchStates} />;
}

export { ProfessionalTaxPage as default };
