import { Sidebar } from '@/components/shell/Sidebar';
import { Topbar } from '@/components/shell/Topbar';
import { getSession } from '@/lib/auth';

// The portal shell (sidebar + sticky topbar) wraps every screen. Each route
// under (portal) renders inside <main>, replacing the prototype's tab switch.
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await getSession();
  return (
    <div className="shell">
      <Sidebar name={profile?.full_name} role={profile?.role} />
      <main className="main">
        <Topbar name={profile?.full_name ?? 'Meera Kulkarni'} />
        <section className="screen">{children}</section>
      </main>
    </div>
  );
}
