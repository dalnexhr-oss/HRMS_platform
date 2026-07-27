'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth';
import { getItemAssignments, type ItemAssignmentRow } from '@/lib/queries';
import { notifyEmployee } from '@/lib/notify';
import { requireRoles, wroteNothing } from './_guard';
import type { AppRole } from '@/types/database';

// Item Management is admin/HR only — same gate as assets and user admin.
const ITEM_ADMIN_ROLES: AppRole[] = ['admin', 'hr'];

/** Pull the item columns from the form; blank strings become null. */
function itemFields(formData: FormData) {
  const text = (k: string) => {
    const v = String(formData.get(k) ?? '').trim();
    return v || null;
  };
  const totalRaw = String(formData.get('total_quantity') ?? '').trim();
  const total = totalRaw ? Math.max(0, Math.floor(Number(totalRaw))) : 0;
  return {
    item_code: text('item_code'),
    item_name: String(formData.get('item_name') ?? '').trim(),
    category: text('category'),
    brand: text('brand'),
    size_spec: text('size_spec'),
    total_quantity: Number.isFinite(total) ? total : 0,
    unit: text('unit'),
    returnable: String(formData.get('returnable') ?? '') === 'yes',
    status: String(formData.get('status') ?? 'In Stock').trim() || 'In Stock',
    remarks: text('remarks'),
  };
}

export async function createItem(formData: FormData) {
  const gate = await requireRoles(ITEM_ADMIN_ROLES, 'Adding an item');
  if (!gate.ok) return gate;

  const fields = itemFields(formData);
  if (!fields.item_name) return { ok: false, error: 'Item name is required.' };

  const supabase = await createClient();
  const { data, error } = await supabase.from('items').insert(fields).select('id');
  if (error) return { ok: false, error: error.message };
  if (wroteNothing(data)) {
    return { ok: false, error: 'The item was not added — your account may not have permission.' };
  }
  revalidatePath('/items');
  return { ok: true };
}

export async function updateItem(formData: FormData) {
  const gate = await requireRoles(ITEM_ADMIN_ROLES, 'Updating an item');
  if (!gate.ok) return gate;

  const id = String(formData.get('id') ?? '').trim();
  if (!id) return { ok: false, error: 'Which item to update is missing.' };

  const fields = itemFields(formData);
  if (!fields.item_name) return { ok: false, error: 'Item name is required.' };

  const supabase = await createClient();
  const { data, error } = await supabase.from('items').update(fields).eq('id', id).select('id');
  if (error) return { ok: false, error: error.message };
  if (wroteNothing(data)) {
    return {
      ok: false,
      error: 'The item was not updated — it may no longer exist, or your role lacks permission.',
    };
  }
  revalidatePath('/items');
  return { ok: true };
}

export async function deleteItem(id: string) {
  const gate = await requireRoles(ITEM_ADMIN_ROLES, 'Deleting an item');
  if (!gate.ok) return gate;

  const supabase = await createClient();
  const { data, error } = await supabase.from('items').delete().eq('id', id).select('id');
  if (error) return { ok: false, error: error.message };
  if (wroteNothing(data)) {
    return {
      ok: false,
      error: 'The item was not deleted — it may no longer exist, or your role lacks permission.',
    };
  }
  revalidatePath('/items');
  return { ok: true };
}

