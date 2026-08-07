'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth';
import { notifyEmployee } from '@/lib/notify';
import { getAssetAssignments, getAssetMaintenance } from '@/lib/queries';
import { requireRoles, wroteNothing } from './_guard';
import type { AppRole } from '@/types/database';

/** Client-callable wrappers for the per-asset drawer (queries.ts is server-only). */
export async function fetchAssetAssignments(assetId: string) {
  return getAssetAssignments(assetId);
}
export async function fetchAssetMaintenance(assetId: string) {
  return getAssetMaintenance(assetId);
}

// Asset Management is admin/HR only — same gate as user administration.
const ASSET_ADMIN_ROLES: AppRole[] = ['admin', 'hr'];

/** Pull the asset columns from the form; blank strings become null. */
function assetFields(formData: FormData) {
  const text = (k: string) => {
    const v = String(formData.get(k) ?? '').trim();
    return v || null;
  };
  return {
    desktop_name: String(formData.get('desktop_name') ?? '').trim(),
    asset_category: text('asset_category'),
    brand: text('brand'),
    serial_no: text('serial_no'),
    model_no: text('model_no'),
    warranty_upto: text('warranty_upto'),
    warranty_renew: text('warranty_renew'),
    product_id: text('product_id'),
    device_id: text('device_id'),
    processor: text('processor'),
    ram: text('ram'),
    graphics_card: text('graphics_card'),
    storage: text('storage'),
    antivirus: text('antivirus'),
  };
}

export async function createAsset(formData: FormData) {
  const gate = await requireRoles(ASSET_ADMIN_ROLES, 'Adding an asset');
  if (!gate.ok) return gate;

  const fields = assetFields(formData);
  if (!fields.desktop_name) return { ok: false, error: 'Desktop name is required.' };

  const supabase = await createClient();
  const { data, error } = await supabase.from('assets').insert(fields).select('id');
  if (error) return { ok: false, error: error.message };
  if (wroteNothing(data)) {
    return { ok: false, error: 'The asset was not added — your account may not have permission.' };
  }
  revalidatePath('/assets');
  return { ok: true };
}

export async function updateAsset(formData: FormData) {
  const gate = await requireRoles(ASSET_ADMIN_ROLES, 'Updating an asset');
  if (!gate.ok) return gate;

  const id = String(formData.get('id') ?? '').trim();
  if (!id) return { ok: false, error: 'Which asset to update is missing.' };

  const fields = assetFields(formData);
  if (!fields.desktop_name) return { ok: false, error: 'Desktop name is required.' };

  const supabase = await createClient();
  const { data, error } = await supabase.from('assets').update(fields).eq('id', id).select('id');
  if (error) return { ok: false, error: error.message };
  if (wroteNothing(data)) {
    return {
      ok: false,
      error: 'The asset was not updated — it may no longer exist, or your role lacks permission.',
    };
  }
  revalidatePath('/assets');
  return { ok: true };
}

/** Assign an asset to an employee (single holder). Snapshots name/code + notifies them. */
export async function assignAsset(formData: FormData) {
  const gate = await requireRoles(ASSET_ADMIN_ROLES, 'Assigning an asset');
  if (!gate.ok) return gate;

  const assetId = String(formData.get('asset_id') ?? '').trim();
  const employeeId = String(formData.get('employee_id') ?? '').trim();
  if (!assetId) return { ok: false, error: 'Which asset to assign is missing.' };
  if (!employeeId) return { ok: false, error: 'Choose an employee to assign to.' };

  const supabase = await createClient();

  // Snapshot the employee's name + code so the record survives their removal.
  const { data: emp, error: empErr } = await supabase
    .from('employees')
    .select('code, full_name')
    .eq('id', employeeId)
    .maybeSingle<{ code: string; full_name: string }>();
  if (empErr) return { ok: false, error: empErr.message };
  if (!emp) return { ok: false, error: 'That employee no longer exists.' };

  const { profile } = await getSession();

  const assignedDate = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('assets')
    .update({
      assigned_employee_id: employeeId,
      assigned_person_name: emp.full_name,
      assigned_employee_code: emp.code,
      assigned_date: assignedDate,
      assigned_by: profile?.full_name ?? null,
    })
    .eq('id', assetId)
    .select('id, desktop_name, brand');
  if (error) return { ok: false, error: error.message };
  if (wroteNothing(data)) {
    return { ok: false, error: 'The asset was not assigned — it may no longer exist, or your role lacks permission.' };
  }

  // Record the transfer in the history trail (0034). Best-effort: the snapshot
  // on the asset row is the source of truth for the CURRENT holder; a failed
  // history insert must not fail the assignment, so it is logged, not fatal.
  const remarks = String(formData.get('remarks') ?? '').trim() || null;
  const { error: histErr } = await supabase.from('asset_assignments').insert({
    asset_id: assetId,
    employee_id: employeeId,
    person_name: emp.full_name,
    employee_code: emp.code,
    assigned_date: assignedDate,
    assigned_by: profile?.full_name ?? null,
    remarks,
  });
  if (histErr) console.warn('[dalnex-hrms] asset history insert failed:', histErr.message);

  const row = data![0] as { desktop_name: string; brand: string | null };
  await notifyEmployee(employeeId, {
    kind: 'asset',
    title: 'An asset was assigned to you',
    body: [row.desktop_name, row.brand].filter(Boolean).join(' · '),
    link: '/me#assets',
  });

  revalidatePath('/assets');
  return { ok: true };
}

