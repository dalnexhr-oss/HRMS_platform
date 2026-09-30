// One consistent set of inline icons for every portal navigation tab.
import type { ReactNode } from 'react';

const svg = (children: ReactNode) => (
  <svg
    className="icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    {children}
  </svg>
);

const icons: Record<string, ReactNode> = {
  dashboard: svg(
    <>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
    </>,
  ),
  'monthly-register': svg(
    <>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M3 9h18M8 4V2M16 4V2M8 13h1M15 13h1M8 17h1M15 17h1" />
    </>,
  ),
  approvals: svg(
    <>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <rect x="9" y="2" width="6" height="4" rx="1" />
      <path d="m8 13 3 3 5-6" />
    </>,
  ),
  payroll: svg(
    <>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18M7 15h4" />
    </>,
  ),
  employees: svg(
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19c.8-3 3-4.5 5.5-4.5s4.7 1.5 5.5 4.5" />
      <path d="M16 5.5a3 3 0 010 5.5M17.5 14.7c1.6.6 2.7 1.9 3.2 4" />
    </>,
  ),
  'company-policies': svg(
    <>
      <path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6zM8 10h8M8 14h6" />
    </>,
  ),
  holidays: svg(
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4M12 14h4" />
    </>,
  ),
  notices: svg(
    <>
      <path d="M4 9v6h4l6 4V5L8 9H4z" />
      <path d="M18 9a4 4 0 010 6" />
    </>,
  ),
  helpdesk: svg(
    <>
      <path d="M4 14v-3a8 8 0 0 1 16 0v7a3 3 0 0 1-3 3h-4" />
      <rect x="2" y="11" width="4" height="7" rx="2" />
      <rect x="18" y="11" width="4" height="7" rx="2" />
    </>,
  ),
  'attendance-audit': svg(
    <>
      <path d="M10 21H5V3h9l4 4v3M14 3v4h4M8 11h3M8 15h1" />
      <circle cx="16" cy="16" r="4" />
      <path d="m19 19 3 3" />
    </>,
  ),
  'tv-dashboard': svg(
    <>
      <rect x="2" y="4" width="20" height="13" rx="2" />
      <path d="M8 21h8M12 17v4M6 13v-2M10 13V8M14 13v-3M18 13V7" />
    </>,
  ),
  onboarding: svg(
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20v-2a6 6 0 0 1 12 0v2M19 5v6M16 8h6" />
    </>,
  ),
  documents: svg(<path d="M8 3h8l4 4v12H8zM16 3v4h4M4 7v15h12M11 11h6M11 15h6" />),
  exits: svg(<path d="M10 3H4v18h6M9 12h12m-4-4 4 4-4 4" />),
  'leave-management': svg(
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4m-8 9 3 3 5-5" />
    </>,
  ),
  'leave-salary': svg(
    <>
      <path d="M4 4h13v6M4 9h13M7 2v4M14 2v4M4 4v16h5" />
      <circle cx="16" cy="16" r="6" />
      <path d="M14 13h4m-4 2h4m-4-2c3 0 3 4 0 4l3 3" />
    </>,
  ),
  reimbursements: svg(<path d="m5 2 3 2 4-2 4 2 3-2v20l-3-2-4 2-4-2-3 2zM9 8h6M9 12h6M9 16h3" />),
  'asset-management': svg(
    <>
      <rect x="2" y="4" width="14" height="12" rx="2" />
      <path d="M6 20h6M9 16v4" />
      <rect x="18" y="9" width="4" height="11" rx="1" />
      <path d="M20 16v1" />
    </>,
  ),
  'inventory-management': svg(
    <path d="m3 7 9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10M7.5 5l9 4" />,
  ),
  users: svg(
    <>
      <circle cx="8" cy="7" r="3" />
      <path d="M2 20v-2a6 6 0 0 1 10-4M17 15v6m0-2h3" />
      <circle cx="17" cy="12" r="3" />
    </>,
  ),
  'data-import': svg(<path d="M12 3v12m-4-4 4 4 4-4M4 15v5h16v-5" />),
  settings: svg(
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19 12a7 7 0 00-.2-1.6l2-1.5-2-3.4-2.3 1a7 7 0 00-2.7-1.6L13.4 2h-2.8l-.4 2.9a7 7 0 00-2.7 1.6l-2.3-1-2 3.4 2 1.5A7 7 0 005 12c0 .5.1 1.1.2 1.6l-2 1.5 2 3.4 2.3-1a7 7 0 002.7 1.6l.4 2.9h2.8l.4-2.9a7 7 0 002.7-1.6l2.3 1 2-3.4-2-1.5c.1-.5.2-1 .2-1.6z" />
    </>,
  ),
  recent: svg(
    <>
      <path d="M3 3h18v18H3V3z" />
      <path d="M3 9h18M9 3v6" />
    </>,
  ),
};

export { icons };
