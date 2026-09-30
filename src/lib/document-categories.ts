// Keep upload categories client-safe. A use-server module cannot export plain constants.
const documentCategories = [
  // onboarding
  'offer_letter',
  'contract',
  'joining_form',
  'id_proof',
  'education',
  'experience',
  'bank',
  'nda',
  'onboarding_other',
  // exit
  'resignation',
  'clearance',
  // anything else
  'other',
] as const;

type DocumentCategory = (typeof documentCategories)[number];

// System-issued documents are verified when generated and cannot be replaced through upload forms.
// Reissue them from /exits. The experience category is shared with uploads, so use the
// bucket/source to distinguish an issued letter from an uploaded certificate.
const generatedDocumentCategories = ['relieving', 'experience', 'settlement'] as const;

// Display names for every category, uploaded or issued.
const documentCategoryLabels: Record<string, string> = {
  offer_letter: 'Offer letter',
  contract: 'Contract / agreement',
  joining_form: 'Joining form',
  id_proof: 'ID proof',
  education: 'Education',
  experience: 'Experience',
  bank: 'Bank details',
  nda: 'NDA / confidentiality',
  onboarding_other: 'Other onboarding',
  resignation: 'Resignation',
  clearance: 'Clearance / exit',
  other: 'Other',
  // Issued by HR (generatedDocumentCategories), so these two are display-only
  // — they are never offered in an upload form.
  relieving: 'Relieving letter',
  settlement: 'Full & final statement',
};

// Choose document labels by source so issued experience letters and uploaded certificates remain
// distinguishable.
function documentCategoryLabel(category: string | null, issued = false): string {
  if (!category) {
    return '—';
  }
  if (issued && category === 'experience') {
    return 'Experience letter';
  }
  return documentCategoryLabels[category] ?? category;
}

// Required joining documents drive missing-document counts. Additional categories can be uploaded
// without being reported as missing.
const requiredDocumentCategories: readonly string[] = [
  'offer_letter',
  'contract',
  'id_proof',
  'bank',
];

export {
  documentCategories,
  generatedDocumentCategories,
  documentCategoryLabels,
  documentCategoryLabel,
  requiredDocumentCategories,
};

export type { DocumentCategory };
