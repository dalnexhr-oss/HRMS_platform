// Portal loading skeleton. CSS animations keep this a Server Component; portal-loading-prefixed styles are
// local to this layout.
function PortalLoading() {
  const stats = [0, 1, 2];
  const rows = [0, 1, 2, 3, 4];

  return (
    <div className="content-container">
      <div className="card">
        <div className="portal-loading" role="status" aria-label="Loading portal data">
          {/* Indeterminate sweep bar */}
          <div className="portal-loading-bar" aria-hidden="true" />

          {/* Page header: title + action button */}
          <div className="portal-loading-header" aria-hidden="true">
            <div>
              <div className="portal-loading-placeholder portal-loading-title" />
              <div className="portal-loading-placeholder portal-loading-subtitle" />
            </div>
            <div className="portal-loading-placeholder portal-loading-action" />
          </div>

          {/* Summary stat cards (headcount, leave, approvals…) */}
          <div className="portal-loading-summary-cards" aria-hidden="true">
            {stats.map((i) => (
              <div
                key={i}
                className="portal-loading-summary-card portal-loading-enter"
                style={{ animationDelay: `${i * 110}ms` }}
              >
                <div className="portal-loading-placeholder portal-loading-summary-card-label" />
                <div className="portal-loading-placeholder portal-loading-summary-card-value" />
              </div>
            ))}
          </div>

          {/* Roster / request rows: avatar, two lines, status pill */}
          <div aria-hidden="true">
            {rows.map((i) => (
              <div
                key={i}
                className="portal-loading-row portal-loading-enter"
                style={{ animationDelay: `${330 + i * 90}ms` }}
              >
                <div className="portal-loading-placeholder portal-loading-avatar" />
                <div className="portal-loading-row-text">
                  <div
                    className="portal-loading-placeholder portal-loading-line"
                    style={{ width: `${70 - i * 7}%` }}
                  />
                  <div
                    className="portal-loading-placeholder portal-loading-line-muted"
                    style={{ width: `${44 - i * 4}%` }}
                  />
                </div>
                <div className="portal-loading-placeholder portal-loading-badge" />
              </div>
            ))}
          </div>

          {/* Keeps the original mono "Loading…" voice, now with a pulse */}
          <p className="portal-loading-status text-muted" aria-hidden="true">
            Loading portal<span>.</span>
            <span>.</span>
            <span>.</span>
          </p>
        </div>
      </div>

      <style>{`
        .portal-loading {
          --portal-loading-base: rgba(143, 164, 197, 0.22);
          --portal-loading-sheen: rgba(23, 165, 190, 0.30);
          --portal-loading-edge: rgba(255, 255, 255, 0.70);
          padding: 24px 22px 20px;
        }

        /* Shimmering skeleton blocks */
        .portal-loading-placeholder {
          border-radius: 8px;
          background: linear-gradient(
            90deg,
            var(--portal-loading-base) 25%,
            var(--portal-loading-sheen) 37%,
            var(--portal-loading-base) 63%
          );
          background-size: 400% 100%;
          animation: portal-loading-shimmer 1.4s ease infinite;
        }

        /* Thin indeterminate bar — picks up your brand color if --accent exists */
        .portal-loading-bar {
          position: relative;
          height: 3px;
          margin-bottom: 22px;
          border-radius: 999px;
          background: var(--portal-loading-base);
          overflow: hidden;
        }
        .portal-loading-bar::after {
          content: "";
          position: absolute;
          inset: 0;
          width: 40%;
          border-radius: inherit;
          background: var(--brand, currentColor);
          opacity: 1;
          animation: portal-loading-sweep 1.2s cubic-bezier(0.4, 0, 0.2, 1) infinite;
        }

        /* Header */
        .portal-loading-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 20px;
        }
        .portal-loading-title { width: 190px; max-width: 55%; height: 20px; }
        .portal-loading-subtitle { width: 120px; height: 11px; margin-top: 9px; }
        .portal-loading-action { width: 96px; height: 32px; border-radius: 8px; flex-shrink: 0; }

        /* Stat cards */
        .portal-loading-summary-cards {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
          gap: 12px;
          margin-bottom: 20px;
        }
        .portal-loading-summary-card { padding: 14px; border: 1px solid var(--portal-loading-edge); border-radius: 10px; }
        .portal-loading-summary-card-label { width: 64px; max-width: 80%; height: 10px; }
        .portal-loading-summary-card-value { width: 84px; max-width: 60%; height: 22px; margin-top: 10px; }

        /* Rows */
        .portal-loading-row { display: flex; align-items: center; gap: 12px; padding: 12px 2px; }
        .portal-loading-row + .portal-loading-row { border-top: 1px solid var(--border-subtle, rgba(15,42,68,.09)); }
        .portal-loading-avatar { width: 32px; height: 32px; border-radius: 50%; flex-shrink: 0; }
        .portal-loading-row-text { flex: 1; min-width: 0; }
        .portal-loading-line { height: 12px; }
        .portal-loading-line-muted { height: 10px; margin-top: 7px; opacity: 0.7; }
        .portal-loading-badge { width: 58px; height: 20px; border-radius: 999px; flex-shrink: 0; }

        /* Staggered entrance */
        .portal-loading-enter {
          opacity: 0;
          animation: portal-loading-enter 0.45s ease forwards;
        }

        /* Mono status line with pulsing ellipsis */
        .portal-loading-status {
          margin: 18px 0 0;
          text-align: center;
          font: 500 12px var(--font-monospace, ui-monospace, SFMono-Regular, Menlo, monospace);
          letter-spacing: 0.05em;
          text-transform: uppercase;
          opacity: 0.6;
        }
        .portal-loading-status span { display: inline-block; animation: portal-loading-blink 1.3s infinite; }
        .portal-loading-status span:nth-child(2) { animation-delay: 0.18s; }
        .portal-loading-status span:nth-child(3) { animation-delay: 0.36s; }

        @keyframes portal-loading-shimmer {
          0% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        @keyframes portal-loading-sweep {
          0% { transform: translateX(-110%); }
          100% { transform: translateX(280%); }
        }
        @keyframes portal-loading-enter {
          from { opacity: 0; transform: translateY(5px); }
          to { opacity: 1; transform: none; }
        }
        @keyframes portal-loading-blink {
          0%, 55%, 100% { opacity: 0.15; }
          25% { opacity: 1; }
        }

        /* Calm everything down for users who prefer reduced motion */
        @media (prefers-reduced-motion: reduce) {
          .portal-loading-placeholder { animation: none; background: var(--portal-loading-base); }
          .portal-loading-bar::after { animation: none; width: 100%; opacity: 0.2; }
          .portal-loading-enter { animation: none; opacity: 1; }
          .portal-loading-status span { animation: none; }
        }
      `}</style>
    </div>
  );
}

export { PortalLoading as default };
