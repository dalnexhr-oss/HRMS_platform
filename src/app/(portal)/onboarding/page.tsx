import './onboarding.css';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/server-auth';
import { OnboardingScreen } from '@/components/onboarding/OnboardingScreen';
import { getOnboardingBoard, getOnboardingTemplates } from '@/lib/queries/onboarding';
import { getEmployeeOptions } from '@/lib/queries/employees';
import type { AppRole } from '@/types/database';

// Match the onboarding actions and collection policies.
const onboardingRoles: AppRole[] = ['super_admin', 'admin', 'hr'];

async function OnboardingPage() {
  const { profile } = await getSession();
  const role = profile?.role ?? null;
  if (!role || !onboardingRoles.includes(role)) {
    redirect('/dashboard');
  }

  const [tasks, templates, employees] = await Promise.all([
    getOnboardingBoard(),
    getOnboardingTemplates(),
    getEmployeeOptions(),
  ]);

  return <OnboardingScreen tasks={tasks} templates={templates} employees={employees} />;
}

export { OnboardingPage as default };
