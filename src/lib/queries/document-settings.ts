import 'server-only';
import { createClient } from '@/lib/db/server-client';
import { normalizeDocumentTypes } from '@/lib/document-categories';
import type { DocumentType } from '@/lib/document-categories';

// The settings row that holds the document list HR manages on the Documents tab. It is edited
// there, so the Settings screen leaves it out.
const documentTypesKey = 'document_types';
const documentSettingKeys: readonly string[] = [documentTypesKey];

async function readSetting(key: string): Promise<unknown> {
  const dbc = await createClient();
  const { data } = await dbc
    .from('settings')
    .select('value')
    .eq('key', key)
    .maybeSingle<{ value: unknown }>();
  return data?.value ?? null;
}

/** The document types in use. Falls back to the built-in list until HR saves one. */
async function getDocumentTypes(): Promise<DocumentType[]> {
  return normalizeDocumentTypes(await readSetting(documentTypesKey));
}

export { documentTypesKey, documentSettingKeys, getDocumentTypes };
