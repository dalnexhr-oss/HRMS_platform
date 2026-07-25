'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireRoles, wroteNothing } from './_guard';
import type { AppRole } from '@/types/database';

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
