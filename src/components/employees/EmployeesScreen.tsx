'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { inr } from '@/lib/format';
import { AddEmployeeDrawer } from './AddEmployeeDrawer';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import { fetchEmployeeForEdit, deactivateEmployee, reactivateEmployee } from '@/lib/actions/employees';
import type { EmployeeListRow, EmployeeEditRow, BranchRow } from '@/lib/queries';

export function EmployeesScreen({
  rows,
  departments,
  branches = [],
}: {
  rows: EmployeeListRow[];
  departments: string[];
  /** Real branches from the DB — the only values updateEmployee can resolve. */
  branches?: BranchRow[];
}) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [editing, setEditing] = useState<EmployeeEditRow | null>(null);
  // Bumped on every open. The drawer keys its form on this, so each open starts
  // from the freshly loaded values — without it, reopening the SAME employee
  // would reuse the mounted form and show whatever was typed and abandoned last
  // time. It also means closing the drawer never re-keys the form (see below).
  const [openSeq, setOpenSeq] = useState(0);
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { confirm, confirmDialog } = useConfirm();
  const { toast, toastNode } = useToast();

  const activeCount = useMemo(() => rows.filter((e) => e.active).length, [rows]);
  const inactiveCount = rows.length - activeCount;

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((e) => {
      if (!showInactive && !e.active) return false;
      if (!term) return true;
      return (
        e.name.toLowerCase().includes(term) ||
        e.code.toLowerCase().includes(term) ||
        (e.uan ?? '').toLowerCase().includes(term)
      );
    });
  }, [q, rows, showInactive]);

  function openAdd() {
    setEditing(null);
    setOpenSeq((s) => s + 1);
    setDrawer(true);
  }

  function openEdit(code: string) {
    setBusyCode(code);
    startTransition(async () => {
      const data = await fetchEmployeeForEdit(code);
      setBusyCode(null);
      if (!data) {
        toast(`Could not load ${code} for editing.`, 'error');
        return;
      }
      setEditing(data);
      setOpenSeq((s) => s + 1);
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
    if (!ok) return;
    setBusyCode(code);
    startTransition(async () => {
      const res = await deactivateEmployee(code);
      setBusyCode(null);
      if (!res.ok) toast(res.error ?? 'Could not deactivate the employee.', 'error');
      else {
        toast(`${name} deactivated.`, 'success');
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
    if (!ok) return;
    setBusyCode(code);
    startTransition(async () => {
      const res = await reactivateEmployee(code);
      setBusyCode(null);
      if (!res.ok) toast(res.error ?? 'Could not reactivate the employee.', 'error');
      else {
        toast(`${name} reactivated.`, 'success');
        router.refresh();
      }
    });
  }

  return (
    <div className="wrap">
      <div className="emp-top">
        <div className="search">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            placeholder="Search name, code, PAN…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <span className="pill" style={{ borderColor: 'var(--line-2)', color: 'var(--ink-2)' }}>
          {activeCount} active{inactiveCount ? ` · ${inactiveCount} inactive` : ''}
        </span>
        {inactiveCount > 0 && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--ink-2)' }}>
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
            />
            Show inactive
          </label>
        )}
        <span style={{ flex: 1 }} />
        <button className="btn primary" onClick={openAdd}>
          + Add employee
        </button>
      </div>

      {toastNode}

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
                <th className="right">Gross / mo</th>
                <th>PF UAN</th>
                <th>ESIC</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.code}>
                  <td className="mono muted">{e.code}</td>
                  <td>
                    <b>{e.name}</b>
                  </td>
                  <td>
                    <span
                      className="pill"
                      style={{
                        borderColor: e.branch === 'Pune' ? 'var(--brand)' : 'var(--brass)',
                        color: e.branch === 'Pune' ? 'var(--brand)' : 'var(--brass)',
                      }}
                    >
                      {e.branch}
                    </span>
                  </td>
                  <td>{e.gender}</td>
                  <td className="mono">{e.doj}</td>
                  <td className="right mono">{inr(e.gross)}</td>
                  <td className="mono muted">{e.uan}</td>
                  <td className="mono muted">{e.esic_no ?? '—'}</td>
                  <td>
                    {e.active ? (
                      <span
                        className="pill"
                        style={{ borderColor: 'var(--p-line)', color: 'var(--p)', background: 'var(--p-bg)' }}
                      >
                        Active
                      </span>
                    ) : (
                      <span className="pill" style={{ borderColor: 'var(--line-2)', color: 'var(--ink-3)' }}>
                        Inactive
                      </span>
                    )}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {e.active ? (
                        <>
                          <button
                            className="btn quiet"
                            onClick={() => openEdit(e.code)}
                            disabled={pending && busyCode === e.code}
                          >
                            {pending && busyCode === e.code ? '…' : 'Edit'}
                          </button>
                          <button
                            className="btn quiet"
                            onClick={() => onDeactivate(e.code, e.name)}
                            disabled={pending && busyCode === e.code}
                            title="Deactivate this employee"
                          >
                            Deactivate
                          </button>
                        </>
                      ) : (
                        <button
                          className="btn quiet"
                          onClick={() => onReactivate(e.code, e.name)}
                          disabled={pending && busyCode === e.code}
                          title="Reactivate this employee"
                        >
                          {pending && busyCode === e.code ? '…' : 'Reactivate'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td className="muted" colSpan={10} style={{ textAlign: 'center' }}>
                    {q ? `No employees match “${q}”.` : 'No employees yet.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* onClose deliberately does NOT clear `editing`. The drawer's form is
          keyed on employee?.code ?? 'new', so nulling it here swapped the key
          mid-close and remounted the form — every uncontrolled field snapped
          back to its blank default, and the branch <select> fell to its first
          option (Pune). Since the drawer is still animating out, you watched a
          just-saved employee visibly "revert" to Pune. openAdd() clears it
          instead, which is the only place a blank form is actually wanted. */}
      <AddEmployeeDrawer
        open={drawer}
        employee={editing}
        departments={departments}
        branches={branches}
        formSeq={openSeq}
        onClose={() => setDrawer(false)}
      />
      {confirmDialog}
    </div>
  );
}
