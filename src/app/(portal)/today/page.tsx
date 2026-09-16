import { TodayBoard, type Loaded } from '@/components/today/TodayBoard';
import { CompOffAdminCard } from '@/components/today/CompOffAdminCard';
import { LiveRefresh } from '@/components/today/LiveRefresh';
import {
  currentPeriodMonth,
  getActivityFeed,
  getCelebrationsToday,
  getCompOffAdmin,
  getPayrollRun,
  getPunchLogToday,
  getRegister,
  getSettings,
  getTodayBoard,
  type SettingView,
} from '@/lib/queries';
import type { MarkWatch, RegisterEmployee } from '@/types/domain';

// Read the current date on each request, rather than freezing it at build time.
export const dynamic = 'force-dynamic';

const tz = 'Asia/Kolkata';

// The documented rule: the 3rd late mark in a month becomes an auto half-day. Only used when the
// `mark_threshold` setting is missing or unreadable.
const defaultMarkThreshold = 3;

// How many names the marks-watch card lists.
const marksWatchLimit = 5;

// 'YYYY-MM-DD' for the business timezone — matches the date the queries filter on.
function todayISO(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
}

// '16 July' — the celebrations folio.
function todayLabel(): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: 'numeric', month: 'long' }).format(
    new Date(),
  );
}

// 'YYYY-06-01' -> 'June'.
function monthLabelOf(periodMonth: string): string {
  return new Intl.DateTimeFormat('en-GB', { month: 'long' }).format(
    new Date(periodMonth + 'T00:00:00'),
  );
}

// Let each card handle its own query failure and display the underlying error without replacing
// failed data with sample values.
async function load<T>(promise: Promise<T>): Promise<Loaded<T>> {
  try {
    return { ok: true, data: await promise };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// The late-mark threshold from settings. A settings failure must not blank the marks card — the
// *counts* are the real data, and the threshold has a documented default — so this degrades to
// defaultMarkThreshold rather than throwing.
function markThreshold(settings: Loaded<SettingView[]>): number {
  if (!settings.ok) {
    return defaultMarkThreshold;
  }
  const raw = settings.data.find((s) => s.key === 'mark_threshold')?.value;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isInteger(n) && n > 0 ? n : defaultMarkThreshold;
}

// Real late-mark counts for the period, worst first. Derived from the register's per-employee LM
// tally (attendance_days.status = 'LM').
function marksWatchFrom(register: RegisterEmployee[], threshold: number): MarkWatch[] {
  return register
    .filter((e) => e.summary.LM > 0)
    .sort((a, b) => b.summary.LM - a.summary.LM || a.name.localeCompare(b.name))
    .slice(0, marksWatchLimit)
    .map((e) => ({ employeeId: e.id, name: e.name, marks: e.summary.LM, threshold }));
}

// Live operational dashboard.
export default async function TodayPage() {
  const periodMonth = currentPeriodMonth();
  const [board, punchLog, celebrations, activity, run, register, settings, compOffs] =
    await Promise.all([
      load(getTodayBoard()),
      load(getPunchLogToday()),
      load(getCelebrationsToday()),
      load(getActivityFeed(6)),
      load(getPayrollRun(periodMonth)),
      load(getRegister(periodMonth)),
      load(getSettings()),
      load(getCompOffAdmin()),
    ]);

  const threshold = markThreshold(settings);
  const marks: Loaded<MarkWatch[]> = register.ok
    ? { ok: true, data: marksWatchFrom(register.data, threshold) }
    : register;

  return (
    <>
      {/* Punches land through /api/punch/*, which no page is subscribed to — so the board re-reads itself on a timer rather than waiting for someone to navigate. Renders nothing. */}
      <LiveRefresh />
      <TodayBoard
        board={board}
        punchLog={punchLog}
        celebrations={celebrations}
        activity={activity}
        run={run}
        marks={marks}
        markThreshold={threshold}
        today={todayISO()}
        todayLabel={todayLabel()}
        periodMonthLabel={monthLabelOf(periodMonth)}
      />

      <div className="wrap grid">
        <CompOffAdminCard
          rows={compOffs.ok ? compOffs.data : []}
          error={compOffs.ok ? undefined : compOffs.error}
        />
      </div>
    </>
  );
}
