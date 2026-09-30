// Shown while the employee dashboard's server data loads.
function EmployeeLoading() {
  return (
    <div className="content-container">
      <div className="card">
        <div className="empty-state" style={{ padding: 28 }}>
          <p className="text-muted" style={{ font: '500 13px var(--font-monospace)' }}>
            Loading…
          </p>
        </div>
      </div>
    </div>
  );
}

export { EmployeeLoading as default };
