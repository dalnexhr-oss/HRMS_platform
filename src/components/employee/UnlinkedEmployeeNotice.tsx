// Shown on employee tabs when the login has no employee record, so an empty tab explains itself.
function UnlinkedEmployeeNotice({ employeeId }: { employeeId: string | null }) {
  if (employeeId) {
    return null;
  }

  return (
    <div className="card">
      <div className="card-body">
        <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
          Your login is not linked to an employee record yet, so your attendance, payslips, requests
          and tickets cannot be shown. Ask HR to link your account.
        </p>
      </div>
    </div>
  );
}

export { UnlinkedEmployeeNotice };
