import Link from 'next/link';
import type { Route } from 'next';

function MonthNavigation({
  label,
  previousHref,
  nextHref,
}: {
  label: string;
  previousHref: Route;
  nextHref: Route;
}) {
  return (
    <nav className="month-navigation" aria-label="Month navigation">
      <Link className="month-navigation-arrow" href={previousHref} aria-label="Previous month">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="m15 18-6-6 6-6" />
        </svg>
      </Link>
      <span className="current-month">{label}</span>
      <Link className="month-navigation-arrow" href={nextHref} aria-label="Next month">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="m9 6 6 6-6 6" />
        </svg>
      </Link>
    </nav>
  );
}

export { MonthNavigation };
