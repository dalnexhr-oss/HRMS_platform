'use client';

// Last-resort boundary: catches errors thrown in the root layout itself, where
// no other error.tsx applies. It must render its own <html>/<body>.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 0 }}>
        <div
          style={{
            minHeight: '100vh',
            display: 'grid',
            placeItems: 'center',
            padding: 24,
            background: '#f6f5f2',
            color: '#1a1a1a',
          }}
        >
          <div
            style={{
              maxWidth: 560,
              background: '#fff',
              border: '1px solid #e5e3dd',
              borderRadius: 12,
              padding: 28,
            }}
          >
            <h1 style={{ margin: '0 0 8px', fontSize: 20 }}>Something went wrong</h1>
            <p style={{ margin: '0 0 16px', color: '#6b6b6b', fontSize: 14 }}>
              An unexpected error interrupted the page.
            </p>
            <pre
              style={{
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontSize: 12,
                color: '#a12',
                background: '#faf7f3',
                border: '1px solid #ece6dd',
                borderRadius: 8,
                padding: 12,
                margin: '0 0 18px',
              }}
            >
              {error.message}
              {error.digest ? `\n\nRef: ${error.digest}` : ''}
            </pre>
            <button
              type="button"
              onClick={reset}
              style={{
                padding: '9px 16px',
                borderRadius: 8,
                border: '1px solid #1a1a1a',
                background: '#1a1a1a',
                color: '#fff',
                cursor: 'pointer',
                font: 'inherit',
              }}
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
