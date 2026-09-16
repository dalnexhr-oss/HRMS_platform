import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Attendance board — Dalnex HRMS',
  description: 'Live floor attendance for a wall display.',
};

// The TV board uses the full screen without portal navigation.
export default function TvLayout({ children }: { children: React.ReactNode }) {
  return <div className="tv-shell">{children}</div>;
}
