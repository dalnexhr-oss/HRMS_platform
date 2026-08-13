'use client';

// Shared by the staff notices screen and the employee dashboard.
import { getNoticePdfUrl } from '@/lib/actions/notices';

/**
 * Open a notice's PDF in a fresh tab. Claims the tab inside the click gesture
 * (signing needs a server round trip), without 'noopener' in the features —
 * that makes window.open() return null and would navigate THIS tab instead.
 */
export async function openNoticePdf(id: string, onError: (message: string) => void) {
  const win = window.open('about:blank', '_blank');
  if (win) win.opener = null;
  const res = await getNoticePdfUrl(id);
  if (!res.ok || !res.url) {
    win?.close();
    onError(res.error ?? 'Could not open the PDF.');
    return;
  }
  if (win) win.location.href = res.url;
  else window.location.href = res.url; // popup blocked outright — navigate in place
}
