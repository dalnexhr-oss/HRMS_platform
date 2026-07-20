// Inline SVG icons from the prototype's sidebar, keyed by nav slug.
import type { ReactNode } from 'react';

const svg = (children: ReactNode) => (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    {children}
  </svg>
);

export const ICONS: Record<string, ReactNode> = {
  today: svg(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>,
  ),
  register: svg(
    <>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M3 9h18M8 4V2M16 4V2" />
    </>,
  ),
  approvals: svg(
    <>
      <path d="M9 12l2 2 4-5" />
      <circle cx="12" cy="12" r="9" />
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
  policies: svg(
    <>
      <path d="M6 2h8l4 4v16H6z" />
      <path d="M14 2v4h4M9 12h6M9 16h6M9 8h2" />
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
      <path d="M21 12a9 9 0 10-9 9h9v-9z" />
      <path d="M9 10h6M9 14h4" />
    </>,
  ),
  settings: svg(
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19 12a7 7 0 00-.2-1.6l2-1.5-2-3.4-2.3 1a7 7 0 00-2.7-1.6L13.4 2h-2.8l-.4 2.9a7 7 0 00-2.7 1.6l-2.3-1-2 3.4 2 1.5A7 7 0 005 12c0 .5.1 1.1.2 1.6l-2 1.5 2 3.4 2.3-1a7 7 0 002.7 1.6l.4 2.9h2.8l.4-2.9a7 7 0 002.7-1.6l2.3 1 2-3.4-2-1.5c.1-.5.2-1 .2-1.6z" />
    </>,
  ),
};
