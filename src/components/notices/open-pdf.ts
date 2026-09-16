'use client';

// Shared by the staff notices screen and the employee dashboard.
import { getNoticePdfUrl } from '@/lib/actions/notices';

// Open the PDF tab during the click event, before resolving its URL. Clear opener manually; the
// noopener feature would make window.open return null.
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
