'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatDate, todayIST } from '@/lib/display-formatting';

type SortDirection = 'asc' | 'desc';

type ColumnDataType = 'text' | 'number' | 'date';

const sortLabels: Record<ColumnDataType, [asc: string, desc: string]> = {
  text: ['Sort A → Z', 'Sort Z → A'],
  number: ['Sort low → high', 'Sort high → low'],
  date: ['Sort oldest → newest', 'Sort newest → oldest'],
};
interface DateRange {
  from: string;
  to: string;
  blank?: boolean;
}

const emptyDateRange: DateRange = { from: '', to: '' };

const blankTokens = new Set(['', '—']);

const columnMenuWidth = 220;
const dateColumnMenuWidth = 274;

const isoDatePattern = /^\d{4}-\d{2}-\d{2}/;

// An ISO day (or the day part of a timestamp) -> epoch ms. NaN-safe.
function getDateTimestamp(v: string): number {
  const iso = isoDatePattern.exec(v);
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

interface DateRangePreset {
  label: string;
  range: DateRange;
}

/**
 * Offer date presets that intersect the column's date range. The caller supplies today when the
 * menu opens so a tab left open overnight uses the current date.
 */
function getDateRangePresets(min: string, max: string, today: string): DateRangePreset[] {
  const year = today.slice(0, 4);
  const candidates: DateRangePreset[] = [
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

function isSameDateRange(a: DateRange, b: DateRange): boolean {
  return a.from === b.from && a.to === b.to && !!a.blank === !!b.blank;
}

/** Human sentence for the active filter, announced to screen readers. */
function getDateRangeLabel(r: DateRange): string {
  if (r.blank) {
    return 'Showing rows with no date';
  }
  if (r.from && r.to) {
    return r.from === r.to
      ? `Showing ${formatDate(r.from)}`
      : `Showing ${formatDate(r.from)} → ${formatDate(r.to)}`;
  }
  if (r.from) {
    return `Showing on or after ${formatDate(r.from)}`;
  }
  if (r.to) {
    return `Showing on or before ${formatDate(r.to)}`;
  }
  return '';
}

/** True once a date filter would actually narrow the table. */
function isDateRangeActive(r?: DateRange): boolean {
  return !!r && (r.blank === true || r.from !== '' || r.to !== '');
}

/** Does a cell's date fall inside the filter? Inclusive at both ends. */
function isWithinDateRange(value: string, r?: DateRange): boolean {
  if (!r || !isDateRangeActive(r)) {
    return true;
  }
  const blank = blankTokens.has(value);
  if (r.blank) {
    return blank;
  }
  if (blank) {
    return false;
  }
  const v = getDateTimestamp(value);
  if (r.from && v < getDateTimestamp(r.from)) {
    return false;
  }
  if (r.to && v > getDateTimestamp(r.to)) {
    return false;
  }
  return true;
}

// menu

function TableColumnMenu({
  label,
  kind = 'text',
  sortDirection,
  onSort,
  options,
  selected,
  onToggle,
  onClear,
  range = emptyDateRange,
  onRange,
}: {
  label: string;
  /** Drives the compare order, the sort wording, and which filter body shows. */
  kind?: ColumnDataType;
  sortDirection: SortDirection | null;
  /** null clears the sort (clicking the active direction toggles it off). */
  onSort: (dir: SortDirection | null) => void;
  /** Distinct values present in the data — '—' stands in for blank. */
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
  onClear: () => void;
  /** Date columns only: the active from/to filter and its setter. */
  range?: DateRange;
  onRange?: (range: DateRange) => void;
}) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0 });
  const [searchQuery, setSearchQuery] = useState('');
  // Refreshed on every open, so 'Today' means today even in a tab that has sat
  // on this screen since yesterday afternoon.
  const [today, setToday] = useState(todayIST);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuPanelRef = useRef<HTMLDivElement>(null);

  // A date column falls back to the checkbox list if the screen never wired a
  // range setter — half a date filter is worse than the old one.
  const isDateFilter = kind === 'date' && !!onRange;
  const menuWidth = isDateFilter ? dateColumnMenuWidth : columnMenuWidth;

  // The column's own span, blanks excluded: it bounds the calendars and picks
  // which presets are worth showing.
  const availableDateRange = useMemo(() => {
    const days = options.filter((o) => !blankTokens.has(o)).map((o) => o.slice(0, 10));
    if (days.length === 0) {
      return null;
    }
    return {
      min: days.reduce((a, b) => (a < b ? a : b)),
      max: days.reduce((a, b) => (a > b ? a : b)),
    };
  }, [options]);

  const hasBlanks = useMemo(() => options.some((o) => blankTokens.has(o)), [options]);
  const presets = useMemo(
    () =>
      isDateFilter && availableDateRange
        ? getDateRangePresets(availableDateRange.min, availableDateRange.max, today)
        : [],
    [isDateFilter, availableDateRange, today],
  );

  function toggleOpen() {
    if (!isMenuOpen && menuButtonRef.current) {
      const r = menuButtonRef.current.getBoundingClientRect();
      setMenuPosition({
        left: Math.max(8, Math.min(r.left, window.innerWidth - menuWidth - 8)),
        top: r.bottom + 6,
      });
      setSearchQuery('');
      setToday(todayIST());
    }
    setIsMenuOpen((o) => !o);
  }

  // Clear the opposite bound when the range reverses so the filter can still match rows.
  function setFrom(v: string) {
    onRange?.({ from: v, to: range.to && v && v > range.to ? '' : range.to });
  }

  function setTo(v: string) {
    onRange?.({ from: range.from && v && v < range.from ? '' : range.from, to: v });
  }

  useEffect(() => {
    if (!isMenuOpen) {
      return;
    }
    function handleOutsideClick(e: MouseEvent) {
      const t = e.target as Node;
      if (menuPanelRef.current?.contains(t) || menuButtonRef.current?.contains(t)) {
        return;
      }
      setIsMenuOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setIsMenuOpen(false);
      }
    }
    // The pop is position:fixed, so scrolling the page or the table's
    // horizontal wrapper would leave it floating detached — just close it.
    // Scrolls inside the pop's own option list are fine.
    function closeMenuOnScroll(e: Event) {
      if (menuPanelRef.current?.contains(e.target as Node)) {
        return;
      }
      setIsMenuOpen(false);
    }
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('scroll', closeMenuOnScroll, true);
    window.addEventListener('resize', closeMenuOnScroll);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('scroll', closeMenuOnScroll, true);
      window.removeEventListener('resize', closeMenuOnScroll);
    };
  }, [isMenuOpen]);

  const isFiltering = isDateFilter ? isDateRangeActive(range) : selected.length > 0;
  const isMenuActive = sortDirection !== null || isFiltering;
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const visibleOptions = normalizedSearchQuery
    ? options.filter((o) => o.toLowerCase().includes(normalizedSearchQuery))
    : options;

  return (
    <>
      <button
        ref={menuButtonRef}
        type="button"
        className={`table-column-menu-button${isMenuActive ? ' is-active' : ''}`}
        onClick={toggleOpen}
        aria-haspopup="true"
        aria-expanded={isMenuOpen}
        title={`Sort or filter ${label}`}
      >
        {label}
        {isFiltering && (
          <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" aria-label="filtered">
            <path d="M3 4h18l-7 9v7l-4-2v-5L3 4z" />
          </svg>
        )}
        {sortDirection ? (
          <span aria-label={sortDirection === 'asc' ? 'sorted ascending' : 'sorted descending'}>
            {sortDirection === 'asc' ? '↑' : '↓'}
          </span>
        ) : (
          <svg
            width="9"
            height="9"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        )}
      </button>

      {isMenuOpen &&
        createPortal(
          <div
            ref={menuPanelRef}
            className="table-column-menu"
            style={{ left: menuPosition.left, top: menuPosition.top, width: menuWidth }}
            // A date column's body is form controls, not menu items; announcing
            // it as a menu tells a screen-reader user to expect arrow-key
            // navigation between commands that are actually text fields.
            role={isDateFilter ? 'dialog' : 'menu'}
            aria-label={`${label} column menu`}
          >
            <button
              type="button"
              className={`table-column-menu-item${sortDirection === 'asc' ? ' is-active' : ''}`}
              onClick={() => {
                onSort(sortDirection === 'asc' ? null : 'asc');
                setIsMenuOpen(false);
              }}
            >
              ↑ {sortLabels[kind][0]}
            </button>
            <button
              type="button"
              className={`table-column-menu-item${sortDirection === 'desc' ? ' is-active' : ''}`}
              onClick={() => {
                onSort(sortDirection === 'desc' ? null : 'desc');
                setIsMenuOpen(false);
              }}
            >
              ↓ {sortLabels[kind][1]}
            </button>

            <div className="table-column-menu-divider" />

            {isDateFilter ? (
              <>
                <div className="table-column-menu-header">
                  Filter by date
                  {isDateRangeActive(range) && (
                    <button
                      type="button"
                      className="table-column-menu-clear"
                      onClick={() => onRange?.(emptyDateRange)}
                    >
                      Clear
                    </button>
                  )}
                </div>

                {/* Presets apply immediately — a shortcut that then needs an
                    Apply click is not a shortcut. The menu stays open so the
                    range can be nudged from a preset into a custom span. */}
                <div className="table-column-date-presets">
                  {presets.map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      className={`table-column-date-preset${isSameDateRange(p.range, range) ? ' is-active' : ''}`}
                      aria-pressed={isSameDateRange(p.range, range)}
                      onClick={() =>
                        onRange?.(isSameDateRange(p.range, range) ? emptyDateRange : p.range)
                      }
                    >
                      {p.label}
                    </button>
                  ))}
                  {hasBlanks && (
                    <button
                      type="button"
                      className={`table-column-date-preset${range.blank ? ' is-active' : ''}`}
                      aria-pressed={!!range.blank}
                      onClick={() =>
                        onRange?.(range.blank ? emptyDateRange : { from: '', to: '', blank: true })
                      }
                    >
                      No date
                    </button>
                  )}
                </div>

                {/* Native date inputs: a real calendar on every platform, the
                    keyboard and screen-reader behaviour the OS already ships,
                    and no picker dependency to carry. */}
                <div className="table-column-date-range">
                  <label>
                    <span>From</span>
                    <input
                      type="date"
                      value={range.from}
                      min={availableDateRange?.min}
                      max={availableDateRange?.max}
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
                      min={range.from || availableDateRange?.min}
                      max={availableDateRange?.max}
                      disabled={!!range.blank}
                      aria-label={`${label}: to date`}
                      onChange={(e) => setTo(e.target.value)}
                    />
                  </label>
                </div>

                <p className="table-column-menu-note" aria-live="polite">
                  {isDateRangeActive(range)
                    ? getDateRangeLabel(range)
                    : availableDateRange
                      ? `All dates · ${formatDate(availableDateRange.min)} → ${formatDate(availableDateRange.max)}`
                      : 'No dates in this column'}
                </p>
              </>
            ) : (
              <>
                <div className="table-column-menu-header">
                  Filter
                  {selected.length > 0 && (
                    <button type="button" className="table-column-menu-clear" onClick={onClear}>
                      Clear ({selected.length})
                    </button>
                  )}
                </div>

                {options.length > 8 && (
                  <input
                    className="table-column-menu-search"
                    placeholder="Find value…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                )}

                <div className="table-column-menu-options">
                  {visibleOptions.map((o) => (
                    <label key={o} className="table-column-menu-option">
                      <input
                        type="checkbox"
                        checked={selected.includes(o)}
                        onChange={() => onToggle(o)}
                      />
                      <span title={o}>{o}</span>
                    </label>
                  ))}
                  {visibleOptions.length === 0 && (
                    <div className="text-muted" style={{ padding: '5px 8px', fontSize: 12 }}>
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

// sorts

/**
 * Sort by the column's value type. Compare dates as instants and keep blanks last in both
 * directions.
 */
function sortTableRows<T>(
  rows: T[],
  value: (row: T) => string,
  kind: ColumnDataType,
  dir: SortDirection,
): T[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((x, y) => {
    const a = value(x);
    const b = value(y);
    const blankA = blankTokens.has(a);
    const blankB = blankTokens.has(b);
    if (blankA || blankB) {
      return blankA && blankB ? 0 : blankA ? 1 : -1;
    }
    if (kind === 'date') {
      return sign * (getDateTimestamp(a) - getDateTimestamp(b));
    }
    return sign * a.localeCompare(b, undefined, { numeric: true });
  });
}

/** Distinct values, in that column's own order, for its filter list. */
function getDistinctColumnValues(values: string[], kind: ColumnDataType = 'text'): string[] {
  return sortTableRows([...new Set(values)], (v) => v, kind, 'asc');
}

export {
  emptyDateRange,
  isDateRangeActive,
  isWithinDateRange,
  TableColumnMenu,
  sortTableRows,
  getDistinctColumnValues,
  type SortDirection,
  type ColumnDataType,
  type DateRange,
};
