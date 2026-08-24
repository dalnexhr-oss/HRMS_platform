import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Attendance board — Dalnex HRMS',
  description: 'Live floor attendance for a wall display.',
};

// No shell: the board owns the whole screen, with no sidebar or topbar to
// steal room from a display being read across an office.
export default function TvLayout({ children }: { children: React.ReactNode }) {
  return <div className="tv-shell">{children}</div>;
}
