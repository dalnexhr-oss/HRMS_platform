import { redirect } from 'next/navigation';
import { getSession, homeForRole } from '@/lib/auth';

// '/' is where middleware sends an already-signed-in user who lands on /login,
// so it has to resolve the right home per role — hard-redirecting everyone to
// /today would bounce an employee twice before they reached /me.
export default async function Home() {
  const { profile } = await getSession();
  // No profile row is fail-closed: don't guess a home. Sending them to /today
  // would only bounce off the portal layout's own gate.
  if (!profile) {
    redirect('/login?error=Your+account+is+not+provisioned+yet.+Ask+HR+to+set+up+your+access.');
  }
  redirect(homeForRole(profile.role));
}
