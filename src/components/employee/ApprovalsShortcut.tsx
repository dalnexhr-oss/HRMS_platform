'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function ApprovalsShortcut() {
  const pathname = usePathname();
  const active = pathname === '/me/approvals';
  return (
    <Link
      href="/me/approvals"
      className={`btn ${active ? 'primary' : 'quiet'}`}
      aria-label="My approvals"
      title="My approvals"
      aria-current={active ? 'page' : undefined}
      style={{ flex: 'none' }}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="8" y="2" width="8" height="4" rx="1" />
        <path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2" />
        <path d="m8 13 3 3 5-6" />
      </svg>
    </Link>
  );
}
