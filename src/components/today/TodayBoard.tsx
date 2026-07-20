import Link from 'next/link';
import { Stamp } from '@/components/ui/Stamp';
import { ExportButton } from '@/components/today/ExportButton';
import type { ActivityRow, PayrollRunView } from '@/lib/queries';
import type { Celebration, MarkWatch, PunchLogRow, TodayKpis } from '@/types/domain';

/**
 * Every section loads independently, so one broken query does not blank the whole
 * dashboard. A failure carries the REAL error message to the screen — we never swap
 * in demo data to hide it.
 *
 * `ok` is a literal discriminant on purpose: `error: string | null` would not narrow
 * `.data` for TypeScript, and it mirrors the { ok, error } shape server actions use.
 */
export type Loaded<T> = { ok: true; data: T } | { ok: false; error: string };

export interface TodayBoardProps {
  board: Loaded<TodayKpis>;
  punchLog: Loaded<PunchLogRow[]>;
  celebrations: Loaded<Celebration[]>;
  activity: Loaded<ActivityRow[]>;
  run: Loaded<PayrollRunView | null>;
  /** Real late-mark counts for the period, worst first. */
  marks: Loaded<MarkWatch[]>;
  /** Late marks that convert into an auto half-day — sets the meter's pip count. */
  markThreshold: number;
  /** Business date for the punch log / celebrations, 'YYYY-MM-DD' in Asia/Kolkata. */
  today: string;
  /** '16 July' — the celebrations folio. */
  todayLabel: string;
  /** The period the register/payroll cards describe, e.g. 'June'. */
  periodMonthLabel: string;
}

// The split bar cycles the palette already defined in globals.css, so any number of
// branches renders without new CSS. Pune/Vadodara keep their original brand/brass.
const BRANCH_COLORS = ['var(--brand)', 'var(--brass)', 'var(--od)', 'var(--lv)', 'var(--oh)', 'var(--p)'];

const RUN_STATUS_LABEL: Record<PayrollRunView['status'], string> = {
  draft: 'Draft',
  in_review: 'In review',
  locked: 'Locked',
  paid: 'Paid',
};

/** timestamptz -> '10 Jul' in the business timezone. */
function stamp(ts: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
  }).format(new Date(ts));
}

function runNote(run: PayrollRunView | null): string {
  if (!run) return 'No run has been created for this month.';
  switch (run.status) {
    case 'paid':
      return run.paidAt ? `Paid ${stamp(run.paidAt)}` : 'Marked paid';
    case 'locked':
      return run.lockedAt ? `Locked ${stamp(run.lockedAt)}` : 'Locked — no further edits';
    case 'in_review':
      return run.draftsComputedAt
        ? `Drafts computed ${stamp(run.draftsComputedAt)}`
        : 'Awaiting review';
    case 'draft':
      return run.draftsComputedAt
        ? `Drafts computed ${stamp(run.draftsComputedAt)}`
        : 'Drafts not computed yet';
  }
}

/** 1 -> '1st', 2 -> '2nd', 3 -> '3rd', 4 -> '4th'. */
function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

function celebrationIcon(kind: Celebration['kind']): string {
  return kind === 'birthday' ? '🎂' : '🏅';
}

function celebrationNote(c: Celebration): string {
  if (c.kind === 'birthday') return 'birthday';
  return c.years === 1 ? '1 year at Dalnex' : `${c.years} years at Dalnex`;
}

function celebrationMeta(c: Celebration): string {
  return c.department ? `${c.branch} · ${c.department}` : c.branch;
}

/** An in-card failure state carrying the query's real error text. */
function LoadError({ what, message }: { what: string; message: string }) {
  return (
    <div className="empty">
      <h3>Couldn’t load {what}</h3>
      <p className="mono" style={{ fontSize: 12, color: 'var(--ab)', wordBreak: 'break-word' }}>
        {message}
      </p>
    </div>
  );
}

