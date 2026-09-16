'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/db/server';
import { getSession } from '@/lib/auth';
import { notifyEmployee } from '@/lib/notify';
import { getAssetAssignments, getAssetMaintenance } from '@/lib/queries';
import { requireRoles, wroteNothing } from './guards';
import type { AppRole } from '@/types/database';
import { todayIST } from '@/lib/format';
import { toMoney } from '@/lib/db/money';
import { parseAssetLink } from '@/lib/asset-link';

// Client-callable wrappers for the per-asset drawer (queries.ts is server-only).
export async function fetchAssetAssignments(assetId: string) {
  return getAssetAssignments(assetId);
}
export async function fetchAssetMaintenance(assetId: string) {
  return getAssetMaintenance(assetId);
}

// Asset Management is admin/HR only — same gate as user administration.
const assetAdminRoles: AppRole[] = ['super_admin', 'admin', 'hr'];

// The shape every date column on an asset is validated against.
const isoDate = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate asset date ordering on the server as well as in the form: purchase cannot be after
 * today, warranty cannot precede purchase, and renewal cannot precede the cover it renews.
 */
function checkAssetDates(fields: {
  purchase_date: string | null;
  warranty_upto: string | null;
  warranty_renew: string | null;
}): string | null {
  const { purchase_date: purchase, warranty_upto: upto, warranty_renew: renew } = fields;

  for (const [value, label] of [
    [purchase, 'purchase date'],
    [upto, 'warranty date'],
    [renew, 'warranty renewal date'],
  ] as const) {
    if (value && !isoDate.test(value)) {
      return `Enter a valid ${label}.`;
    }
  }

  if (purchase && purchase > todayIST()) {
    return 'The purchase date is in the future — an asset cannot be bought before it exists.';
  }
  if (purchase && upto && upto < purchase) {
    return 'Warranty cover cannot end before the asset was purchased.';
  }
  if (purchase && renew && renew < purchase) {
    return 'The warranty renewal date cannot fall before the asset was purchased.';
  }
  if (upto && renew && renew < upto) {
    return 'The warranty renewal date cannot fall before the cover it renews expires.';
  }
  return null;
}

