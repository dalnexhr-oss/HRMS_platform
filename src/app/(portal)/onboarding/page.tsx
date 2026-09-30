import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/server-auth';
import { OnboardingScreen } from '@/components/onboarding/OnboardingScreen';
import { getOnboardingBoard, getOnboardingTemplates, getEmployeeOptions } from '@/lib/server-queries';
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

  return (
    <>
      <OnboardingScreen tasks={tasks} templates={templates} employees={employees} />
      {/* Document verification lives at /documents; this page manages onboarding checklists. */}
      <div className="content-container">
        <div className="card">
          <div
            className="card-body"
            style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}
          >
            <div>
              <b>Documents</b>
              <div className="text-muted" style={{ fontSize: 12 }}>
                Uploads, verification and the full register live on the Documents page.
              </div>
            </div>
            <span style={{ flex: 1 }} />
            <Link className="button" href="/documents">
              Open Documents
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}

export { OnboardingPage as default };
