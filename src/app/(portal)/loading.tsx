// Shown while a portal screen's server data loads.
// Pure CSS animation — stays a server component, no "use client" needed.
// All classes are prefixed `plx-` and styles ship in this file, so nothing
// in your global CSS changes. Inherits your `wrap` / `card` / `muted` look.
export default function PortalLoading() {
  const stats = [0, 1, 2];
  const rows = [0, 1, 2, 3, 4];

  return (
    <div className="wrap">
      <div className="card">
        <div className="plx" role="status" aria-label="Loading portal data">
          {/* Indeterminate sweep bar */}
          <div className="plx-bar" aria-hidden="true" />

          {/* Page header: title + action button */}
          <div className="plx-head" aria-hidden="true">
            <div>
              <div className="plx-bone plx-title" />
              <div className="plx-bone plx-subtitle" />
            </div>
            <div className="plx-bone plx-action" />
          </div>

          {/* Summary stat cards (headcount, leave, approvals…) */}
          <div className="plx-stats" aria-hidden="true">
            {stats.map((i) => (
              <div
                key={i}
                className="plx-stat plx-enter"
                style={{ animationDelay: `${i * 110}ms` }}
              >
                <div className="plx-bone plx-stat-label" />
                <div className="plx-bone plx-stat-value" />
              </div>
            ))}
          </div>

          {/* Roster / request rows: avatar, two lines, status pill */}
          <div aria-hidden="true">
            {rows.map((i) => (
              <div
                key={i}
                className="plx-row plx-enter"
                style={{ animationDelay: `${330 + i * 90}ms` }}
              >
                <div className="plx-bone plx-avatar" />
                <div className="plx-row-text">
                  <div className="plx-bone plx-line" style={{ width: `${70 - i * 7}%` }} />
                  <div className="plx-bone plx-line-dim" style={{ width: `${44 - i * 4}%` }} />
                </div>
                <div className="plx-bone plx-pill" />
              </div>
            ))}
          </div>

          {/* Keeps the original mono "Loading…" voice, now with a pulse */}
          <p className="plx-status muted" aria-hidden="true">
            Loading portal<span>.</span><span>.</span><span>.</span>
          </p>
        </div>
      </div>

      <style>{`
        .plx {
          --plx-base: rgba(143, 164, 197, 0.22);
          --plx-sheen: rgba(23, 165, 190, 0.30);
          --plx-edge: rgba(255, 255, 255, 0.70);
          padding: 24px 22px 20px;
        }

        /* Shimmering skeleton blocks */
        .plx-bone {
          border-radius: 8px;
          background: linear-gradient(
            90deg,
            var(--plx-base) 25%,
            var(--plx-sheen) 37%,
            var(--plx-base) 63%
          );
          background-size: 400% 100%;
          animation: plx-shimmer 1.4s ease infinite;
        }

        /* Thin indeterminate bar — picks up your brand color if --accent exists */
        .plx-bar {
          position: relative;
          height: 3px;
          margin-bottom: 22px;
          border-radius: 999px;
          background: var(--plx-base);
          overflow: hidden;
        }
        .plx-bar::after {
          content: "";
          position: absolute;
          inset: 0;
          width: 40%;
          border-radius: inherit;
          background: var(--brand, currentColor);
          opacity: 1;
          animation: plx-sweep 1.2s cubic-bezier(0.4, 0, 0.2, 1) infinite;
        }

        /* Header */
        .plx-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 20px;
        }
        .plx-title { width: 190px; max-width: 55%; height: 20px; }
        .plx-subtitle { width: 120px; height: 11px; margin-top: 9px; }
        .plx-action { width: 96px; height: 32px; border-radius: 8px; flex-shrink: 0; }

        /* Stat cards */
        .plx-stats {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
          gap: 12px;
          margin-bottom: 20px;
        }
        .plx-stat { padding: 14px; border: 1px solid var(--plx-edge); border-radius: 10px; }
        .plx-stat-label { width: 64px; max-width: 80%; height: 10px; }
        .plx-stat-value { width: 84px; max-width: 60%; height: 22px; margin-top: 10px; }

        /* Rows */
        .plx-row { display: flex; align-items: center; gap: 12px; padding: 12px 2px; }
        .plx-row + .plx-row { border-top: 1px solid var(--line, rgba(15,42,68,.09)); }
        .plx-avatar { width: 32px; height: 32px; border-radius: 50%; flex-shrink: 0; }
        .plx-row-text { flex: 1; min-width: 0; }
        .plx-line { height: 12px; }
        .plx-line-dim { height: 10px; margin-top: 7px; opacity: 0.7; }
        .plx-pill { width: 58px; height: 20px; border-radius: 999px; flex-shrink: 0; }

        /* Staggered entrance */
        .plx-enter {
          opacity: 0;
          animation: plx-in 0.45s ease forwards;
        }

        /* Mono status line with pulsing ellipsis */
        .plx-status {
          margin: 18px 0 0;
          text-align: center;
          font: 500 12px var(--mono, ui-monospace, SFMono-Regular, Menlo, monospace);
          letter-spacing: 0.05em;
          text-transform: uppercase;
          opacity: 0.6;
        }
        .plx-status span { display: inline-block; animation: plx-blink 1.3s infinite; }
        .plx-status span:nth-child(2) { animation-delay: 0.18s; }
        .plx-status span:nth-child(3) { animation-delay: 0.36s; }

        @keyframes plx-shimmer {
          0% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        @keyframes plx-sweep {
          0% { transform: translateX(-110%); }
          100% { transform: translateX(280%); }
        }
        @keyframes plx-in {
          from { opacity: 0; transform: translateY(5px); }
          to { opacity: 1; transform: none; }
        }
        @keyframes plx-blink {
          0%, 55%, 100% { opacity: 0.15; }
          25% { opacity: 1; }
        }

        /* Calm everything down for users who prefer reduced motion */
        @media (prefers-reduced-motion: reduce) {
          .plx-bone { animation: none; background: var(--plx-base); }
          .plx-bar::after { animation: none; width: 100%; opacity: 0.2; }
          .plx-enter { animation: none; opacity: 1; }
          .plx-status span { animation: none; }
        }
      `}</style>
    </div>
  );
}