// Pull the asset columns from the form; blank strings become null.
function assetFields(formData: FormData) {
  const text = (k: string) => {
    const v = String(formData.get(k) ?? '').trim();
    return v || null;
  };
  // Money is Decimal128 at rest, never a float (lib/db/money.ts).
  const money = (k: string) => {
    const v = String(formData.get(k) ?? '').trim();
    return v ? toMoney(v) : null;
  };
  return {
    desktop_name: String(formData.get('desktop_name') ?? '').trim(),
    purchase_date: text('purchase_date'),
    purchase_cost: money('purchase_cost'),
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
  const gate = await requireRoles(assetAdminRoles, 'Adding an asset');
  if (!gate.ok) {
    return gate;
  }

  const fields = assetFields(formData);
  if (!fields.desktop_name) {
    return { ok: false, error: 'Desktop name is required.' };
  }
  const badDate = checkAssetDates(fields);
  if (badDate) {
    return { ok: false, error: badDate };
  }
  const link = parseAssetLink(formData.get('qr_url'));
  if (!link.ok) {
    return link;
  }

  const dbc = await createClient();
  const { data, error } = await dbc
    .from('assets')
    .insert({ ...fields, qr_url: link.url })
    .select('id');
  if (error) {
    return { ok: false, error: error.message };
  }
  if (wroteNothing(data)) {
    return { ok: false, error: 'The asset was not added — your account may not have permission.' };
  }
  revalidatePath('/assets');
  return { ok: true };
}

export async function updateAsset(formData: FormData) {
  const gate = await requireRoles(assetAdminRoles, 'Updating an asset');
  if (!gate.ok) {
    return gate;
  }

  const id = String(formData.get('id') ?? '').trim();
  if (!id) {
    return { ok: false, error: 'Which asset to update is missing.' };
  }

  const fields = assetFields(formData);
  if (!fields.desktop_name) {
    return { ok: false, error: 'Desktop name is required.' };
  }
  const badDate = checkAssetDates(fields);
  if (badDate) {
    return { ok: false, error: badDate };
  }
  const link = parseAssetLink(formData.get('qr_url'));
  if (!link.ok) {
    return link;
  }

  const dbc = await createClient();
  const { data, error } = await dbc
    .from('assets')
    .update({ ...fields, qr_url: link.url })
    .eq('id', id)
    .select('id');
  if (error) {
    return { ok: false, error: error.message };
  }
  if (wroteNothing(data)) {
    return {
      ok: false,
      error: 'The asset was not updated — it may no longer exist, or your role lacks permission.',
    };
  }
  revalidatePath('/assets');
  return { ok: true };
}

export async function updateAssetQrLink(
  assetId: string,
  value: string,
): Promise<{ ok: true; url: string | null } | { ok: false; error: string }> {
  const gate = await requireRoles(assetAdminRoles, 'Updating an asset QR link');
  if (!gate.ok) {
    return gate;
  }
  if (!assetId.trim()) {
    return { ok: false, error: 'Choose an asset to update.' };
  }
  const link = parseAssetLink(value);
  if (!link.ok) {
    return link;
  }

  const dbc = await createClient();
  const { data, error } = await dbc
    .from('assets')
    .update({ qr_url: link.url })
    .eq('id', assetId)
    .select('id');
  if (error) {
    return { ok: false, error: error.message };
  }
  if (wroteNothing(data)) {
    return { ok: false, error: 'This asset is no longer available.' };
  }
  revalidatePath('/assets');
  return link;
}

// Assign an asset to an employee (single holder). Snapshots name/code + notifies them.
export async function assignAsset(formData: FormData) {
  const gate = await requireRoles(assetAdminRoles, 'Assigning an asset');
  if (!gate.ok) {
    return gate;
  }

  const assetId = String(formData.get('asset_id') ?? '').trim();
  const employeeId = String(formData.get('employee_id') ?? '').trim();
  if (!assetId) {
    return { ok: false, error: 'Which asset to assign is missing.' };
  }
  if (!employeeId) {
    return { ok: false, error: 'Choose an employee to assign to.' };
  }

  const dbc = await createClient();

  // Snapshot the employee's name + code so the record survives their removal.
  const { data: emp, error: empErr } = await dbc
    .from('employees')
    .select('code, full_name')
    .eq('id', employeeId)
    .maybeSingle<{ code: string; full_name: string }>();
  if (empErr) {
    return { ok: false, error: empErr.message };
  }
  if (!emp) {
    return { ok: false, error: 'That employee no longer exists.' };
  }

  const { profile } = await getSession();

  const assignedDate = todayIST();
  const { data, error } = await dbc
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
  if (error) {
    return { ok: false, error: error.message };
  }
  if (wroteNothing(data)) {
    return {
      ok: false,
      error: 'The asset was not assigned — it may no longer exist, or your role lacks permission.',
    };
  }

  // The asset row is the current-holder record. Log a history failure without undoing the saved
  // assignment.
  const remarks = String(formData.get('remarks') ?? '').trim() || null;
  const { error: histErr } = await dbc.from('asset_assignments').insert({
    asset_id: assetId,
    employee_id: employeeId,
    person_name: emp.full_name,
    employee_code: emp.code,
    assigned_date: assignedDate,
    assigned_by: profile?.full_name ?? null,
    remarks,
  });
  if (histErr) {
    console.warn('[dalnex-hrms] asset history insert failed:', histErr.message);
  }

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

// Clear an asset's assignment (return/unassign) and notify the prior holder.
export async function unassignAsset(id: string) {
  const gate = await requireRoles(assetAdminRoles, 'Unassigning an asset');
  if (!gate.ok) {
    return gate;
  }

  const dbc = await createClient();

  // Read the current holder before clearing the assignment.
  const { data: before, error: readErr } = await dbc
    .from('assets')
    .select('assigned_employee_id, desktop_name, brand')
    .eq('id', id)
    .maybeSingle<{
      assigned_employee_id: string | null;
      desktop_name: string;
      brand: string | null;
    }>();
  if (readErr) {
    return { ok: false, error: readErr.message };
  }
  if (!before) {
    return { ok: false, error: 'That asset no longer exists.' };
  }
  if (!before.assigned_employee_id) {
    return { ok: false, error: 'Nothing to unassign — the asset is not assigned.' };
  }

  const { data, error } = await dbc
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
  if (error) {
    return { ok: false, error: error.message };
  }
  if (wroteNothing(data)) {
    return { ok: false, error: 'The asset was not unassigned — your role may lack permission.' };
  }

  // Close the open history row for this holder (best-effort).
  const { error: histErr } = await dbc
    .from('asset_assignments')
    .update({ returned: true, returned_date: todayIST() })
    .eq('asset_id', id)
    .eq('employee_id', before.assigned_employee_id)
    .eq('returned', false);
  if (histErr) {
    console.warn('[dalnex-hrms] asset history return failed:', histErr.message);
  }

  await notifyEmployee(before.assigned_employee_id, {
    kind: 'asset',
    title: 'An asset was returned',
    body: [before.desktop_name, before.brand].filter(Boolean).join(' · '),
    link: '/me#assets',
  });

  revalidatePath('/assets');
  return { ok: true };
}

// Log a maintenance/service event for an asset (admin/HR).
export async function createAssetMaintenance(formData: FormData) {
  const gate = await requireRoles(assetAdminRoles, 'Logging maintenance');
  if (!gate.ok) {
    return gate;
  }

  const assetId = String(formData.get('asset_id') ?? '').trim();
  if (!assetId) {
    return { ok: false, error: 'Which asset is missing.' };
  }

  const text = (k: string) => String(formData.get(k) ?? '').trim() || null;
  const costRaw = String(formData.get('cost') ?? '').trim();
  const cost = costRaw ? Number(costRaw) : null;
  if (cost != null && !Number.isFinite(cost)) {
    return { ok: false, error: 'Cost must be a number.' };
  }

  // Maintenance dates cannot be future-dated, and the next service cannot precede the recorded
  // maintenance.
  const maintDate = text('maint_date') ?? todayIST();
  const nextDue = text('next_due');
  if (!isoDate.test(maintDate)) {
    return { ok: false, error: 'Enter a valid maintenance date.' };
  }
  if (maintDate > todayIST()) {
    return {
      ok: false,
      error: 'The maintenance date is in the future — log the work once it is done.',
    };
  }
  if (nextDue) {
    if (!isoDate.test(nextDue)) {
      return { ok: false, error: 'Enter a valid next-due date.' };
    }
    if (nextDue < maintDate) {
      return { ok: false, error: 'The next service cannot be due before the one being logged.' };
    }
  }

  const { profile } = await getSession();
  const dbc = await createClient();
  const { data, error } = await dbc
    .from('asset_maintenance')
    .insert({
      asset_id: assetId,
      maint_date: maintDate,
      maint_type: text('maint_type'),
      cost,
      vendor: text('vendor'),
      notes: text('notes'),
      next_due: nextDue,
      created_by: profile?.full_name ?? null,
    })
    .select('id');
  if (error) {
    return { ok: false, error: error.message };
  }
  if (wroteNothing(data)) {
    return {
      ok: false,
      error: 'The maintenance record was not saved — your role may lack permission.',
    };
  }
  revalidatePath('/assets');
  return { ok: true };
}

export async function deleteAsset(id: string) {
  const gate = await requireRoles(assetAdminRoles, 'Deleting an asset');
  if (!gate.ok) {
    return gate;
  }

  const dbc = await createClient();
  const { data, error } = await dbc.from('assets').delete().eq('id', id).select('id');
  if (error) {
    return { ok: false, error: error.message };
  }
  if (wroteNothing(data)) {
    return {
      ok: false,
      error: 'The asset was not deleted — it may no longer exist, or your role lacks permission.',
    };
  }
  revalidatePath('/assets');
  return { ok: true };
}
