'use client';

// Shared error UI for portal and employee route boundaries, with retry and sign-out actions.
import { SignOutButton } from '@/components/auth/SignOutButton';

function ErrorState({
  error,
  reset,
  area,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  // Human name of the area that failed, e.g. 'portal' or 'dashboard'.
  area: string;
}) {
  return (
    <div className="content-container">
      <div className="card">
        <div className="empty-state" style={{ padding: 28 }}>
          <h3>Couldn’t load the {area}</h3>
          <p
            className="text-monospace"
            style={{
              fontSize: 12,
              color: 'var(--attendance-absent)',
              wordBreak: 'break-word',
              maxWidth: 560,
            }}
          >
            {error.message}
            {error.digest ? ` (ref: ${error.digest})` : ''}
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 16 }}>
            <button className="button primary" type="button" onClick={reset}>
              Try again
            </button>
            <SignOutButton label="Sign out" />
          </div>
        </div>
      </div>
    </div>
  );
}

export { ErrorState };
