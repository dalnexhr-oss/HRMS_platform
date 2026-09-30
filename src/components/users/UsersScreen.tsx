'use client';

// Account administration controls. Each Server Action checks the caller's role independently.
import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createUser, updateUserRole, updateUserPunchAccess, sendPasswordReset, setUserPassword, deleteUser } from '@/lib/actions/users';
import { usePrompt } from '@/components/ui/PromptDialog';
import { useNotifications } from '@/components/ui/Notifications';
import { AccessDrawer } from '@/components/users/AccessDrawer';
import { PunchAccessSelect, punchAccessHelp } from '@/components/users/PunchAccessSelect';
import { UserActions } from '@/components/users/UserActions';
import { EmployeePicker } from '@/components/employees/EmployeePicker';
import { isConfigurableRole } from '@/lib/portal-access';
import { isEmployeeAreaRole } from '@/lib/user-roles';
import type { AccessTarget } from '@/components/users/AccessDrawer';
import type { ManagedUser } from '@/lib/actions/users';
import type { EmployeeOption } from '@/lib/server-queries';
import type { AppRole } from '@/types/database';
import type { PunchAccess } from '@/types/punch';

const roleLabel: Record<AppRole, string> = {
  admin: 'Admin',
  super_admin: 'Super Admin',
  hr: 'HR',
  employee: 'Employee',
  intern: 'Intern',
};

// Highest tier first — mirrors roleTier in lib/actions/users.ts.
const roleOrder: AppRole[] = ['super_admin', 'admin', 'hr', 'employee', 'intern'];

// Mirrors roleTier in lib/actions/users.ts — the server is the real gate.
const roleTier: Record<AppRole, number> = {
  super_admin: 3,
  admin: 2,
  hr: 1,
  employee: 0,
  intern: 0,
};

