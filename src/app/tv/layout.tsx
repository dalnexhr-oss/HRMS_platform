import Link from 'next/link';
import type { Metadata } from 'next';

const metadata: Metadata = {
  title: 'Attendance board — Dalnex HRMS',
  description: 'Live employee attendance for a wall display.',
};

// Keep navigation outside the scrolling board so it stays attached to the viewport bottom.
function TvLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="tv-shell">
      {children}
      <footer className="card tv-footer">
        <Link className="btn" href="/today">
          <span aria-hidden="true">←</span>
          Back to portal
        </Link>
      </footer>
    </div>
  );
}

export { metadata };
export { TvLayout as default };
