// Client-safe types for the TV attendance board. Server queries depend on these types without
// exposing database imports to components.

// Where an employee stands right now.
type Presence =
  // punched in and still on the clock
  | 'in'
  // punched today, currently clocked out (gone home, or on a break)
  | 'out'
  // leave, week off, holiday or comp off — not expected in
  | 'off'
  // expected in, no punch yet today
  | 'awaited'
  // on leave
  | 'leave';

// One employee as the board renders them.
interface EmployeeData {
  id: string;
  code: string;
  name: string;
  designation: string | null;
  department: string | null;
  branch: string | null;
  presence: Presence;
  // ISO timestamp of the last punch today, or null.
  lastPunchAt: string | null;
  lastKind: 'in' | 'out' | null;
  // true at office, false off-site, null when the punch was not classified.
  withinGeofence: boolean | null;
  // Minutes closed out today (an open session is not included).
  workedMinutes: number;
  // The attendance_days status for today: 'P', 'L', 'WO'… or null.
  dayStatus: string | null;
}

interface BoardTotals {
  in: number;
  out: number;
  off: number;
  leave: number;
  awaited: number;
  headcount: number;
}

interface BoardData {
  // ISO date in the business timezone.
  date: string;
  // ISO timestamp the board was generated — the "as of" clock on screen.
  generatedAt: string;
  rows: EmployeeData[];
  totals: BoardTotals;
}

// Kept in step with the band headings in EmployeeScreen — the chip on a card
// and the heading above it naming the same state differently reads as a bug.
const presenceLabel: Record<Presence, string> = {
  in: 'Checked in',
  out: 'Checked out',
  off: 'Week off / holiday',
  leave: 'On leave',
  awaited: 'Yet to check in',
};

export { presenceLabel, type Presence, type EmployeeData, type BoardTotals, type BoardData };
