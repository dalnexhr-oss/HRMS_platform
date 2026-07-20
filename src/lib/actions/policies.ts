'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth';
import { requireDb, requireStaff, wroteNothing } from '@/lib/actions/_guard';

/** Postgres unique_violation. */
const UNIQUE_VIOLATION = '23505';

/** Employee acknowledges (marks as read) a company policy. */
export async function acknowledgePolicy(policyId: string) {
  const db = requireDb('Marking a policy as read');
  if (!db.ok) return db;

  const { profile } = await getSession();
  if (!profile?.employee_id) return { ok: false, error: 'No employee linked to this account.' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('policy_acknowledgements')
    .insert({ policy_id: policyId, employee_id: profile.employee_id });

  // A duplicate ack (already read) is a unique-violation — benign. Detect it by
  // SQL error CODE, not by substring-matching the English word 'duplicate',
  // which breaks on any wording/locale change.
  if (error && error.code !== UNIQUE_VIOLATION) return { ok: false, error: error.message };
  revalidatePath('/me');
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
  revalidatePath('/policies');
  revalidatePath('/me');
  return { ok: true };
}
