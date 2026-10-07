// One consistent set of inline icons for every navigation tab. Each tab in a sidebar has its own
// shape, so no two rows look alike.
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
  // Tiles.
  dashboard: svg(
    <>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
    </>,
  ),
  // A register is a grid of days by employee.
  'monthly-register': svg(
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18M3 14.5h18M9 9v11M15 9v11" />
    </>,
  ),
  // History: a clock wound backwards.
  'attendance-audit': svg(
    <>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5" />
      <path d="M3.5 4v4.5H8M12 7.5V12l3 2" />
    </>,
  ),
  approvals: svg(
    <>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <rect x="9" y="2" width="6" height="4" rx="1" />
      <path d="m8 13 3 3 5-6" />
    </>,
  ),
  // A wall screen on its stand, showing a chart.
  'tv-dashboard': svg(
    <>
      <rect x="2" y="4" width="20" height="13" rx="2" />
      <path d="M8 21h8M12 17v4M7 13v-2M12 13V8M17 13v-3" />
    </>,
  ),

  employees: svg(
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19c.8-3 3-4.5 5.5-4.5s4.7 1.5 5.5 4.5" />
      <path d="M16 5.5a3 3 0 010 5.5M17.5 14.7c1.6.6 2.7 1.9 3.2 4" />
    </>,
  ),
  // A person being added.
  onboarding: svg(
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20v-2a6 6 0 0 1 12 0v2M19 5v6M16 8h6" />
    </>,
  ),
  // A page with a folded corner.
  documents: svg(<path d="M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6" />),
  // Out through a door.
  exits: svg(<path d="M10 3H4v18h6M9 12h12m-4-4 4 4-4 4" />),

  // The only calendar: a ticked date.
  'leave-management': svg(
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4m-7 8 2.5 2.5L16 13" />
    </>,
  ),
  // Rupee sign.
  'leave-salary': svg(<path d="M7 4h10M7 8.5h10M7 4h3a4.5 4.5 0 0 1 0 9H7l7 7" />),
  // Percent: a rate table.
  'professional-tax': svg(
    <>
      <path d="M19 5 5 19" />
      <circle cx="7" cy="7" r="2.5" />
      <circle cx="17" cy="17" r="2.5" />
    </>,
  ),
  // Banknote.
  payroll: svg(
    <>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 12h.01M18 12h.01" />
    </>,
  ),
  // Receipt.
  reimbursements: svg(<path d="m5 2 3 2 4-2 4 2 3-2v20l-3-2-4 2-4-2-3 2zM9 8h6M9 12h6M9 16h3" />),

  // Laptop.
  'asset-management': svg(
    <>
      <rect x="4" y="5" width="16" height="11" rx="2" />
      <path d="M2 20h20" />
    </>,
  ),
  // Box.
  'inventory-management': svg(<path d="m3 7 9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10" />),

  // Shield with a tick.
  'company-policies': svg(
    <>
      <path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6z" />
      <path d="m9 12 2 2 4-4" />
    </>,
  ),
  // Sun.
  holidays: svg(
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>,
  ),
  // Megaphone.
  notices: svg(
    <>
      <path d="M4 9v6h4l6 4V5L8 9H4z" />
      <path d="M18 9a4 4 0 010 6" />
    </>,
  ),
  // Headset.
  helpdesk: svg(
    <>
      <path d="M4 14v-3a8 8 0 0 1 16 0v7a3 3 0 0 1-3 3h-4" />
      <rect x="2" y="11" width="4" height="7" rx="2" />
      <rect x="18" y="11" width="4" height="7" rx="2" />
    </>,
  ),

  // A login: a person with a padlock.
  users: svg(
    <>
      <circle cx="10" cy="8" r="3.2" />
      <path d="M3.5 20c.6-3.3 3.1-5.5 6.5-5.5.9 0 1.7.2 2.5.4" />
      <rect x="14.5" y="15.5" width="7" height="5.5" rx="1.2" />
      <path d="M16 15.5V14a2 2 0 0 1 4 0v1.5" />
    </>,
  ),
  // Up into the system.
  'data-import': svg(<path d="M12 15V3m-4 4 4-4 4 4M4 15v5h16v-5" />),
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

  // Employee-area tabs with no staff counterpart.
  // Clock.
  'employee-attendance': svg(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>,
  ),
  // A day worked swapped for a day off.
  'employee-comp-offs': svg(<path d="M4 9h15l-3-3M20 15H5l3 3" />),
  // Folder.
  'employee-documents': svg(
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  ),
};

export { icons };
