import 'server-only';
import { getSession } from '@/lib/auth';
import { collections, usersCollection } from '@/lib/db/collections';
import { db } from '@/lib/db/mongo';
import { scoped } from '@/lib/db/repo';
import { notifyProfiles } from '@/lib/notify';
import { isStaffRole } from '@/lib/roles';
import type { EmployeeDoc, RequestDoc, RequestRouteDoc } from '@/lib/db/collections';
import type { RequestPerson, RequestRecipient } from '@/types/requests';

/** Minimal company directory for recipient selection; credentials and personal contact fields stay private. */
export async function getRequestRecipients(): Promise<RequestRecipient[]> {
  const { profile } = await getSession();
  if (!profile) {
    return [];
  }
  const database = await db();
  const users = await usersCollection();
  const accounts = await users
    .find(
      { disabled: { $ne: true } },
      { projection: { _id: 1, email: 1, full_name: 1, employee_id: 1, role: 1 } },
    )
    .toArray();
  const employeeIds = accounts.flatMap((account) =>
    account.employee_id ? [account.employee_id] : [],
  );
  const employees = await database
    .collection<EmployeeDoc>(collections.employees)
    .find(
      { _id: { $in: employeeIds }, deleted_at: null, status: { $in: ['active', 'on_notice'] } },
      { projection: { _id: 1, code: 1, full_name: 1, department_name: 1 } },
    )
    .toArray();
  const byId = new Map(employees.map((employee) => [employee._id, employee]));
  return accounts
    .flatMap((account) => {
      if (
        account._id === profile.id ||
        (profile.employee_id && account.employee_id === profile.employee_id)
      ) {
        return [];
      }
      const employee = account.employee_id ? byId.get(account.employee_id) : null;
      if (
        (account.employee_id && !employee) ||
        (!employee && !['hr', 'admin', 'super_admin'].includes(account.role))
      ) {
        return [];
      }
      return [
        {
          id: account._id,
          name: employee?.full_name || account.full_name || account.email,
          email: account.email,
          employeeId: account.employee_id,
          detail: [employee?.code, employee?.department_name, account.role.replace('_', ' ')]
            .filter(Boolean)
            .join(' · '),
        },
      ];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Resolve a chosen account again on submit; never trust a label or arbitrary email from the browser. */
async function resolveRecipient(id: string, requesterEmployeeId: string): Promise<RequestPerson> {
  if (!id) {
    throw new Error('Choose a person in the To field.');
  }
  const users = await usersCollection();
  const account = await users.findOne(
    { _id: id, disabled: { $ne: true } },
    { projection: { _id: 1, full_name: 1, email: 1, employee_id: 1, role: 1 } },
  );
  if (!account) {
    throw new Error('That recipient is unavailable. Choose an active company account.');
  }
  if (account.employee_id === requesterEmployeeId) {
    throw new Error('The applicant cannot approve or be copied on their own request.');
  }
  const database = await db();
  const employee = account.employee_id
    ? await database.collection<EmployeeDoc>(collections.employees).findOne(
        {
          _id: account.employee_id,
          deleted_at: null,
          status: { $in: ['active', 'on_notice'] },
        },
        { projection: { full_name: 1 } },
      )
    : null;
  if (
    (account.employee_id && !employee) ||
    (!employee && !['hr', 'admin', 'super_admin'].includes(account.role))
  ) {
    throw new Error('That recipient is no longer active. Choose another person.');
  }
  return {
    id: account._id,
    name: employee?.full_name || account.full_name || account.email,
    email: account.email,
  };
}

export async function prepareRequestRouting(formData: FormData, employeeId: string) {
  const approverId = String(formData.get('approver_id') ?? '').trim();
  const ccIds = [
    ...new Set(
      formData
        .getAll('cc_ids')
        .map((value) => String(value).trim())
        .filter(Boolean),
    ),
  ];
  if (ccIds.length > 20) {
    throw new Error('Choose at most 20 CC recipients.');
  }
  const [approver, ...cc] = await Promise.all([
    resolveRecipient(approverId, employeeId),
    ...ccIds.filter((id) => id !== approverId).map((id) => resolveRecipient(id, employeeId)),
  ]);
  const database = await db();
  const employee = await database.collection<EmployeeDoc>(collections.employees).findOne(
    {
      _id: employeeId,
      deleted_at: null,
      status: { $in: ['active', 'on_notice'] },
    },
    { projection: { full_name: 1, code: 1, branch_name: 1 } },
  );
  if (!employee) {
    throw new Error('Only an active employee can submit a request.');
  }
  return {
    employee_name: employee.full_name,
    employee_code: employee.code,
    employee_branch: employee.branch_name ?? '',
    approval_route: {
      initial_approver: approver,
      current_approver: approver,
      cc,
      history: [],
      revision: 0,
    } satisfies RequestRouteDoc,
  };
}

/** Commit a decision and optional handoff together; stale tabs cannot approve the next stage. */
export async function reviewRoutedRequest(
  id: string,
  decision: 'approved' | 'rejected',
  remark: string | null,
  nextApproverId?: string,
  revision?: number,
): Promise<{ kind: 'legacy' } | { kind: 'forwarded' | 'final'; request: RequestDoc }> {
  const { profile, email } = await getSession();
  if (!profile) {
    throw new Error('You are not signed in.');
  }
  if (decision !== 'approved' && decision !== 'rejected') {
    throw new Error('Choose Approve or Reject.');
  }
  if (decision === 'rejected' && nextApproverId) {
    throw new Error('A rejected request cannot be forwarded for approval.');
  }
  const requests = await scoped<RequestDoc>(collections.requests);
  const request = await requests.findOne({ _id: id });
  if (!request) {
    throw new Error('This request is unavailable or you do not have permission to view it.');
  }
  if (request.employee_id === profile.employee_id) {
    throw new Error('You cannot review your own request.');
  }
  if (request.status !== 'pending') {
    throw new Error('This request has already been reviewed or cancelled.');
  }
  const route = request.approval_route;
  if (!route) {
    if (nextApproverId) {
      if (!isStaffRole(profile.role)) {
        throw new Error('Only admin or HR can review an unassigned request.');
      }
      const next = await resolveRecipient(nextApproverId, request.employee_id);
      if (next.id === profile.id) {
        throw new Error('Choose a different person for further approval.');
      }
      const approver = {
        id: profile.id,
        name: profile.full_name ?? email ?? 'Approver',
        email: email ?? '',
      };
      const database = await db();
      const employee = await database
        .collection<EmployeeDoc>(collections.employees)
        .findOne(
          { _id: request.employee_id },
          { projection: { full_name: 1, code: 1, branch_name: 1 } },
        );
      const updated = await database.collection<RequestDoc>(collections.requests).findOneAndUpdate(
        { _id: id, status: 'pending', approval_route: null },
        {
          $set: {
            employee_name: employee?.full_name ?? '',
            employee_code: employee?.code ?? '',
            employee_branch: employee?.branch_name ?? '',
            approval_route: {
              initial_approver: approver,
              current_approver: next,
              cc: [],
              revision: 1,
              history: [{ approver, decision, decided_at: new Date(), remark, forwarded_to: next }],
            },
          },
        },
        { returnDocument: 'after' },
      );
      if (!updated) {
        throw new Error('This request changed or was cancelled. Refresh before reviewing it.');
      }
      return { kind: 'forwarded', request: updated };
    }
    return { kind: 'legacy' };
  }
  if (route.current_approver.id !== profile.id) {
    throw new Error(
      'Only the person currently assigned this request can approve, reject, or forward it.',
    );
  }
  if (revision !== route.revision) {
    throw new Error('This request changed. Refresh before reviewing it.');
  }
  if (route.history.length >= 100) {
    throw new Error('This request has reached its approval history limit. Contact HR.');
  }
  if (nextApproverId && route.history.length >= 99) {
    throw new Error('No more handoffs are available. Approve or reject this request to finish it.');
  }
  const next = nextApproverId ? await resolveRecipient(nextApproverId, request.employee_id) : null;
  if (next?.id === profile.id) {
    throw new Error('Choose a different person for further approval.');
  }
  const now = new Date();
  const database = await db();
  // The scoped read above authorizes visibility, and the assignment/revision predicates authorize
  // this exact transition. No general cross-employee write access is granted to the reviewer.
  const updated = await database.collection<RequestDoc>(collections.requests).findOneAndUpdate(
    {
      _id: id,
      employee_id: request.employee_id,
      status: 'pending',
      'approval_route.current_approver.id': profile.id,
      'approval_route.revision': revision,
    },
    {
      $set: {
        status: next ? 'pending' : decision,
        'approval_route.current_approver': next ?? route.current_approver,
        ...(next ? {} : { reviewed_by: profile.id, reviewed_at: now, review_remark: remark }),
      },
      $inc: { 'approval_route.revision': 1 },
      $push: {
        'approval_route.history': {
          approver: route.current_approver,
          decision,
          decided_at: now,
          remark,
          forwarded_to: next,
        },
      },
    },
    { returnDocument: 'after' },
  );
  if (!updated) {
    throw new Error('This request changed or was cancelled. Refresh before reviewing it.');
  }
  return { kind: next ? 'forwarded' : 'final', request: updated };
}

/** Notify the selected recipient, CC, and earlier reviewers with a link all roles can open. */
export async function notifyRequestParticipants(
  requestId: string,
  route: RequestRouteDoc,
  title: string,
  body: string,
  exceptId?: string,
): Promise<void> {
  const ids = [
    route.initial_approver.id,
    route.current_approver.id,
    ...route.cc.map((p) => p.id),
    ...route.history.map((step) => step.approver.id),
  ];
  await notifyProfiles(
    ids.filter((id) => id !== exceptId),
    {
      kind: 'approval',
      title,
      body,
      link: `/requests/${requestId}`,
    },
  );
}
