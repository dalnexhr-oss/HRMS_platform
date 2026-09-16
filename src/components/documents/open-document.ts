'use client';

import { getDocumentUrl } from '@/lib/actions/documents';

// Open the tab during the click event, before resolving the file URL, to avoid popup blocking. Omit
// the noopener feature because it makes window.open return null; clear opener manually instead.
export async function openDocument(id: string, onError: (message: string) => void): Promise<void> {
  const win = window.open('about:blank', '_blank');
  if (win) {
    win.opener = null;
  }

  const res = await getDocumentUrl(id);
  if (!res.ok || !res.url) {
    win?.close();
    onError(res.error ?? 'Could not open the document.');
    return;
  }

  if (win) {
    win.location.href = res.url;
  } else {
    // popup blocked outright — navigate in place
    window.location.href = res.url;
  }
}
