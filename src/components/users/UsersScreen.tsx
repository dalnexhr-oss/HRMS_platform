'use client';

// Admin/HR user administration: create login accounts, change roles, reset or
// set passwords. Every action is gated server-side — this screen only decides
// what to *offer*, never what is permitted.
import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  createUser,
  updateUserRole,
  sendPasswordReset,
  setUserPassword,
  deleteUser,
  type ManagedUser,
} from '@/lib/actions/users';
import { usePrompt } from '@/components/ui/PromptDialog';
import { useToast } from '@/components/ui/Toast';
import type { EmployeeOption } from '@/lib/queries';
import { AccessDrawer, type AccessTarget } from '@/components/users/AccessDrawer';
import { isConfigurableRole } from '@/lib/access';
import type { AppRole } from '@/types/database';

const ROLE_LABEL: Record<AppRole, string> = {
  admin: 'Admin',
  super_admin: 'Super Admin',
  hr: 'HR',
  manager: 'Manager',
  employee: 'Employee',
};

// Highest tier first — mirrors ROLE_TIER in lib/actions/users.ts.
const ROLE_ORDER: AppRole[] = ['super_admin', 'admin', 'hr', 'manager', 'employee'];

/** Mirrors ROLE_TIER in lib/actions/users.ts — the server is the real gate. */
const ROLE_TIER: Record<AppRole, number> = {
  super_admin: 3,
  admin: 2,
  hr: 1,
  manager: 0,
  employee: 0,
};

function rolePillStyle(role: AppRole | null): React.CSSProperties {
  if (role === 'super_admin') {
    return { borderColor: 'var(--brand)', color: '#fff', background: 'var(--brand)' };
  }
  if (role === 'admin') return { borderColor: 'var(--brand)', color: 'var(--brand)' };
  if (role === 'hr' || role === 'manager') return { borderColor: 'var(--brass)', color: 'var(--brass)' };
  if (role === 'employee') return { borderColor: 'var(--p-line)', color: 'var(--p)', background: 'var(--p-bg)' };
  return { borderColor: 'var(--line-2)', color: 'var(--ink-3)' };
}