export function TodayBoard({
  board,
  punchLog,
  celebrations,
  activity,
  run,
  marks,
  markThreshold,
  today,
  todayLabel,
  periodMonthLabel,
}: TodayBoardProps) {
  const kpis = board.ok ? board.data : null;
  const branches = kpis?.byBranch ?? [];
  const branchTotal = branches.reduce((a, b) => a + b.count, 0);

  return (
    <div className="wrap grid">
      {/* KPIs */}
      <div className="kpis">
        <div className="card kpi">
          <div className="lab">Present today</div>
          <div className="val" style={{ color: 'var(--p)' }}>
            {kpis ? (
              <>
                {kpis.present}
                <small> / {kpis.headcount}</small>
              </>
            ) : (
              '—'
            )}
          </div>
          <div className="note" style={board.ok ? undefined : { color: 'var(--ab)' }}>
            {board.ok
              ? `${board.data.inOffice} in office · ${board.data.field} on outdoor duty`
              : board.error}
          </div>
        </div>

        <div className="card kpi">
          <div className="lab">Absent</div>
          <div className="val" style={{ color: 'var(--ab)' }}>
            {kpis ? kpis.absent : '—'}
          </div>
          <div className="note">
            {kpis ? 'No punch, no approved leave' : 'Unavailable'}
          </div>
        </div>

        <div className="card kpi">
          <div className="lab">Headcount by branch</div>
          <div className="val">{kpis ? kpis.headcount : '—'}</div>
          {branchTotal > 0 ? (
            <>
              <div className="split">
                {branches.map((b, i) => (
                  <i
                    key={b.branch}
                    style={{
                      width: `${(b.count / branchTotal) * 100}%`,
                      background: BRANCH_COLORS[i % BRANCH_COLORS.length],
                    }}
                  />
                ))}
              </div>
              <div className="legend-line">
                {branches.map((b, i) => (
                  <span key={b.branch}>
                    <span
                      className="dot"
                      style={{ background: BRANCH_COLORS[i % BRANCH_COLORS.length] }}
                    />
                    {b.branch} {b.count}
                  </span>
                ))}
              </div>
            </>
          ) : (
            <div className="note">{board.ok ? 'No branches on record' : 'Unavailable'}</div>
          )}
        </div>

        <div className="card kpi">
          <div className="lab">{periodMonthLabel} payroll</div>
          <div className="val" style={{ fontSize: 22, paddingTop: 6 }}>
            {!run.ok ? '—' : run.data ? RUN_STATUS_LABEL[run.data.status] : 'Not started'}
          </div>
          <div className="note" style={run.ok ? undefined : { color: 'var(--ab)' }}>
            {run.ok ? (
              <>
                {runNote(run.data)} ·{' '}
                <Link href="/payroll" style={{ color: 'var(--brand)', fontWeight: 600 }}>
                  open run →
                </Link>
              </>
            ) : (
              run.error
            )}
          </div>
        </div>
      </div>

      <div className="two-col">
        {/* Punch log */}
        <div className="card">
          <div className="hd">
            <h3>Punch log — today</h3>
            <span className="folio">Live · from mobile app</span>
            <span style={{ flex: 1 }} />
            <ExportButton
              rows={punchLog.ok ? punchLog.data : []}
              date={today}
              disabledReason={punchLog.ok ? null : 'The punch log failed to load — nothing to export.'}
            />
          </div>
          {!punchLog.ok ? (
            <LoadError what="the punch log" message={punchLog.error} />
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>Emp</th>
                    <th>Name</th>
                    <th>Branch</th>
                    <th>In</th>
                    <th>Out</th>
                    <th>Active</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {punchLog.data.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="muted" style={{ textAlign: 'center' }}>
                        No punches recorded today.
                      </td>
                    </tr>
                  ) : (
                    punchLog.data.map((r) => (
                      <tr key={r.code}>
                        <td className="mono muted">{r.code}</td>
                        <td>
                          <b>{r.name}</b>
                        </td>
                        <td>{r.branch}</td>
                        <td className="mono">{r.in ?? '—'}</td>
                        <td className="mono">{r.out ?? '—'}</td>
                        <td className="mono">{r.active ?? '—'}</td>
                        <td>
                          <Stamp status={r.status} />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="grid">
          {/* Celebrations */}
          <div className="card">
            <div className="hd">
              <h3>Celebrations</h3>
              <span className="folio">{todayLabel}</span>
            </div>
            {!celebrations.ok ? (
              <LoadError what="celebrations" message={celebrations.error} />
            ) : (
              <div className="bd" style={{ paddingTop: 8 }}>
                {celebrations.data.length === 0 ? (
                  <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                    Nothing to celebrate today.
                  </p>
                ) : (
                  celebrations.data.map((c) => (
                    <div className="cel" key={c.id}>
                      <span className="badge">{celebrationIcon(c.kind)}</span>
                      <div>
                        <b>{c.name}</b> — {celebrationNote(c)}
                        <br />
                        <span className="muted" style={{ fontSize: 12 }}>
                          {celebrationMeta(c)}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Marks watch — real LM counts for the period, derived from the register's
              per-employee tally of attendance_days.status = 'LM'. The meter's pip count
              is the mark_threshold setting, so the card matches the configured rule. */}
          <div className="card watch">
            <div className="hd">
              <h3>Marks watch — {periodMonthLabel}</h3>
              <span className="folio">{ordinal(markThreshold)} mark = auto half-day</span>
            </div>
            {!marks.ok ? (
              <LoadError what="late marks" message={marks.error} />
            ) : (
              <div className="bd" style={{ paddingTop: 6 }}>
                {marks.data.length === 0 ? (
                  <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                    No late marks in {periodMonthLabel}.
                  </p>
                ) : (
                  marks.data.map((m) => {
                    // "Hot" = one mark away from the auto half-day.
                    const hot = m.marks >= m.threshold - 1;
                    return (
                      <div className="row" key={m.employeeId}>
                        <div>
                          <b>{m.name}</b>{' '}
                          <span className="muted" style={{ fontSize: 12 }}>
                            · {m.marks} mark{m.marks === 1 ? '' : 's'}
                          </span>
                        </div>
                        <div className={`meter${hot ? ' hot' : ''}`}>
                          {Array.from({ length: m.threshold }, (_, n) => (
                            <i key={n} className={n < m.marks ? 'f' : ''} />
                          ))}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {/* Activity — messages are plain text from activity_log. Rendered as text,
              never as HTML: dangerouslySetInnerHTML here would be stored XSS the moment
              a message contains user-supplied content. */}
          <div className="card">
            <div className="hd">
              <h3>Activity</h3>
            </div>
            {!activity.ok ? (
              <LoadError what="the activity feed" message={activity.error} />
            ) : (
              <div className="bd" style={{ paddingTop: 4 }}>
                {activity.data.length === 0 ? (
                  <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                    No activity recorded yet.
                  </p>
                ) : (
                  activity.data.map((a) => (
                    <div className="feedrow" key={a.id}>
                      <span className="when">{a.when}</span>
                      <div>{a.message}</div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
