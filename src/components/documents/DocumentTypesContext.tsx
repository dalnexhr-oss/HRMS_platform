'use client';

import { createContext, useContext, useMemo } from 'react';
import { defaultDocumentTypes, documentCategoryLabel, requiredDocumentKeys } from '@/lib/document-categories';
import type { DocumentType } from '@/lib/document-categories';
import type { ReactNode } from 'react';

interface DocumentTypesValue {
  types: DocumentType[];
  /** Types offered for upload. */
  activeTypes: DocumentType[];
  /** Display name for a stored category. */
  label: (category: string | null, issued?: boolean) => string;
  /** Keys a person must have on file; exit documents only when they are leaving. */
  requiredFor: (leaving: boolean) => string[];
}

function valueFor(types: DocumentType[]): DocumentTypesValue {
  return {
    types,
    activeTypes: types.filter((type) => type.active),
    label: (category, issued = false) => documentCategoryLabel(category, issued, types),
    requiredFor: (leaving) => requiredDocumentKeys(types, leaving),
  };
}

// Outside a provider the built-in list applies.
const DocumentTypesContext = createContext<DocumentTypesValue>(valueFor(defaultDocumentTypes));

// Shares the HR-managed list of document types with every documents component beneath it.
function DocumentTypesProvider({
  types,
  children,
}: {
  types: DocumentType[];
  children: ReactNode;
}) {
  const value = useMemo(() => valueFor(types), [types]);
  return <DocumentTypesContext.Provider value={value}>{children}</DocumentTypesContext.Provider>;
}

function useDocumentTypes(): DocumentTypesValue {
  return useContext(DocumentTypesContext);
}

export { DocumentTypesProvider, useDocumentTypes };
