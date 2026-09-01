import { redirect } from 'next/navigation';
import { OnboardingScreen } from '@/components/onboarding/OnboardingScreen';
import { DocumentQueue } from '@/components/onboarding/DocumentQueue';
import {
  getOnboardingBoard,
  getOnboardingTemplates,
  getEmployeeOptions,
  getUnverifiedDocuments,
} from '@/lib/queries';
import { getSession } from '@/lib/auth';
import type { AppRole } from '@/types/database';

// Onboarding is super-admin/admin/HR only, matching the onboarding policies and
// the actions' own requireRoles gate.
const ONBOARDING_ROLES: AppRole[] = ['super_admin', 'admin', 'hr'];

export default async function OnboardingPage() {
  const { profile } = await getSession();
  const role = profile?.role ?? null;
  if (!role || !ONBOARDING_ROLES.includes(role)) redirect('/today');

  const [tasks, templates, employees, unverified] = await Promise.all([
    getOnboardingBoard(),
    getOnboardingTemplates(),
    getEmployeeOptions(),
    getUnverifiedDocuments(),
  ]);

  return (
    <>
      <OnboardingScreen tasks={tasks} templates={templates} employees={employees} />
      <div className="wrap">
        <DocumentQueue documents={unverified} />
      </div>
    </>
  );
}
