'use client';

import { useState, useTransition } from 'react';

interface DownloadFile {
  blob: Blob;
  filename: string;
}

// Shared appearance, loading state and error handling for file exports.
function DownloadButton({
  action,
  label,
  className = 'button',
}: {
  action: () => Promise<DownloadFile>;
  label: string;
  className?: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onClick = () =>
    start(async () => {
      setError(null);
      let url: string | null = null;
      let link: HTMLAnchorElement | null = null;
      try {
        const file = await action();
        url = URL.createObjectURL(file.blob);
        link = document.createElement('a');
        link.href = url;
        link.download = file.filename;
        link.rel = 'noopener';
        document.body.appendChild(link);
        link.click();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Download failed. Please try again.');
      } finally {
        link?.remove();
        if (url) {
          const toRevoke = url;
          setTimeout(() => URL.revokeObjectURL(toRevoke), 0);
        }
      }
    });

  return (
    <>
      <button type="button" className={className} onClick={onClick} disabled={pending}>
        {pending ? (
          'Preparing…'
        ) : (
          <>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M12 3v12m-4-4 4 4 4-4M4 17v3h16v-3" />
            </svg>
            {label}
          </>
        )}
      </button>
      {error ? (
        <span
          role="alert"
          className="text-muted"
          style={{ fontSize: 12, color: 'var(--attendance-absent)' }}
        >
          {error}
        </span>
      ) : null}
    </>
  );
}

export { DownloadButton };