function stamp(iso: string | null): string {
  if (!iso) return 'never';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function UsersScreen({
  users,
  employees,
  callerRole,
  selfId,
  loadError,
}: {
  users: ManagedUser[];
  employees: EmployeeOption[];
  callerRole: AppRole;
  /** The signed-in user's own id, so self-destructive actions are disabled. */
  selfId: string | null;
  loadError: string | null;
}) {
  const router = useRouter();
  const [drawer, setDrawer] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [accessFor, setAccessFor] = useState<AccessTarget | null>(null);
  const [pending, startTransition] = useTransition();
  const { prompt, promptDialog } = usePrompt();
  const { toast, toastNode } = useToast();

  // Only offer roles at or below the caller's own tier — the same rule the
  // server enforces, so the dropdown can't suggest a refusal.
  const assignable = ROLE_ORDER.filter((r) => ROLE_TIER[r] <= ROLE_TIER[callerRole]);

  function run(id: string, fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) {
    setBusy(id);
    startTransition(async () => {
      const res = await fn();
      setBusy(null);
      if (!res.ok) toast(res.error ?? 'The action failed.', 'error');
      else {
        toast(okMsg, 'success');
        router.refresh();
      }
    });
  }

  async function onRoleChange(u: ManagedUser, role: AppRole) {
    // The existing link is carried over rather than dropped — changing somebody
    // from Employee to Manager (or Admin to HR) must not unlink them from their
    // own attendance and payslips.
    let employeeId: string | null = u.employeeId;
    if (role === 'employee' && !employeeId) {
      const code = await prompt({
        title: 'Link an employee',
        message: `Which employee is ${u.email}? Enter their code (e.g. DN001).`,
        placeholder: 'DN001',
        confirmLabel: 'Link',
        validate: (v) =>
          employees.some((e) => e.code.toLowerCase() === v.trim().toLowerCase())
            ? null
            : `No active employee with code “${v.trim()}”.`,
      });
      if (code === null) return;
      const match = employees.find((e) => e.code.toLowerCase() === code.trim().toLowerCase());
      if (!match) return; // validate() blocks this, but keep the type narrow.
      employeeId = match.id;
    }
    run(u.id, () => updateUserRole(u.id, role, employeeId), `Role updated for ${u.email}.`);
  }

  async function onSetPassword(u: ManagedUser) {
    const pw = await prompt({
      title: 'Set password',
      message: `Set a new password for ${u.email} (min 8 characters):`,
      inputType: 'password',
      confirmLabel: 'Set password',
      validate: (v) => (v.length >= 8 ? null : 'Password must be at least 8 characters.'),
    });
    if (pw === null) return;
    run(u.id, () => setUserPassword(u.id, pw), `Password updated for ${u.email}.`);
  }

  async function onDelete(u: ManagedUser) {
    // Typing the email is deliberate friction: this removes a person's access,
    // and the row's Delete button sits next to Set password / Send reset.
    const typed = await prompt({
      title: 'Delete login',
      message:
        `Delete the login for ${u.email}?\n\n` +
        'Their employee record, attendance, payslips and claims are KEPT — only the ' +
        'ability to sign in is removed.\n\n' +
        'Type the email to confirm:',
      placeholder: u.email,
      confirmLabel: 'Delete login',
      danger: true,
      matchToken: u.email,
    });
    if (typed === null) return;
    run(u.id, () => deleteUser(u.id), `Deleted the login for ${u.email}.`);
  }

  if (loadError) {
    return (
      <div className="wrap">
        <div className="card">
          <div className="bd">
            <div className="login-error">{loadError}</div>
            <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
              User administration talks to Supabase’s admin API, which needs the secret key on the
              server. Nothing is shown rather than a misleading empty list.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="wrap grid">
      {promptDialog}
      {toastNode}
      <div className="emp-top">
        <span className="pill" style={{ borderColor: 'var(--line-2)', color: 'var(--ink-2)' }}>
          {users.length} account{users.length === 1 ? '' : 's'}
        </span>
        <span style={{ flex: 1 }} />
        <button className="btn primary" onClick={() => setDrawer(true)}>
          + Add user
        </button>
      </div>

      <div className="card">
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>Name</th>
                <th>Role</th>
                <th>Linked employee</th>
                <th>Last sign-in</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="mono">{u.email}</td>
                  <td>
                    <b>{u.fullName ?? '—'}</b>
                  </td>
                  <td>
                    <span className="pill" style={rolePillStyle(u.role)}>
                      {u.role ? ROLE_LABEL[u.role] : 'no profile'}
                    </span>
                  </td>
                  <td>
                    {u.employeeCode ? (
                      <>
                        {u.employeeName}{' '}
                        <span className="mono muted" style={{ fontSize: 11 }}>
                          {u.employeeCode}
                        </span>
                      </>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="mono muted">{stamp(u.lastSignInAt)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      {/* Your own role is the one row you cannot edit — mirrors
                          the server guard, so the control never offers a change
                          that would come back as a refusal. Everyone else's row
                          stays editable. */}
                      <select
                        value={u.role ?? ''}
                        disabled={(pending && busy === u.id) || u.id === selfId}
                        title={
                          u.id === selfId
                            ? 'You cannot change your own role — ask another admin to do it'
                            : undefined
                        }
                        onChange={(e) => onRoleChange(u, e.target.value as AppRole)}
                        style={{
                          padding: '5px 8px',
                          border: '1px solid var(--line-2)',
                          borderRadius: 8,
                          font: 'inherit',
                          fontSize: 13,
                          background: '#fff',
                        }}
                      >
                        {!u.role && <option value="">no profile</option>}
                        {assignable.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABEL[r]}
                          </option>
                        ))}
                      </select>
                      {/* Tab access is a super-admin power, and only an admin or
                          HR account has anything to configure — every other role
                          reaches the portal through its own static gate. Hidden
                          rather than disabled: a control you can never use is
                          noise. setUserTabAccess re-checks both conditions. */}
                      {callerRole === 'super_admin' && isConfigurableRole(u.role) && (
                        <button
                          className="btn quiet"
                          disabled={pending && busy === u.id}
                          onClick={() =>
                            setAccessFor({
                              id: u.id,
                              email: u.email,
                              fullName: u.fullName ?? null,
                              role: u.role as AppRole,
                            })
                          }
                          title="Choose which tabs this account can open"
                        >
                          Access
                        </button>
                      )}
                      <button
                        className="btn quiet"
                        disabled={pending && busy === u.id}
                        onClick={() => onSetPassword(u)}
                      >
                        Set password
                      </button>
                      <button
                        className="btn quiet"
                        disabled={pending && busy === u.id}
                        onClick={() =>
                          run(u.id, () => sendPasswordReset(u.email), `Reset link generated for ${u.email}.`)
                        }
                        title="Generate a password-recovery link (emailed if SMTP is configured)"
                      >
                        Send reset
                      </button>
                      {/* Delete is tucked behind an overflow menu — it removes a
                          person's access and shouldn't sit a mis-click away. */}
                      <div style={{ position: 'relative' }}>
                        <button
                          className="btn quiet"
                          disabled={pending && busy === u.id}
                          onClick={() => setMenuFor(menuFor === u.id ? null : u.id)}
                          title="More actions"
                          aria-label="More actions"
                          aria-haspopup="menu"
                          aria-expanded={menuFor === u.id}
                        >
                          ⋯
                        </button>
                        {menuFor === u.id && (
                          <div
                            role="menu"
                            style={{
                              position: 'absolute',
                              right: 0,
                              top: '100%',
                              marginTop: 4,
                              zIndex: 10,
                              background: '#fff',
                              border: '1px solid var(--line-2)',
                              borderRadius: 8,
                              boxShadow: '0 6px 18px rgba(0,0,0,0.14)',
                              padding: 6,
                              minWidth: 170,
                            }}
                          >
                            <button
                              role="menuitem"
                              className="btn quiet"
                              disabled={(pending && busy === u.id) || u.id === selfId}
                              onClick={() => {
                                setMenuFor(null);
                                onDelete(u);
                              }}
                              title={
                                u.id === selfId
                                  ? 'You cannot delete your own account'
                                  : 'Remove this login (the employee record is kept)'
                              }
                              style={{
                                width: '100%',
                                textAlign: 'left',
                                color: u.id === selfId ? undefined : 'var(--ab)',
                              }}
                            >
                              Delete login…
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td className="muted" colSpan={6} style={{ textAlign: 'center' }}>
                    No login accounts yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="muted" style={{ fontSize: 12 }}>
        New accounts are created with the password you set and can sign in immediately. They can
        change it themselves from <b>My account</b>, or use <b>Forgot your password?</b> on the sign-in
        page. Only an admin can create or grant the admin role.
      </p>

      <AccessDrawer
        user={accessFor}
        onClose={() => setAccessFor(null)}
        onToast={(msg, kind) => toast(msg, kind)}
      />

      <AddUserDrawer
        open={drawer}
        onClose={() => setDrawer(false)}
        employees={employees}
        assignable={assignable}
        onCreated={() => {
          setDrawer(false);
          toast('User created.', 'success');
          router.refresh();
        }}
      />
    </div>
  );
}

function AddUserDrawer({
  open,
  onClose,
  employees,
  assignable,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  employees: EmployeeOption[];
  assignable: AppRole[];
  onCreated: () => void;
}) {
  const [role, setRole] = useState<AppRole>('employee');
  const [state, action, pending] = useActionState<{ ok?: boolean; error?: string }, FormData>(
    async (_prev, formData) => {
      const res = await createUser(formData);
      if (res.ok) onCreated();
      return res;
    },
    {},
  );

  return (
    <>
      <div className={`overlay${open ? ' on' : ''}`} onClick={onClose} />
      <aside className={`drawer${open ? ' on' : ''}`} aria-label="Add user">
        <form action={action} style={{ display: 'contents' }}>
          <div className="dhd">
            <h3>Add user</h3>
            <span style={{ flex: 1 }} />
            <button type="button" className="btn quiet" onClick={onClose}>
              ✕
            </button>
          </div>
          <div className="dbd">
            <div className="f">
              <label>Full name</label>
              <input name="full_name" placeholder="e.g. Meera Kulkarni" required />
            </div>
            <div className="f">
              <label>Email</label>
              <input name="email" type="email" className="mono" placeholder="name@dalnex.com" required />
            </div>
            <div className="f">
              <label>Temporary password</label>
              <input
                name="password"
                type="text"
                className="mono"
                minLength={8}
                placeholder="min 8 characters"
                required
              />
              <span className="hint">
                Share this with them; they can change it from “My account” after signing in.
              </span>
            </div>

            <div className="fold">Access</div>
            <div className="f">
              <label>Role</label>
              <select name="role" value={role} onChange={(e) => setRole(e.target.value as AppRole)}>
                {assignable.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
            </div>

            {/* Offered for EVERY role, not just 'employee'. An admin, HR,
                manager or  is normally on the payroll too, and this link is
                what gives them their own attendance, payslips and leave. Only an
                employee login is required to have one. */}
            <div className="f">
              <label>Linked employee{role === 'employee' ? '' : ' (optional)'}</label>
              <select name="employee_id" required={role === 'employee'} defaultValue="">
                <option value="">
                  {role === 'employee' ? 'Choose an employee…' : 'Not linked'}
                </option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.code} · {e.name}
                  </option>
                ))}
              </select>
              <span className="hint">
                {role === 'employee'
                  ? 'An employee login must point at an employee record, or their dashboard has no attendance, payslips or claims to show.'
                  : 'Link this login to its employee record so this person still gets their own attendance, payslips and leave.'}
              </span>
            </div>

            {state.error && <div className="login-error">{state.error}</div>}
          </div>
          <div className="dft">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={pending}>
              {pending ? 'Creating…' : 'Create user'}
            </button>
          </div>
        </form>
      </aside>
    </>
  );
}
