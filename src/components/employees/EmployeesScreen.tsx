'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { inr } from '@/lib/format';
import { AddEmployeeDrawer } from './AddEmployeeDrawer';
import { fetchEmployeeForEdit, deactivateEmployee } from '@/lib/actions/employees';
import type { EmployeeListRow, EmployeeEditRow } from '@/lib/queries';

export function EmployeesScreen({ rows }: { rows: EmployeeListRow[] }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [drawer, setDrawer] = useState(false);
  const [editing, setEditing] = useState<EmployeeEditRow | null>(null);
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter(
      (e) =>
        e.name.toLowerCase().includes(term) ||
        e.code.toLowerCase().includes(term) ||
        (e.uan ?? '').toLowerCase().includes(term),
    );
  }, [q, rows]);

  function openAdd() {
    setEditing(null);
    setDrawer(true);
  }

  function openEdit(code: string) {
    setError(null);
    setBusyCode(code);
    startTransition(async () => {
      const data = await fetchEmployeeForEdit(code);
      setBusyCode(null);
      if (!data) {
        setError(`Could not load ${code} for editing.`);
        return;
      }
      setEditing(data);
      setDrawer(true);
    });
  }

  function onDeactivate(code: string, name: string) {
    if (!window.confirm(`Deactivate ${name} (${code})? They will no longer appear in the active roster.`)) {
      return;
    }
    setError(null);
    setBusyCode(code);
    startTransition(async () => {
      const res = await deactivateEmployee(code);
      setBusyCode(null);
      if (!res.ok) setError(res.error ?? 'Could not deactivate the employee.');
      else router.refresh();
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
          {rows.length} active
        </span>
        <span style={{ flex: 1 }} />
        <button className="btn primary" onClick={openAdd}>
          + Add employee
        </button>
      </div>

      {error && (
        <div className="login-error" style={{ margin: '0 0 12px' }}>
          {error}
        </div>
      )}

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
                    <span
                      className="pill"
                      style={{ borderColor: 'var(--p-line)', color: 'var(--p)', background: 'var(--p-bg)' }}
                    >
                      Active
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
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

      <AddEmployeeDrawer
        open={drawer}
        employee={editing}
        onClose={() => {
          setDrawer(false);
          setEditing(null);
        }}
      />
    </div>
  );
}
