'use server';

// Professional tax slabs. Payroll reads these when it computes a payslip; a state with no slab
// is charged nothing.
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/db/server-client';
import { requireRoles, wroteNothing } from '@/lib/actions/guards';
import { toMoney } from '@/lib/db/decimal-conversions';
import { States } from '@/lib/indian-states';
import type { AppRole } from '@/types/database';

interface ActionResult {
  ok: boolean;
  error?: string;
}

const slabRoles: readonly AppRole[] = ['super_admin', 'admin', 'hr'];
const genders: readonly string[] = ['Male', 'Female', 'Other'];

/** Parse '1,234.50' / '₹1,234.50' -> 1234.5; null when blank; NaN when unparseable. */
function rupees(value: FormDataEntryValue | null): number | null {
  const raw = String(value ?? '')
    .trim()
    .replace(/[,\s₹]/g, '');
  if (!raw) {
    return null;
  }
  const amount = Number(raw);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : Number.NaN;
}

/** Add a slab, or update the one named by `id`. */
async function savePtSlab(formData: FormData): Promise<ActionResult> {
  const id = String(formData.get('id') ?? '').trim();
  const state = String(formData.get('state') ?? '').trim();
  const genderRaw = String(formData.get('gender') ?? '').trim();
  const monthRaw = String(formData.get('month') ?? '').trim();
  const minGross = rupees(formData.get('min_gross')) ?? 0;
  const maxGross = rupees(formData.get('max_gross'));
  const amount = rupees(formData.get('amount'));

  if (!(States as readonly string[]).includes(state)) {
    return { ok: false, error: 'Choose a state.' };
  }
  if (genderRaw && !genders.includes(genderRaw)) {
    return { ok: false, error: 'Choose a valid gender, or leave it as Everyone.' };
  }
  const month = monthRaw ? Number(monthRaw) : null;
  if (month !== null && (!Number.isInteger(month) || month < 1 || month > 12)) {
    return { ok: false, error: 'Choose a valid month, or leave it as Every month.' };
  }
  if (Number.isNaN(minGross) || minGross < 0) {
    return { ok: false, error: 'Enter the gross salary this slab starts at.' };
  }
  if (maxGross !== null && (Number.isNaN(maxGross) || maxGross < minGross)) {
    return { ok: false, error: 'The upper gross limit cannot be below the starting gross.' };
  }
  if (amount === null || Number.isNaN(amount) || amount < 0) {
    return { ok: false, error: 'Enter the monthly tax amount for this slab.' };
  }

  const gate = await requireRoles(slabRoles, 'Changing professional tax slabs');
  if (!gate.ok) {
    return gate;
  }

  const slab = {
    state,
    gender: genderRaw || null,
    min_gross: toMoney(minGross),
    max_gross: maxGross === null ? null : toMoney(maxGross),
    amount: toMoney(amount),
    month,
  };
  const dbc = await createClient();
  const { data, error } = id
    ? await dbc.from('pt_slabs').update(slab).eq('id', id).select('id')
    : await dbc.from('pt_slabs').insert(slab).select('id');
  if (error) {
    return { ok: false, error: error.message };
  }
  if (wroteNothing(data)) {
    return {
      ok: false,
      error: id
        ? 'The slab was not updated — it may have been deleted.'
        : 'The slab was not added — your account may not have permission.',
    };
  }

  revalidatePath('/professional-tax');
  return { ok: true };
}

/** Delete a slab by id. */
async function deletePtSlab(id: string): Promise<ActionResult> {
  const gate = await requireRoles(slabRoles, 'Deleting a professional tax slab');
  if (!gate.ok) {
    return gate;
  }

  const dbc = await createClient();
  const { data, error } = await dbc.from('pt_slabs').delete().eq('id', id).select('id');
  if (error) {
    return { ok: false, error: error.message };
  }
  if (wroteNothing(data)) {
    return { ok: false, error: 'The slab was not removed — it may already be gone.' };
  }

  revalidatePath('/professional-tax');
  return { ok: true };
}

export { savePtSlab, deletePtSlab };
export type { ActionResult };
