'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { resolveEmployeeLink } from '@/lib/employee-navigation';
import type { Route } from 'next';

// Sections that were anchors on the dashboard are now tabs. Links saved before that change, such as
// /employee#payslips in a stored notification or an email, open the dashboard; forward them.
function LegacySectionRedirect() {
  const router = useRouter();

  useEffect(() => {
    const forward = () => {
      const hash = window.location.hash.slice(1);
      const target = resolveEmployeeLink(window.location.pathname, hash || null);
      if (target.path !== window.location.pathname) {
        router.replace(`${target.path}#${hash}` as Route);
      }
    };
    forward();
    window.addEventListener('hashchange', forward);
    return () => window.removeEventListener('hashchange', forward);
  }, [router]);

  return null;
}

export { LegacySectionRedirect };