function formatLastSignIn(iso: string | null): string {
  if (!iso) {
    return 'never';
  }
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function UsersScreen({
  users,
  employees,
  callerRole,
  selfId,
  loadError,
}: {
  users: ManagedUser[];
  employees: EmployeeOption[];
  callerRole: AppRole;
  // The signed-in user's own id, so self-destructive actions are disabled.
  selfId: string | null;
  loadError: string | null;
}) {
  const router = useRouter();
  const [drawer, setDrawer] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [accessFor, setAccessFor] = useState<AccessTarget | null>(null);
  const [pending, startTransition] = useTransition();
  const { prompt, promptDialog } = usePrompt();
  const { showNotification, notificationContainer } = useNotifications();

  // Only offer roles at or below the caller's own tier — the same rule the
  // server enforces, so the dropdown can't suggest a refusal.
  const assignable = roleOrder.filter((r) => roleTier[r] <= roleTier[callerRole]);

  function run(id: string, fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) {
    setBusy(id);
    startTransition(async () => {
      const res = await fn();
      setBusy(null);
      if (!res.ok) {
        showNotification(res.error ?? 'The action failed.', 'error');
      } else {
        showNotification(okMsg, 'success');
        router.refresh();
      }
    });
  }

  async function onRoleChange(u: ManagedUser, role: AppRole) {
    // The existing link is carried over rather than dropped — changing somebody
    // from Employee to Manager (or Admin to HR) must not unlink them from their
    // own attendance and payslips.
    let employeeId: string | null = u.employeeId;
    if (isEmployeeAreaRole(role) && !employeeId) {
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
      if (code === null) {
        return;
      }
      const match = employees.find((e) => e.code.toLowerCase() === code.trim().toLowerCase());
      if (!match) {
        // validate() blocks this, but keep the type narrow.
        return;
      }
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
    if (pw === null) {
      return;
    }
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
    if (typed === null) {
      return;
    }
    run(u.id, () => deleteUser(u.id), `Deleted the login for ${u.email}.`);
  }

  if (loadError) {
    return (
      <div className="content-container users-screen">
        <div className="card">
          <div className="card-body">
            <div className="error-message">{loadError}</div>
            <p className="text-muted" style={{ fontSize: 12, marginTop: 10 }}>
              User administration writes the users collection directly, which needs the database on
              the server. Nothing is shown rather than a misleading empty list.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="content-container grid users-screen">
      {promptDialog}
      {notificationContainer}
      <div className="records-toolbar users-toolbar">
        <span className="status-badge" style={{ borderColor: 'var(--border-strong)', color: 'var(--text-secondary)' }}>
          {users.length} account{users.length === 1 ? '' : 's'}
        </span>
        <button className="button primary" onClick={() => setDrawer(true)}>
          + Add user
        </button>
      </div>

      <div className="card users-table-card">
        <table className="users-table" role="table" aria-label="User accounts">
          <colgroup>
            <col className="users-column-account" />
            <col className="users-column-role" />
            <col className="users-column-employee" />
            <col className="users-column-punch" />
            <col className="users-column-signin" />
            <col className="users-column-actions" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Account</th>
              <th scope="col">Role</th>
              <th scope="col">Linked employee</th>
              <th scope="col">Punch in/out access</th>
              <th scope="col">Last sign-in</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} role="row">
                <td className="users-account" data-label="Account" role="cell">
                  <b>{u.fullName ?? '—'}</b>
                  <span className="text-monospace text-muted users-email">{u.email}</span>
                </td>
                <td data-label="Role" role="cell">
                  <select
                    className="users-select"
                    aria-label={`Role for ${u.fullName ?? u.email}`}
                    value={u.role ?? ''}
                    disabled={
                      (pending && busy === u.id) ||
                      u.id === selfId ||
                      (u.role !== null && roleTier[u.role] > roleTier[callerRole])
                    }
                    title={u.id === selfId ? 'Ask another admin to change your role' : undefined}
                    onChange={(event) => onRoleChange(u, event.target.value as AppRole)}
                  >
                    {!u.role && <option value="">no profile</option>}
                    {u.role && !assignable.includes(u.role) && (
                      <option value={u.role}>{roleLabel[u.role]}</option>
                    )}
                    {assignable.map((role) => (
                      <option key={role} value={role}>
                        {roleLabel[role]}
                      </option>
                    ))}
                  </select>
                </td>
                <td data-label="Linked employee" role="cell">
                  {u.employeeCode ? (
                    <>
                      <span>{u.employeeName}</span>
                      <span className="text-monospace text-muted users-employee-code">{u.employeeCode}</span>
                    </>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td data-label="Punch in/out access" role="cell">
                  <PunchAccessSelect
                    className="users-select"
                    aria-label={`Punch in/out access for ${u.fullName ?? u.email}`}
                    value={u.punchAccess}
                    title={punchAccessHelp[u.punchAccess]}
                    disabled={pending || !u.role || roleTier[u.role] > roleTier[callerRole]}
                    onChange={(event) => {
                      const value = event.target.value as PunchAccess;
                      run(
                        u.id,
                        () => updateUserPunchAccess(u.id, value),
                        `Punch access updated for ${u.email}.`,
                      );
                    }}
                  />
                </td>
                <td className="text-monospace text-muted" data-label="Last sign-in" role="cell">
                  {formatLastSignIn(u.lastSignInAt)}
                </td>
                <td className="users-actions-cell" data-label="Actions" role="cell">
                  <UserActions
                    name={u.fullName ?? u.email}
                    disabled={pending && busy === u.id}
                    canDelete={u.id !== selfId}
                    onAccess={
                      callerRole === 'super_admin' && isConfigurableRole(u.role)
                        ? () =>
                            setAccessFor({
                              id: u.id,
                              email: u.email,
                              fullName: u.fullName,
                              role: u.role as AppRole,
                            })
                        : undefined
                    }
                    onSetPassword={() => void onSetPassword(u)}
                    onSendReset={() =>
                      run(
                        u.id,
                        () => sendPasswordReset(u.email),
                        `Reset link generated for ${u.email}.`,
                      )
                    }
                    onDelete={() => void onDelete(u)}
                  />
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr className="users-empty">
                <td className="text-muted" colSpan={6} style={{ textAlign: 'center' }}>
                  No login accounts yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-muted" style={{ fontSize: 12 }}>
        New accounts are created with the password you set and can sign in immediately. They can
        change it themselves from <b>My account</b>, or use <b>Forgot your password?</b> on the
        sign-in page. Only an admin can create or grant the admin role.
      </p>

      <AccessDrawer
        user={accessFor}
        onClose={() => setAccessFor(null)}
        onNotification={(msg, kind) => showNotification(msg, kind)}
      />

      <AddUserDrawer
        open={drawer}
        onClose={() => setDrawer(false)}
        employees={employees}
        assignable={assignable}
        onCreated={() => {
          setDrawer(false);
          showNotification('User created.', 'success');
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
  const [punchAccess, setPunchAccess] = useState<PunchAccess>('both');
  const [state, action, pending] = useActionState<{ ok?: boolean; error?: string }, FormData>(
    async (_prev, formData) => {
      const res = await createUser(formData);
      if (res.ok) {
        setPunchAccess('both');
        onCreated();
      }
      return res;
    },
    {},
  );

  return (
    <>
      <div className={`dialog-backdrop${open ? ' is-active' : ''}`} onClick={onClose} />
      <aside className={`drawer${open ? ' is-active' : ''}`} aria-label="Add user">
        <form action={action} style={{ display: 'contents' }}>
          <div className="drawer-header">
            <h3>Add user</h3>
            <span style={{ flex: 1 }} />
            <button type="button" className="button quiet" onClick={onClose}>
              ✕
            </button>
          </div>
          <div className="drawer-body">
            <div className="form-field">
              <label>Full name</label>
              <input name="full_name" placeholder="e.g. Meera Kulkarni" required />
            </div>
            <div className="form-field">
              <label>Email</label>
              <input
                name="email"
                type="email"
                className="text-monospace"
                placeholder="name@dalnex.com"
                required
              />
            </div>
            <div className="form-field">
              <label>Temporary password</label>
              <input
                name="password"
                type="text"
                className="text-monospace"
                minLength={8}
                placeholder="min 8 characters"
                required
              />
              <span className="hint">
                Share this with them; they can change it from “My account” after signing in.
              </span>
            </div>

            <div className="section-heading">Access</div>
            <div className="form-field">
              <label>Role</label>
              <select name="role" value={role} onChange={(e) => setRole(e.target.value as AppRole)}>
                {assignable.map((r) => (
                  <option key={r} value={r}>
                    {roleLabel[r]}
                  </option>
                ))}
              </select>
            </div>
            <EmployeePicker
              label={`Linked employee${isEmployeeAreaRole(role) ? '' : ' (optional)'}`}
              name="employee_id"
              employees={employees}
              required={isEmployeeAreaRole(role)}
              disabled={pending}
              hint={
                isEmployeeAreaRole(role)
                  ? 'This login must point at an employee record, or their dashboard has no attendance, payslips or claims to show.'
                  : 'Link this login to its employee record so this person still gets their own attendance, payslips and leave.'
              }
            />

            <div className="form-field">
              <label htmlFor="new-user-punch-access">Punch in/out access</label>
              <PunchAccessSelect
                id="new-user-punch-access"
                name="punch_access"
                value={punchAccess}
                onChange={(event) => setPunchAccess(event.target.value as PunchAccess)}
                aria-describedby="new-user-punch-access-help"
                disabled={pending}
              />
              <span id="new-user-punch-access-help" className="hint">
                {punchAccessHelp[punchAccess]}
              </span>
            </div>

            {state.error && <div className="error-message">{state.error}</div>}
          </div>
          <div className="drawer-footer">
            <button type="button" className="button" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="button primary" disabled={pending}>
              {pending ? 'Creating…' : 'Create user'}
            </button>
          </div>
        </form>
      </aside>
    </>
  );
}

export { UsersScreen };
