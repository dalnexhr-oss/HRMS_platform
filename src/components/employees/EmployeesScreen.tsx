'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { inr } from '@/lib/format';
import { AddEmployeeDrawer } from './AddEmployeeDrawer';
import { EmployeePicker } from './EmployeePicker';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { useNotifications } from '@/components/ui/Notifications';
import { fetchEmployeeForEdit, deactivateEmployee, reactivateEmployee } from '@/lib/actions/employees';
import { branchColorAt } from '@/lib/constants';
import { deleteEmployee } from '@/lib/actions/employee-deletion';
import type { EmployeeListRow, EmployeeEditRow, BranchRow } from '@/lib/queries';

function EmployeesScreen({
  rows,
  departments,
  branches = [],
}: {
  rows: EmployeeListRow[];
  departments: string[];
  // Real branches from the DB — the only values updateEmployee can resolve.
  branches?: BranchRow[];
}) {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [editing, setEditing] = useState<EmployeeEditRow | null>(null);
  // Increment on open so reopening the same employee discards abandoned edits. Keep the key stable
  // while closing.
  const [drawerOpenSequence, setDrawerOpenSequence] = useState(0);
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { confirm, confirmDialog } = useConfirm();
  const { showNotification, notificationContainer } = useNotifications();

  // Same 20-slot palette as TodayBoard's split bar (branchPalette), keyed by
  // the branch's position in the (alphabetical) branches list — so a branch
  // wears one stable colour on /dashboard and /employees alike.
  const branchColor = useMemo(() => {
    const map = new Map<string, string>();
    branches.forEach((b, i) => map.set(b.name, branchColorAt(i)));
    return (name: string) => map.get(name) ?? 'var(--brass)';
  }, [branches]);

  const activeCount = useMemo(() => rows.filter((e) => e.active).length, [rows]);
  const inactiveCount = rows.length - activeCount;
  const filtered = useMemo(() => {
    const terms = searchQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return rows.filter((e) => {
      if (!showInactive && !e.active) {
        return false;
      }
      const text = `${e.name} ${e.code} ${e.uan ?? ''}`.toLowerCase();
      return terms.every((term) => text.includes(term));
    });
  }, [searchQuery, rows, showInactive]);

  // Use the same filtered roster for the table and editable suggestions.
  const editOptions = useMemo(
    () =>
      filtered
        .filter((employee) => employee.active)
        .map((employee) => ({
          id: employee.code,
          code: employee.code,
          name: employee.name,
          searchText: employee.uan ?? '',
        })),
    [filtered],
  );

  function openAdd() {
    setEditing(null);
    setDrawerOpenSequence((s) => s + 1);
    setDrawer(true);
  }

  function openEdit(code: string) {
    setBusyCode(code);
    startTransition(async () => {
      const data = await fetchEmployeeForEdit(code);
      setBusyCode(null);
      if (!data) {
        showNotification(`Could not load ${code} for editing.`, 'error');
        return;
      }
      setEditing(data);
      setDrawerOpenSequence((s) => s + 1);
      setDrawer(true);
    });
  }

  async function onDeactivate(code: string, name: string) {
    const ok = await confirm({
      title: 'Deactivate employee',
      message: `Deactivate ${name} (${code})? They will no longer appear in the active roster, and their login will be disabled.`,
      confirmLabel: 'Deactivate',
      danger: true,
    });
    if (!ok) {
      return;
    }
    setBusyCode(code);
    startTransition(async () => {
      const res = await deactivateEmployee(code);
      setBusyCode(null);
      if (!res.ok) {
        showNotification(res.error ?? 'Could not deactivate the employee.', 'error');
      } else {
        showNotification(`${name} deactivated.`, 'success');
        router.refresh();
      }
    });
  }

  async function onReactivate(code: string, name: string) {
    const ok = await confirm({
      title: 'Reactivate employee',
      message: `Reactivate ${name} (${code})? They will return to the active roster, and their login will be re-enabled.`,
      confirmLabel: 'Reactivate',
    });
    if (!ok) {
      return;
    }
    setBusyCode(code);
    startTransition(async () => {
      const res = await reactivateEmployee(code);
      setBusyCode(null);
      if (!res.ok) {
        showNotification(res.error ?? 'Could not reactivate the employee.', 'error');
      } else {
        showNotification(`${name} reactivated.`, 'success');
        router.refresh();
      }
    });
  }

  async function onDelete(code: string, name: string) {
    const confirmed = await confirm({
      title: 'Delete inactive employee',
      message: `Delete ${name} (${code}) from the employee list and delete their linked accounts from Users? They will no longer appear under Show inactive or be available for reactivation. Attendance, payroll, and other historical records will be retained.`,
      confirmLabel: 'Delete employee',
      danger: true,
    });
    if (!confirmed) {
      return;
    }
    setBusyCode(code);
    startTransition(async () => {
      try {
        const result = await deleteEmployee(code);
        if (!result.ok) {
          showNotification(result.error, 'error');
          return;
        }
        showNotification(
          result.warning ?? `${name} and their linked user accounts deleted.`,
          result.warning ? 'info' : 'success',
        );
        router.refresh();
      } catch {
        showNotification('Could not delete the employee. Try again.', 'error');
      } finally {
        setBusyCode(null);
      }
    });
  }

  return (
    <div className="content-container">
      <div className="records-toolbar employees-toolbar">
        <EmployeePicker
          label="Find employee"
          employees={editOptions}
          value=""
          searchValue={searchQuery}
          onSearchChange={setSearchQuery}
          placeholder="Search name, employee code, or PF UAN…"
          onChange={(code) => {
            if (code) {
              openEdit(code);
            }
          }}
          disabled={pending}
        />
        <span className="status-badge" style={{ borderColor: 'var(--border-strong)', color: 'var(--text-secondary)' }}>
          {activeCount} active{inactiveCount ? ` · ${inactiveCount} inactive` : ''}
        </span>
        {inactiveCount > 0 && (
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 13,
              color: 'var(--text-secondary)',
            }}
          >
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
            />
            Show inactive
          </label>
        )}
        <button className="button primary" onClick={openAdd}>
          + Add employee
        </button>
      </div>

      {notificationContainer}

      <div className="card">
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Emp</th>
                <th>Name</th>
                <th>Branch</th>
                <th>Gender</th>
                <th>Joined</th>
                <th className="text-right">Gross / mo</th>
                <th>PF UAN</th>
                <th>ESIC</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.code}>
                  <td className="text-monospace text-muted">{e.code}</td>
                  <td>
                    <b>{e.name}</b>
                  </td>
                  <td>
                    <span
                      className="status-badge"
                      style={{
                        borderColor: branchColor(e.branch),
                        color: branchColor(e.branch),
                      }}
                    >
                      {e.branch}
                    </span>
                  </td>
                  <td>{e.gender}</td>
                  <td className="text-monospace">{e.doj}</td>
                  <td className="text-right text-monospace">{inr(e.gross)}</td>
                  <td className="text-monospace text-muted">{e.uan}</td>
                  <td className="text-monospace text-muted">{e.esic_no ?? '—'}</td>
                  <td>
                    {e.active ? (
                      <span
                        className="status-badge"
                        style={{
                          borderColor: 'var(--attendance-present-border)',
                          color: 'var(--attendance-present)',
                          background: 'var(--attendance-present-background)',
                        }}
                      >
                        Active
                      </span>
                    ) : (
                      <span
                        className="status-badge"
                        style={{ borderColor: 'var(--border-strong)', color: 'var(--text-muted)' }}
                      >
                        Inactive
                      </span>
                    )}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {e.active ? (
                        <>
                          <button
                            className="button quiet"
                            onClick={() => openEdit(e.code)}
                            disabled={pending && busyCode === e.code}
                          >
                            {pending && busyCode === e.code ? '…' : 'Edit'}
                          </button>
                          <button
                            className="button quiet"
                            onClick={() => onDeactivate(e.code, e.name)}
                            disabled={pending && busyCode === e.code}
                            title="Deactivate this employee"
                          >
                            Deactivate
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            className="button quiet"
                            onClick={() => onReactivate(e.code, e.name)}
                            disabled={pending}
                            title="Reactivate this employee"
                          >
                            {pending && busyCode === e.code ? '…' : 'Reactivate'}
                          </button>
                          {e.status === 'inactive' && (
                            <button
                              type="button"
                              className="button danger"
                              onClick={() => onDelete(e.code, e.name)}
                              disabled={pending}
                              title="Delete this inactive employee from the list"
                            >
                              {pending && busyCode === e.code ? '…' : 'Delete'}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td className="text-muted" colSpan={10} style={{ textAlign: 'center' }}>
                    {searchQuery ? `No employees match “${searchQuery}”.` : 'No employees yet.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {/*
       * Keep editing set while the drawer closes. Clearing it changes the form key and briefly resets
       * visible fields; openAdd clears it before the next blank form.
       */}
      <AddEmployeeDrawer
        open={drawer}
        employee={editing}
        departments={departments}
        branches={branches}
        formSeq={drawerOpenSequence}
        onClose={() => setDrawer(false)}
      />
      {confirmDialog}
    </div>
  );
}

export { EmployeesScreen };
