'use client';

// Excel-style dropdown built into a table header cell (assets / inventory).
// The existing <th> label doubles as the trigger — no extra filter row. The
// popover offers asc/desc sort plus a distinct-value checkbox filter for that
// column. All state lives in the screen; this component only reports clicks.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type SortDir = 'asc' | 'desc';

const POP_W = 220;

export function ThMenu({
  label,
  numeric = false,
  sortDir,
  onSort,
  options,
  selected,
  onToggle,
  onClear,
}: {
  label: string;
  /** Quantity columns: sort labels read low/high instead of A/Z. */
  numeric?: boolean;
  sortDir: SortDir | null;
  /** null clears the sort (clicking the active direction toggles it off). */
  onSort: (dir: SortDir | null) => void;
  /** Distinct values present in the data — '—' stands in for blank. */
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const [find, setFind] = useState('');
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  function toggleOpen() {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({
        left: Math.max(8, Math.min(r.left, window.innerWidth - POP_W - 8)),
        top: r.bottom + 6,
      });
      setFind('');
    }
    setOpen((o) => !o);
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

  const active = sortDir !== null || selected.length > 0;
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
        {selected.length > 0 && (
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
            style={{ left: pos.left, top: pos.top, width: POP_W }}
            role="menu"
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
              ↑ {numeric ? 'Sort low → high' : 'Sort A → Z'}
            </button>
            <button
              type="button"
              className={'th-pop-item' + (sortDir === 'desc' ? ' on' : '')}
              onClick={() => {
                onSort(sortDir === 'desc' ? null : 'desc');
                setOpen(false);
              }}
            >
              ↓ {numeric ? 'Sort high → low' : 'Sort Z → A'}
            </button>

            <div className="th-pop-sep" />

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
          </div>,
          document.body,
        )}
    </>
  );
}

/** Distinct values, sorted naturally, for a column's filter list. */
export function distinctValues(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}
