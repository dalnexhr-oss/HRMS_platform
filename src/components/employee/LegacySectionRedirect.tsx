'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { resolveEmployeeLink } from '@/lib/employee-navigation';
import type { Route } from 'next';

// Automatically forwards notification links and email bookmarks (e.g. /employee#payslips) to the matching tab.
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