/** Clear an asset's assignment (return/unassign) and notify the prior holder. */
export async function unassignAsset(id: string) {
  const gate = await requireRoles(ASSET_ADMIN_ROLES, 'Unassigning an asset');
  if (!gate.ok) return gate;

  const supabase = await createClient();

  // Read the prior holder BEFORE clearing it — the update would null it out.
  const { data: before, error: readErr } = await supabase
    .from('assets')
    .select('assigned_employee_id, desktop_name, brand')
    .eq('id', id)
    .maybeSingle<{ assigned_employee_id: string | null; desktop_name: string; brand: string | null }>();
  if (readErr) return { ok: false, error: readErr.message };
  if (!before) return { ok: false, error: 'That asset no longer exists.' };
  if (!before.assigned_employee_id) {
    return { ok: false, error: 'Nothing to unassign — the asset is not assigned.' };
  }

  const { data, error } = await supabase
    .from('assets')
    .update({
      assigned_employee_id: null,
      assigned_person_name: null,
      assigned_employee_code: null,
      assigned_date: null,
      assigned_by: null,
    })
    .eq('id', id)
    .select('id');
  if (error) return { ok: false, error: error.message };
  if (wroteNothing(data)) {
    return { ok: false, error: 'The asset was not unassigned — your role may lack permission.' };
  }

  // Close the open history row for this holder (best-effort).
  const { error: histErr } = await supabase
    .from('asset_assignments')
    .update({ returned: true, returned_date: new Date().toISOString().slice(0, 10) })
    .eq('asset_id', id)
    .eq('employee_id', before.assigned_employee_id)
    .eq('returned', false);
  if (histErr) console.warn('[dalnex-hrms] asset history return failed:', histErr.message);

  await notifyEmployee(before.assigned_employee_id, {
    kind: 'asset',
    title: 'An asset was returned',
    body: [before.desktop_name, before.brand].filter(Boolean).join(' · '),
    link: '/me#assets',
  });

  revalidatePath('/assets');
  return { ok: true };
}

/** Log a maintenance/service event for an asset (admin/HR). */
export async function createAssetMaintenance(formData: FormData) {
  const gate = await requireRoles(ASSET_ADMIN_ROLES, 'Logging maintenance');
  if (!gate.ok) return gate;

  const assetId = String(formData.get('asset_id') ?? '').trim();
  if (!assetId) return { ok: false, error: 'Which asset is missing.' };

  const text = (k: string) => String(formData.get(k) ?? '').trim() || null;
  const costRaw = String(formData.get('cost') ?? '').trim();
  const cost = costRaw ? Number(costRaw) : null;
  if (cost != null && !Number.isFinite(cost)) return { ok: false, error: 'Cost must be a number.' };

  const { profile } = await getSession();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('asset_maintenance')
    .insert({
      asset_id: assetId,
      maint_date: text('maint_date') ?? new Date().toISOString().slice(0, 10),
      maint_type: text('maint_type'),
      cost,
      vendor: text('vendor'),
      notes: text('notes'),
      next_due: text('next_due'),
      created_by: profile?.full_name ?? null,
    })
    .select('id');
  if (error) return { ok: false, error: error.message };
  if (wroteNothing(data)) {
    return { ok: false, error: 'The maintenance record was not saved — your role may lack permission.' };
  }
  revalidatePath('/assets');
  return { ok: true };
}

export async function deleteAsset(id: string) {
  const gate = await requireRoles(ASSET_ADMIN_ROLES, 'Deleting an asset');
  if (!gate.ok) return gate;

  const supabase = await createClient();
  const { data, error } = await supabase.from('assets').delete().eq('id', id).select('id');
  if (error) return { ok: false, error: error.message };
  if (wroteNothing(data)) {
    return {
      ok: false,
      error: 'The asset was not deleted — it may no longer exist, or your role lacks permission.',
    };
  }
  revalidatePath('/assets');
  return { ok: true };
}
