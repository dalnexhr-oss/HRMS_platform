import { getSession } from '@/lib/auth';
import { SignOutButton } from '@/components/auth/SignOutButton';

// Employee self-service shell — a slim top bar, no admin sidebar.
export default async function EmployeeLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await getSession();
  const name = profile?.full_name ?? 'Employee';

  return (
    <div className="main">
      <div className="topbar">
        <div>
          <h2 style={{ fontFamily: 'var(--display)' }}>
            Dalnex<span style={{ color: 'var(--brass)' }}>.</span>
          </h2>
          <div className="sub">Employee self-service</div>
        </div>
        <div className="grow" />
        <span className="who" style={{ marginRight: 4 }}>
          <span className="av">{initials(name)}</span>
        </span>
        <SignOutButton />
      </div>
      <section className="screen">{children}</section>
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}
