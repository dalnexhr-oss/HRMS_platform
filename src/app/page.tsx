import { redirect } from 'next/navigation';
import { getSession, homeForRole } from '@/lib/auth';

// Resolve the signed-in user's home by role: staff use /today and employees use /me.
export default async function Home() {
  const { profile } = await getSession();
  // An account without a profile has no authorized home.
  if (!profile) {
    redirect('/login?error=Your+account+is+not+provisioned+yet.+Ask+HR+to+set+up+your+access.');
  }
  redirect(homeForRole(profile.role));
}
