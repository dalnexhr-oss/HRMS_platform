// Document types employees and staff file under. The list is managed by HR on the Documents tab
// and stored in settings; the defaults below apply until it is first saved. Client-safe: a
// use-server module cannot export plain constants.

type DocumentStage = 'onboarding' | 'exit' | 'other';

interface DocumentType {
  // Stored on every document as its category, so it never changes once created.
  key: string;
  label: string;
  // Onboarding types are expected from every employee; exit types only from someone leaving.
  stage: DocumentStage;
  // Required types count as missing until a verified copy is on file.
  required: boolean;
  // A retired type stays on old documents but is no longer offered for upload.
  active: boolean;
}

const defaultDocumentTypes: DocumentType[] = [
  { key: 'offer_letter', label: 'Offer letter', stage: 'onboarding', required: true, active: true },
  {
    key: 'contract',
    label: 'Contract / agreement',
    stage: 'onboarding',
    required: true,
    active: true,
  },
  {
    key: 'joining_form',
    label: 'Joining form',
    stage: 'onboarding',
    required: false,
    active: true,
  },
  { key: 'id_proof', label: 'ID proof', stage: 'onboarding', required: true, active: true },
  { key: 'education', label: 'Education', stage: 'onboarding', required: false, active: true },
  { key: 'experience', label: 'Experience', stage: 'onboarding', required: false, active: true },
  { key: 'bank', label: 'Bank details', stage: 'onboarding', required: true, active: true },
  {
    key: 'nda',
    label: 'NDA / confidentiality',
    stage: 'onboarding',
    required: false,
    active: true,
  },
  {
    key: 'onboarding_other',
    label: 'Other onboarding',
    stage: 'onboarding',
    required: false,
    active: true,
  },
  { key: 'resignation', label: 'Resignation', stage: 'exit', required: false, active: true },
  { key: 'clearance', label: 'Clearance / exit', stage: 'exit', required: false, active: true },
  { key: 'relieving', label: 'Relieving letter', stage: 'exit', required: false, active: true },
  {
    key: 'experience_letter',
    label: 'Experience letter',
    stage: 'exit',
    required: false,
    active: true,
  },
  {
    key: 'settlement',
    label: 'Full & final statement',
    stage: 'exit',
    required: false,
    active: true,
  },
  { key: 'other', label: 'Other', stage: 'other', required: false, active: true },
];

const documentStages: readonly DocumentStage[] = ['onboarding', 'exit', 'other'];

const documentStageLabels: Record<DocumentStage, string> = {
  onboarding: 'Onboarding',
  exit: 'Exit',
  other: 'Other',
};

// Display labels for formal company letters issued to departing employees.
const issuedDocumentLabels: Record<string, string> = {
  relieving: 'Relieving letter',
  settlement: 'Full & final statement',
};

/** A stable key from a label: 'Form 16 (TDS)' -> 'form_16_tds'. */
function documentTypeKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
}

/** The saved list, or the defaults when nothing usable has been saved. */
function normalizeDocumentTypes(value: unknown): DocumentType[] {
  if (!Array.isArray(value)) {
    return defaultDocumentTypes;
  }
  const seen = new Set<string>();
  const types: DocumentType[] = [];
  for (const entry of value) {
    const row = (entry ?? {}) as Record<string, unknown>;
    const key = String(row.key ?? '').trim();
    const label = String(row.label ?? '').trim();
    if (!key || !label || seen.has(key)) {
      continue;
    }
    seen.add(key);
    types.push({
      key,
      label,
      stage: documentStages.includes(row.stage as DocumentStage)
        ? (row.stage as DocumentStage)
        : 'other',
      required: row.required === true,
      active: row.active !== false,
    });
  }
  return types.length > 0 ? types : defaultDocumentTypes;
}

/**
 * Display name for a category. Issued experience letters and uploaded certificates share a key,
 * so the source decides between them. A key no longer in the list is shown as stored.
 */
function documentCategoryLabel(
  category: string | null,
  issued = false,
  types: readonly DocumentType[] = defaultDocumentTypes,
): string {
  if (!category) {
    return '—';
  }
  if (issued && category === 'experience') {
    return 'Experience letter';
  }
  return (
    types.find((type) => type.key === category)?.label ??
    issuedDocumentLabels[category] ??
    defaultDocumentTypes.find((type) => type.key === category)?.label ??
    category
  );
}

/**
 * Keys of the documents this person must have on file. Exit documents are required only from
 * someone who is leaving.
 */
function requiredDocumentKeys(types: readonly DocumentType[], leaving: boolean): string[] {
  return types
    .filter((type) => type.active && type.required && (type.stage !== 'exit' || leaving))
    .map((type) => type.key);
}

export {
  defaultDocumentTypes,
  documentStages,
  documentStageLabels,
  issuedDocumentLabels,
  documentTypeKey,
  normalizeDocumentTypes,
  documentCategoryLabel,
  requiredDocumentKeys,
};

export type { DocumentType, DocumentStage };
