import type { Metadata } from 'next';

const metadata: Metadata = {
  title: 'Attendance board — Dalnex HRMS',
  description: 'Live floor attendance for a wall display.',
};

// The TV board uses the full screen without portal navigation.
function TvLayout({ children }: { children: React.ReactNode }) {
  return <div className="tv-shell">{children}</div>;
}

export { metadata};
export { TvLayout as default };
