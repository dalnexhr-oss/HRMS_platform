'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth';
import { requireDb, requireStaff, wroteNothing } from '@/lib/actions/_guard';
import { notifyEveryone } from '@/lib/notify';

/** Postgres unique_violation. */
const UNIQUE_VIOLATION = '23505';

/** Employee acknowledges (marks as read) a company policy. */
export async function acknowledgePolicy(policyId: string) {
  const db = requireDb('Marking a policy as read');
  if (!db.ok) return db;

  const { profile } = await getSession();
  if (!profile?.employee_id) {
    // Not a transient failure: the RLS insert policy pins employee_id to
    // current_employee_id(), so an account with no linked employee record has no
    // way to file a receipt at all. Say so rather than failing vaguely.
    return {
      ok: false,
      error: 'Your login is not linked to an employee record, so the receipt could not be filed. Ask HR to link it.',
    };
  }

  const supabase = await createClient();
  // .select('id') is what makes a silent no-op detectable — without it a write
  // that inserted nothing is indistinguishable from one that worked. Reading the
  // row back is permitted: acks_portal_read allows employee_id = current_employee_id().
  const { data, error } = await supabase
    .from('policy_acknowledgements')
    .insert({ policy_id: policyId, employee_id: profile.employee_id })
    .select('id');

  if (error) {
    // A duplicate ack (already read) is a unique-violation — benign. Detect it by
    // SQL error CODE, not by substring-matching the English word 'duplicate',
    // which breaks on any wording/locale change.
    if (error.code === UNIQUE_VIOLATION) {
      revalidatePath('/me');
      revalidatePath('/policies');
      return { ok: true };
    }
    if (error.code === '42P01' || error.code === 'PGRST205') {
      return { ok: false, error: 'Company policies are not set up on the database yet — apply migration 0004.' };
    }
    if (error.code === '42501') {
      return {
        ok: false,
        error: 'The database refused the receipt. Your login may not be linked to the right employee record.',
      };
    }
    return { ok: false, error: error.message };
  }
  if (wroteNothing(data)) {
    return { ok: false, error: 'The policy was not marked as read — nothing was saved. Reload and try again.' };
  }

  revalidatePath('/me');
  revalidatePath('/policies'); // HR's read counts
  return { ok: true };
}

/** Staff creates a company policy (published immediately unless left as draft). */
export async function createPolicy(formData: FormData) {
  const gate = await requireStaff('Creating a policy');
  if (!gate.ok) return gate;

  const title = String(formData.get('title') ?? '').trim();
  const body = String(formData.get('body') ?? '').trim();
  if (!title) return { ok: false, error: 'Please enter a title.' };
  if (!body) return { ok: false, error: 'Please enter the policy body.' };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('policies')
    .insert({
      title,
      category: (formData.get('category') as string) || null,
      body,
      version: Number(formData.get('version') ?? 1) || 1,
      effective_date: (formData.get('effective_date') as string) || null,
      published: formData.get('published') === 'on',
    })
    .select('id');
  if (error) return { ok: false, error: error.message };
  if (wroteNothing(data)) {
    return { ok: false, error: 'The policy was not created — your account may not have permission.' };
  }

  // A published policy must be read and acknowledged, so it notifies everyone.
  if (formData.get('published') === 'on') {
    await notifyEveryone(
      {
        kind: 'policy',
        title: `New policy to read: ${title}`,
        body: 'Please open it on your dashboard and mark it as read.',
        link: '/me#policies',
      },
      gate.profileId,
    );
  }

  revalidatePath('/policies');
  revalidatePath('/me');
  return { ok: true };
}

/** Staff toggles a policy's published state. */
export async function setPolicyPublished(policyId: string, published: boolean) {
  const gate = await requireStaff('Publishing a policy');
  if (!gate.ok) return gate;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('policies')
    .update({ published })
    .eq('id', policyId)
    .select('id');
  if (error) return { ok: false, error: error.message };
  if (wroteNothing(data)) {
    return {
      ok: false,
      error: 'The policy was not updated — it may no longer exist, or your role lacks permission.',
    };
  }

  // Publishing an existing draft is the moment it becomes readable, so it
  // notifies then too — un-publishing deliberately does not.
  if (published) {
    const { data: policy } = await supabase
      .from('policies')
      .select('title')
      .eq('id', policyId)
      .maybeSingle<{ title: string }>();
    await notifyEveryone(
      {
        kind: 'policy',
        title: `New policy to read: ${policy?.title ?? 'Company policy'}`,
        body: 'Please open it on your dashboard and mark it as read.',
        link: '/me#policies',
      },
      gate.profileId,
    );
  }

  revalidatePath('/policies');
  revalidatePath('/me');
  return { ok: true };
}

/** Edit an existing policy's content. Staff-only. Leaves published state alone. */
export async function updatePolicy(id: string, formData: FormData) {
  const gate = await requireStaff('Editing a policy');
  if (!gate.ok) return gate;

  const title = String(formData.get('title') ?? '').trim();
  const body = String(formData.get('body') ?? '').trim();
  if (!title) return { ok: false, error: 'Please enter a title.' };
  if (!body) return { ok: false, error: 'Please enter the policy body.' };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('policies')
    .update({
      title,
      category: (formData.get('category') as string) || null,
      body,
      version: Number(formData.get('version') ?? 1) || 1,
      effective_date: (formData.get('effective_date') as string) || null,
    })
    .eq('id', id)
    .select('id');
  if (error) return { ok: false, error: error.message };
  if (wroteNothing(data)) {
    return { ok: false, error: 'The policy was not updated — it may be gone, or your role lacks permission.' };
  }

  revalidatePath('/policies');
  revalidatePath('/me');
  return { ok: true };
}

/** Delete a policy. Its acknowledgements cascade away (FK on delete cascade). */
export async function deletePolicy(id: string) {
  const gate = await requireStaff('Deleting a policy');
  if (!gate.ok) return gate;

  const supabase = await createClient();
  const { data, error } = await supabase.from('policies').delete().eq('id', id).select('id');
  if (error) return { ok: false, error: error.message };
  if (wroteNothing(data)) {
    return { ok: false, error: 'The policy was not removed — it may already be gone, or your role lacks permission.' };
  }

  revalidatePath('/policies');
  revalidatePath('/me');
  return { ok: true };
}
