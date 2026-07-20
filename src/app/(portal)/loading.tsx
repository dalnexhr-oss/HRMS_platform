// Shown while a portal screen's server data loads.
export default function PortalLoading() {
  return (
    <div className="wrap">
      <div className="card">
        <div className="empty" style={{ padding: 28 }}>
          <p className="muted" style={{ font: '500 13px var(--mono)' }}>
            Loading…
          </p>
        </div>
      </div>
    </div>
  );
}
