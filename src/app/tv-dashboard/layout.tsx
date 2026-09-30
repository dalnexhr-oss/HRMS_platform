import './tv-dashboard.css';
import Link from 'next/link';
import type { Metadata } from 'next';

const metadata: Metadata = {
  title: 'TV dashboard — Dalnex HRMS',
  description: 'Live employee attendance for a wall display.',
};

// Place navigation after the board so it appears when the page is scrolled to the bottom.
function TvLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="tv-dashboard-layout">
      {children}
      <footer className="card tv-dashboard-footer">
        <Link className="button" href="/dashboard">
          <span aria-hidden="true">←</span>
          Back to portal
        </Link>
      </footer>
    </div>
  );
}

export { metadata };
export { TvLayout as default };
