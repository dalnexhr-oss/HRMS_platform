import Link from 'next/link';
import { redirect } from 'next/navigation';
import { OnboardingScreen } from '@/components/onboarding/OnboardingScreen';
import { getOnboardingBoard, getOnboardingTemplates, getEmployeeOptions } from '@/lib/queries';
import { getSession } from '@/lib/auth';
import type { AppRole } from '@/types/database';

// Onboarding is super-admin/admin/HR only, matching the onboarding policies and
// the actions' own requireRoles gate.
const ONBOARDING_ROLES: AppRole[] = ['super_admin', 'admin', 'hr'];

export default async function OnboardingPage() {
  const { profile } = await getSession();
  const role = profile?.role ?? null;
  if (!role || !ONBOARDING_ROLES.includes(role)) redirect('/today');

  const [tasks, templates, employees] = await Promise.all([
    getOnboardingBoard(),
    getOnboardingTemplates(),
    getEmployeeOptions(),
  ]);

  return (
    <>
      <OnboardingScreen tasks={tasks} templates={templates} employees={employees} />
      {/* The verification queue used to render here as well. It moved to
          /documents, which is now the single place employee paperwork is
          worked on — a joiner's documents are the same documents as everyone
          else's, and two queues meant two places to remember to look. This page
          is the joiner CHECKLIST; the link is the seam between them. */}
      <div className="wrap">
        <div className="card">
          <div className="bd" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
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
