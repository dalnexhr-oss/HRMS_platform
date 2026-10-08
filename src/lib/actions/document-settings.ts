'use server';

// The list of document types HR manages on the Documents tab, and which of them are required.
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/db/server-client';
import { requireRoles, wroteNothing } from '@/lib/actions/guards';
import { documentStages, documentTypeKey } from '@/lib/document-categories';
import { documentTypesKey, getDocumentTypes } from '@/lib/queries/document-settings';
import type { DocumentStage, DocumentType } from '@/lib/document-categories';
import type { AppRole } from '@/types/database';

interface ActionResult {
  ok: boolean;
  error?: string;
}

const documentRoles: readonly AppRole[] = ['super_admin', 'admin', 'hr'];

async function saveSetting(key: string, label: string, value: unknown): Promise<ActionResult> {
  const dbc = await createClient();
  const { data, error } = await dbc
    .from('settings')
    .upsert({ key, value, label }, { onConflict: 'key' })
    .select('key');
  if (error) {
    return { ok: false, error: error.message };
  }
  if (wroteNothing(data)) {
    return { ok: false, error: 'Nothing was saved — your account may not have permission.' };
  }
  // Types are read by the documents register and the employee's locker. 'layout' is the refresh
  // scope, not a path: /employee and every tab under it.
  revalidatePath('/documents');
  revalidatePath('/employee', 'layout');
  return { ok: true };
}

/**
 * Replace the list of document types. A type's key is fixed when it is first added, because
 * documents already on file are stored under it; a new type gets its key from its name.
 */
async function saveDocumentTypes(
  input: Array<{ key?: string; label: string; stage: string; required: boolean; active: boolean }>,
): Promise<ActionResult> {
  const gate = await requireRoles(documentRoles, 'Changing document types');
  if (!gate.ok) {
    return gate;
  }
  if (!Array.isArray(input) || input.length === 0) {
    return { ok: false, error: 'Keep at least one document type.' };
  }
  if (input.length > 100) {
    return { ok: false, error: 'That is too many document types.' };
  }

  const existingKeys = new Set((await getDocumentTypes()).map((type) => type.key));
  const types: DocumentType[] = [];
  const keys = new Set<string>();
  const labels = new Set<string>();
  for (const row of input) {
    const label = String(row.label ?? '').trim();
    if (!label) {
      return { ok: false, error: 'Every document type needs a name.' };
    }
    if (label.length > 60) {
      return { ok: false, error: `“${label}” is too long — keep names under 60 characters.` };
    }
    if (labels.has(label.toLowerCase())) {
      return { ok: false, error: `“${label}” is listed twice.` };
    }
    labels.add(label.toLowerCase());

    // Only a key that is already in use is taken from the client; anything else is derived.
    const key = row.key && existingKeys.has(row.key) ? row.key : documentTypeKey(label);
    if (!key) {
      return { ok: false, error: `“${label}” needs at least one letter or number.` };
    }
    if (keys.has(key)) {
      return { ok: false, error: `“${label}” is too similar to another type. Rename one of them.` };
    }
    keys.add(key);

    if (!documentStages.includes(row.stage as DocumentStage)) {
      return { ok: false, error: `Choose when “${label}” applies.` };
    }
    types.push({
      key,
      label,
      stage: row.stage as DocumentStage,
      required: row.required === true,
      active: row.active !== false,
    });
  }
  if (!types.some((type) => type.active)) {
    return { ok: false, error: 'Keep at least one document type in use.' };
  }

  return saveSetting(documentTypesKey, 'Document types', types);
}

export { saveDocumentTypes };
export type { ActionResult };