export async function assignItem(formData: FormData) {
  const gate = await requireRoles(ITEM_ADMIN_ROLES, 'Assigning an item');
  if (!gate.ok) return gate;

  const itemId = String(formData.get('item_id') ?? '').trim();
  const employeeId = String(formData.get('employee_id') ?? '').trim();
  const quantity = Math.floor(Number(String(formData.get('quantity') ?? '').trim()));
  const assignedDate = String(formData.get('assigned_date') ?? '').trim() || null;
  const remarks = String(formData.get('remarks') ?? '').trim() || null;

  if (!itemId) return { ok: false, error: 'Which item to assign is missing.' };
  if (!employeeId) return { ok: false, error: 'Choose an employee to assign to.' };
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { ok: false, error: 'Enter a quantity greater than zero.' };
  }

  const supabase = await createClient();

  // How much is still available? Read the derived remaining from v_items.
  const { data: item, error: itemErr } = await supabase
    .from('v_items')
    .select('item_name, quantity_remaining')
    .eq('id', itemId)
    .maybeSingle<{ item_name: string; quantity_remaining: number }>();
  if (itemErr) return { ok: false, error: itemErr.message };
  if (!item) return { ok: false, error: 'That item no longer exists.' };
  if (quantity > item.quantity_remaining) {
    return {
      ok: false,
      error: `Only ${item.quantity_remaining} left — cannot assign ${quantity}.`,
    };
  }

  // Snapshot the employee's name + code so the log survives if they are removed.
  const { data: emp, error: empErr } = await supabase
    .from('employees')
    .select('code, full_name')
    .eq('id', employeeId)
    .maybeSingle<{ code: string; full_name: string }>();
  if (empErr) return { ok: false, error: empErr.message };
  if (!emp) return { ok: false, error: 'That employee no longer exists.' };

  const { profile } = await getSession();

  const row: Record<string, unknown> = {
    item_id: itemId,
    employee_id: employeeId,
    person_name: emp.full_name,
    employee_code: emp.code,
    quantity,
    assigned_by: profile?.full_name ?? null,
    remarks,
  };
  // Omit assigned_date when blank so the column default (current_date) applies.
  if (assignedDate) row.assigned_date = assignedDate;

  const { data, error } = await supabase.from('item_assignments').insert(row).select('id');
  if (error) return { ok: false, error: error.message };
  if (wroteNothing(data)) {
    return { ok: false, error: 'The assignment was not saved — your role may lack permission.' };
  }

  await notifyEmployee(employeeId, {
    kind: 'item',
    title: 'An item was issued to you',
    body: `${quantity} × ${item.item_name}`,
    link: '/me',
  });

  revalidatePath('/items');
  return { ok: true };
}

export async function returnAssignment(id: string) {
  const gate = await requireRoles(ITEM_ADMIN_ROLES, 'Returning an item');
  if (!gate.ok) return gate;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('item_assignments')
    .update({ returned: true, returned_date: new Date().toISOString().slice(0, 10) })
    .eq('id', id)
    .eq('returned', false)
    .select('id, quantity, employee_id, items(item_name)');
  if (error) return { ok: false, error: error.message };
  if (wroteNothing(data)) {
    return { ok: false, error: 'Nothing to return — it may already be marked returned.' };
  }

  const row = data![0] as unknown as {
    quantity: number;
    employee_id: string | null;
    items: { item_name: string } | null;
  };
  await notifyEmployee(row.employee_id, {
    kind: 'item',
    title: 'An item was marked returned',
    body: `${row.quantity} × ${row.items?.item_name ?? 'item'}`,
    link: '/me',
  });

  revalidatePath('/items');
  return { ok: true };
}

export async function deleteAssignment(id: string) {
  const gate = await requireRoles(ITEM_ADMIN_ROLES, 'Deleting an assignment');
  if (!gate.ok) return gate;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('item_assignments')
    .delete()
    .eq('id', id)
    .select('id, quantity, returned, employee_id, items(item_name)');
  if (error) return { ok: false, error: error.message };
  if (wroteNothing(data)) {
    return { ok: false, error: 'The assignment was not deleted — it may no longer exist.' };
  }

  // Only tell the employee if it was still an active holding (not already returned).
  const row = data![0] as unknown as {
    quantity: number;
    returned: boolean;
    employee_id: string | null;
    items: { item_name: string } | null;
  };
  if (!row.returned) {
    await notifyEmployee(row.employee_id, {
      kind: 'item',
      title: 'An item was removed from you',
      body: `${row.quantity} × ${row.items?.item_name ?? 'item'}`,
      link: '/me',
    });
  }

  revalidatePath('/items');
  return { ok: true };
}

/** Client-callable loader for one item's assignment log. */
export async function fetchItemAssignments(itemId: string): Promise<ItemAssignmentRow[]> {
  return getItemAssignments(itemId);
}
