import Link from 'next/link';
import { redirect } from 'next/navigation';
import { OnboardingScreen } from '@/components/onboarding/OnboardingScreen';
import { getOnboardingBoard, getOnboardingTemplates, getEmployeeOptions } from '@/lib/queries';
import { getSession } from '@/lib/auth';
import type { AppRole } from '@/types/database';

// Match the onboarding actions and collection policies.
const onboardingRoles: AppRole[] = ['super_admin', 'admin', 'hr'];

export default async function OnboardingPage() {
  const { profile } = await getSession();
  const role = profile?.role ?? null;
  if (!role || !onboardingRoles.includes(role)) {
    redirect('/today');
  }

  const [tasks, templates, employees] = await Promise.all([
    getOnboardingBoard(),
    getOnboardingTemplates(),
    getEmployeeOptions(),
  ]);

  return (
    <>
      <OnboardingScreen tasks={tasks} templates={templates} employees={employees} />
      {/* Document verification lives at /documents; this page manages onboarding checklists. */}
      <div className="wrap">
        <div className="card">
          <div
            className="bd"
            style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}
          >
            <div>
              <b>Documents</b>
              <div className="muted" style={{ fontSize: 12 }}>
                Uploads, verification and the full register live on the Documents page.
              </div>
            </div>
            <span style={{ flex: 1 }} />
            <Link className="btn" href="/documents">
              Open Documents
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
