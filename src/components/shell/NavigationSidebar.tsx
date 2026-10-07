'use client';

import Link from 'next/link';
import { icons } from '@/components/Icons';
import { Brand } from '@/components/ui/Brand';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { Route } from 'next';
import type { ReactNode } from 'react';

interface SidebarLink {
  key: string;
  href: string;
  label: string;
  // Key into components/Icons.tsx.
  icon: string;
}

interface SidebarSection {
  label: string;
  links: SidebarLink[];
}

// Turn a role slug into a human label for the sidebar footer.
const roleLabel: Record<string, string> = {
  admin: 'Administrator',
  super_admin: 'Super Admin',
  hr: 'HR',
  employee: 'Employee',
  intern: 'Intern',
};

// The sidebar frame shared by the staff portal and the employee area: brand, grouped links, and an
// off-canvas drawer on phones. Callers decide which links are visible.
function NavigationSidebar({
  homeHref,
  sections,
  activeKey,
  name,
  role,
  footerAction,
  caption,
  light = false,
}: {
  // Optional line under the logo, naming the area.
  caption?: string;
  // White surface with dark text instead of the brand gradient.
  light?: boolean;
  homeHref: Route;
  sections: SidebarSection[];
  activeKey: string;
  name?: string | null;
  role?: string | null;
  // Optional control under the signed-in name, such as Sign out.
  footerAction?: ReactNode;
}) {
  const pathname = usePathname();
  // Off-canvas on phones. On desktop the sidebar is always in flow and this
  // flag does nothing — the CSS only honours .is-open below the rail breakpoint.
  const [open, setOpen] = useState(false);

  // Navigating is the end of the menu's job. Without this the drawer stays over
  // the page the user just asked for.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Escape closes it, matching every other overlay in the app.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      {/* Sits over the topbar's reserved left gutter on mobile, so it reads as part of the bar rather than as a floating button. */}
      <button
        type="button"
        className="navigation-toggle"
        aria-label={open ? 'Close menu' : 'Open menu'}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          {open ? (
            <>
              <path d="M6 6l12 12" />
              <path d="M18 6L6 18" />
            </>
          ) : (
            <>
              <path d="M3.5 7h17" />
              <path d="M3.5 12h17" />
              <path d="M3.5 17h17" />
            </>
          )}
        </svg>
      </button>
      <div
        className={`navigation-backdrop${open ? ' is-active' : ''}`}
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />
      <aside className={`sidebar${light ? ' is-light' : ''}${open ? ' is-open' : ''}`}>
        <div className="sidebar-brand">
          <Brand href={homeHref} priority onClick={() => setOpen(false)} />
          {caption ? <div className="brand-caption">{caption}</div> : null}
        </div>
        <nav className="sidebar-navigation" aria-label="Primary">
          {/* A section whose links are all gated away renders nothing at all rather
            than a bare heading. */}
          {sections.map((section) => {
            if (section.links.length === 0) {
              return null;
            }

            return (
              <div key={section.label}>
                <div className="navigation-group">{section.label}</div>
                {/*
                 * Disable prefetch for dynamic, authenticated routes to avoid loading every
                 * sidebar destination at once. staleTimes caches revisits.
                 */}
                {section.links.map((link) => (
                  <Link
                    key={link.key}
                    href={link.href as Route}
                    prefetch={false}
                    aria-current={activeKey === link.key}
                  >
                    {icons[link.icon]}
                    <span className="txt">{link.label}</span>
                  </Link>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <b>{name || 'Signed in'}</b>
          <br />
          {role ? (roleLabel[role] ?? role) : 'Dalnex HRMS'}
          {footerAction ? <div className="sidebar-footer-action">{footerAction}</div> : null}
        </div>
      </aside>
    </>
  );
}

export { NavigationSidebar };

export type { SidebarLink, SidebarSection };
