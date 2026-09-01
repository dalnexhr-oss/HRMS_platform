'use client';

import { getDocumentUrl } from '@/lib/actions/documents';

/**
 * Open a stored document in a new tab.
 *
 * The tab is claimed SYNCHRONOUSLY, inside the click gesture, and only then
 * pointed at the resolved URL. Awaiting the server action first and calling
 * window.open() afterwards puts the call outside the gesture, where every
 * popup blocker refuses it.
 *
 * 'noopener' is deliberately absent from the features string: with it,
 * window.open() returns null by specification, which sent every SUCCESSFUL open
 * down the fallback path below and navigated the HRMS tab itself away to the
 * file. The opener is severed by hand instead.
 */
export async function openDocument(id: string, onError: (message: string) => void): Promise<void> {
  const win = window.open('about:blank', '_blank');
  if (win) win.opener = null;

  const res = await getDocumentUrl(id);
  if (!res.ok || !res.url) {
    win?.close();
    onError(res.error ?? 'Could not open the document.');
    return;
  }

  if (win) win.location.href = res.url;
  else window.location.href = res.url; // popup blocked outright — navigate in place
}
