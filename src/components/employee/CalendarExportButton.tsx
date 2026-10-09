'use client';

import { DownloadButton } from '@/components/ui/DownloadButton';
import type { ApiErrorBody } from '@/lib/api/errors';

async function downloadCalendar() {
  // This endpoint returns a calendar file; the JSON API client cannot read it.
  let response: Response;
  try {
    response = await fetch('/api/calendar', {
      headers: { Accept: 'text/calendar' },
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    throw new Error('Could not reach the server. Check your connection and try again.');
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as Partial<ApiErrorBody> | null;
    throw new Error(
      typeof body?.error === 'string' && body.error
        ? body.error
        : 'Your calendar could not be downloaded. Please try again.',
    );
  }
  if (response.headers.get('content-type')?.split(';')[0].trim() !== 'text/calendar') {
    throw new Error('Your calendar could not be downloaded. Refresh the page and try again.');
  }

  return { blob: await response.blob(), filename: 'dalnex-hr.ics' };
}

function CalendarExportButton() {
  return <DownloadButton action={downloadCalendar} label="Download calendar" />;
}

export { CalendarExportButton };
