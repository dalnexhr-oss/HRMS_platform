'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatDate, todayIST } from '@/lib/format';

export type SortDir = 'asc' | 'desc';

export type ColKind = 'text' | 'number' | 'date';

const SORT_LABELS: Record<ColKind, [asc: string, desc: string]> = {
  text: ['Sort A → Z', 'Sort Z → A'],
  number: ['Sort low → high', 'Sort high → low'],
  date: ['Sort oldest → newest', 'Sort newest → oldest'],
};
export type DateRange = { from: string; to: string; blank?: boolean };

export const NO_RANGE: DateRange = { from: '', to: '' };

const BLANK = new Set(['', '—']);

const POP_W = 220;
const POP_W_DATE = 274;


const ISO_DAY = /^\d{4}-\d{2}-\d{2}/;

/** An ISO day (or the day part of a timestamp) -> epoch ms. NaN-safe. */
function dateValue(v: string): number {
  const iso = ISO_DAY.exec(v);
  const t = Date.parse(iso ? `${iso[0]}T00:00:00` : v);
  return Number.isNaN(t) ? 0 : t;
}

/** ISO day arithmetic in UTC — local math drifts across a DST boundary. */
function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function monthStart(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

function monthEnd(iso: string): string {
  const [y, m] = iso.split('-').map(Number);
  return shiftDays(m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`, -1);
}

type Preset = { label: string; range: DateRange };

/**
 * The presets on offer are derived from the column's own data, not hard-coded.
 * A warranty-end column holds nothing but future dates, where 'Last 7 days'
 * can only ever return an empty table; a filed-on column is all past, where
 * 'Next 30 days' is just as dead. Anything that cannot intersect [min, max] is
 * dropped, so every button left in the menu returns rows.
 *
 * `today` is passed in rather than read here, so it can be refreshed each time
 * the menu opens — a tab left open overnight must not still offer yesterday.
 */
function presetsFor(min: string, max: string, today: string): Preset[] {
  const year = today.slice(0, 4);
  const candidates: Preset[] = [
    { label: 'Today', range: { from: today, to: today } },
    { label: 'Last 7 days', range: { from: shiftDays(today, -6), to: today } },
    { label: 'Last 30 days', range: { from: shiftDays(today, -29), to: today } },
    { label: 'This month', range: { from: monthStart(today), to: monthEnd(today) } },
    { label: 'This year', range: { from: `${year}-01-01`, to: `${year}-12-31` } },
    { label: 'Next 30 days', range: { from: today, to: shiftDays(today, 30) } },
    { label: 'Next 90 days', range: { from: today, to: shiftDays(today, 90) } },
    { label: 'Before today', range: { from: '', to: shiftDays(today, -1) } },
    { label: 'After today', range: { from: shiftDays(today, 1), to: '' } },
  ];
  // Overlap test against the column's span; an open end is unbounded.
  return candidates.filter(
    (p) => (!p.range.from || p.range.from <= max) && (!p.range.to || p.range.to >= min),
  );
}

function sameRange(a: DateRange, b: DateRange): boolean {
  return a.from === b.from && a.to === b.to && !!a.blank === !!b.blank;
}

/** Human sentence for the active filter, announced to screen readers. */
function rangeLabel(r: DateRange): string {
  if (r.blank) return 'Showing rows with no date';
  if (r.from && r.to) {
    return r.from === r.to
      ? `Showing ${formatDate(r.from)}`
      : `Showing ${formatDate(r.from)} → ${formatDate(r.to)}`;
  }
  if (r.from) return `Showing on or after ${formatDate(r.from)}`;
  if (r.to) return `Showing on or before ${formatDate(r.to)}`;
  return '';
}

/** True once a date filter would actually narrow the table. */
export function rangeActive(r?: DateRange): boolean {
  return !!r && (r.blank === true || r.from !== '' || r.to !== '');
}

/** Does a cell's date fall inside the filter? Inclusive at both ends. */
export function inDateRange(value: string, r?: DateRange): boolean {
  if (!r || !rangeActive(r)) return true;
  const blank = BLANK.has(value);
  if (r.blank) return blank;
  if (blank) return false;
  const v = dateValue(value);
  if (r.from && v < dateValue(r.from)) return false;
  if (r.to && v > dateValue(r.to)) return false;
  return true;
}

// ------------------------------------------------------------------- menu ---

export function ThMenu({
  label,
  kind = 'text',
  sortDir,
  onSort,
  options,
  selected,
  onToggle,
  onClear,
  range = NO_RANGE,
  onRange,
}: {
  label: string;
  /** Drives the compare order, the sort wording, and which filter body shows. */
  kind?: ColKind;
  sortDir: SortDir | null;
  /** null clears the sort (clicking the active direction toggles it off). */
  onSort: (dir: SortDir | null) => void;
  /** Distinct values present in the data — '—' stands in for blank. */
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
  onClear: () => void;
  /** Date columns only: the active from/to filter and its setter. */
  range?: DateRange;
  onRange?: (range: DateRange) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const [find, setFind] = useState('');
  // Refreshed on every open, so 'Today' means today even in a tab that has sat
  // on this screen since yesterday afternoon.
  const [today, setToday] = useState(todayIST);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  // A date column falls back to the checkbox list if the screen never wired a
  // range setter — half a date filter is worse than the old one.
  const isDate = kind === 'date' && !!onRange;
  const width = isDate ? POP_W_DATE : POP_W;

  // The column's own span, blanks excluded: it bounds the calendars and picks
  // which presets are worth showing.
  const span = useMemo(() => {
    const days = options.filter((o) => !BLANK.has(o)).map((o) => o.slice(0, 10));
    if (days.length === 0) return null;
    return {
      min: days.reduce((a, b) => (a < b ? a : b)),
      max: days.reduce((a, b) => (a > b ? a : b)),
    };
  }, [options]);

  const hasBlanks = useMemo(() => options.some((o) => BLANK.has(o)), [options]);
  const presets = useMemo(
    () => (isDate && span ? presetsFor(span.min, span.max, today) : []),
    [isDate, span, today],
  );

  function toggleOpen() {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({
        left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
        top: r.bottom + 6,
      });
      setFind('');
      setToday(todayIST());
    }
    setOpen((o) => !o);
  }

  // Moving one end past the other clears the other end, rather than leaving
  // the pair in a state that can match nothing. AG Grid instead paints the
  // input red and quietly stops filtering, which strands the user in a table
  // that no longer answers to its own header.
  function setFrom(v: string) {
    onRange?.({ from: v, to: range.to && v && v > range.to ? '' : range.to });
  }

  function setTo(v: string) {
    onRange?.({ from: range.from && v && v < range.from ? '' : range.from, to: v });
  }

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    // The pop is position:fixed, so scrolling the page or the table's
    // horizontal wrapper would leave it floating detached — just close it.
    // Scrolls inside the pop's own option list are fine.
    function onScroll(e: Event) {
      if (popRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  const filtering = isDate ? rangeActive(range) : selected.length > 0;
  const active = sortDir !== null || filtering;
  const term = find.trim().toLowerCase();
  const shown = term ? options.filter((o) => o.toLowerCase().includes(term)) : options;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={'th-btn' + (active ? ' on' : '')}
        onClick={toggleOpen}
        aria-haspopup="true"
        aria-expanded={open}
        title={`Sort or filter ${label}`}
      >
        {label}
        {filtering && (
          <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" aria-label="filtered">
            <path d="M3 4h18l-7 9v7l-4-2v-5L3 4z" />
          </svg>
        )}
        {sortDir ? (
          <span aria-label={sortDir === 'asc' ? 'sorted ascending' : 'sorted descending'}>
            {sortDir === 'asc' ? '↑' : '↓'}
          </span>
        ) : (
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <path d="M6 9l6 6 6-6" />
          </svg>
        )}
      </button>

      {open &&
        createPortal(
          <div
            ref={popRef}
            className="th-pop"
            style={{ left: pos.left, top: pos.top, width }}
            // A date column's body is form controls, not menu items; announcing
            // it as a menu tells a screen-reader user to expect arrow-key
            // navigation between commands that are actually text fields.
            role={isDate ? 'dialog' : 'menu'}
            aria-label={`${label} column menu`}
          >
            <button
              type="button"
              className={'th-pop-item' + (sortDir === 'asc' ? ' on' : '')}
              onClick={() => {
                onSort(sortDir === 'asc' ? null : 'asc');
                setOpen(false);
              }}
            >
              ↑ {SORT_LABELS[kind][0]}
            </button>
            <button
              type="button"
              className={'th-pop-item' + (sortDir === 'desc' ? ' on' : '')}
              onClick={() => {
                onSort(sortDir === 'desc' ? null : 'desc');
                setOpen(false);
              }}
            >
              ↓ {SORT_LABELS[kind][1]}
            </button>

            <div className="th-pop-sep" />

            {isDate ? (
              <>
                <div className="th-pop-hd">
                  Filter by date
                  {rangeActive(range) && (
                    <button type="button" className="th-pop-clear" onClick={() => onRange?.(NO_RANGE)}>
                      Clear
                    </button>
                  )}
                </div>

                {/* Presets apply immediately — a shortcut that then needs an
                    Apply click is not a shortcut. The menu stays open so the
                    range can be nudged from a preset into a custom span. */}
                <div className="th-pop-chips">
                  {presets.map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      className={'th-chip' + (sameRange(p.range, range) ? ' on' : '')}
                      aria-pressed={sameRange(p.range, range)}
                      onClick={() => onRange?.(sameRange(p.range, range) ? NO_RANGE : p.range)}
                    >
                      {p.label}
                    </button>
                  ))}
                  {hasBlanks && (
                    <button
                      type="button"
                      className={'th-chip' + (range.blank ? ' on' : '')}
                      aria-pressed={!!range.blank}
                      onClick={() => onRange?.(range.blank ? NO_RANGE : { from: '', to: '', blank: true })}
                    >
                      No date
                    </button>
                  )}
                </div>

                {/* Native date inputs: a real calendar on every platform, the
                    keyboard and screen-reader behaviour the OS already ships,
                    and no picker dependency to carry. */}
                <div className="th-pop-dates">
                  <label>
                    <span>From</span>
                    <input
                      type="date"
                      value={range.from}
                      min={span?.min}
                      max={span?.max}
                      disabled={!!range.blank}
                      aria-label={`${label}: from date`}
                      onChange={(e) => setFrom(e.target.value)}
                    />
                  </label>
                  <label>
                    <span>To</span>
                    <input
                      type="date"
                      value={range.to}
                      min={range.from || span?.min}
                      max={span?.max}
                      disabled={!!range.blank}
                      aria-label={`${label}: to date`}
                      onChange={(e) => setTo(e.target.value)}
                    />
                  </label>
                </div>

                <p className="th-pop-note" aria-live="polite">
                  {rangeActive(range)
                    ? rangeLabel(range)
                    : span
                      ? `All dates · ${formatDate(span.min)} → ${formatDate(span.max)}`
                      : 'No dates in this column'}
                </p>
              </>
            ) : (
              <>
                <div className="th-pop-hd">
                  Filter
                  {selected.length > 0 && (
                    <button type="button" className="th-pop-clear" onClick={onClear}>
                      Clear ({selected.length})
                    </button>
                  )}
                </div>

                {options.length > 8 && (
                  <input
                    className="th-pop-find"
                    placeholder="Find value…"
                    value={find}
                    onChange={(e) => setFind(e.target.value)}
                  />
                )}

                <div className="th-pop-list">
                  {shown.map((o) => (
                    <label key={o} className="th-pop-opt">
                      <input type="checkbox" checked={selected.includes(o)} onChange={() => onToggle(o)} />
                      <span title={o}>{o}</span>
                    </label>
                  ))}
                  {shown.length === 0 && (
                    <div className="muted" style={{ padding: '5px 8px', fontSize: 12 }}>
                      No matching values
                    </div>
                  )}
                </div>
              </>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

// ------------------------------------------------------------------ sorts ---

/**
 * Sort rows by one column, the way that column's kind demands.
 *
 * Date columns compare as instants, never as text — an A → Z sort on a date
 * orders by the leading character, so '02 Jan' lands before '15 Dec' of the
 * year before. Blanks sink to the bottom in BOTH directions: flipping the sort
 * should not fill the top of the table with rows that have no value here.
 */
export function sortRows<T>(rows: T[], value: (row: T) => string, kind: ColKind, dir: SortDir): T[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((x, y) => {
    const a = value(x);
    const b = value(y);
    const blankA = BLANK.has(a);
    const blankB = BLANK.has(b);
    if (blankA || blankB) return blankA && blankB ? 0 : blankA ? 1 : -1;
    if (kind === 'date') return sign * (dateValue(a) - dateValue(b));
    return sign * a.localeCompare(b, undefined, { numeric: true });
  });
}

/** Distinct values, in that column's own order, for its filter list. */
export function distinctValues(values: string[], kind: ColKind = 'text'): string[] {
  return sortRows([...new Set(values)], (v) => v, kind, 'asc');
}
