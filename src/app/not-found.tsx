import Link from 'next/link';

// 404 for any unmatched route. Kept minimal and self-contained so it renders
// even outside the portal/employee shells.
export default function NotFound() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        background: 'var(--bg, #f6f5f2)',
        fontFamily: 'var(--sans, system-ui, sans-serif)',
      }}
    >
      <div style={{ textAlign: 'center', maxWidth: 420 }}>
        <div style={{ font: '700 48px var(--mono, monospace)', color: 'var(--brand, #3a5)' }}>404</div>
        <h1 style={{ fontSize: 20, margin: '8px 0' }}>Page not found</h1>
        <p style={{ color: 'var(--ink-3, #777)', fontSize: 14, margin: '0 0 18px' }}>
          That page doesn’t exist or you don’t have access to it.
        </p>
        <Link
          href="/"
          style={{
            display: 'inline-block',
            padding: '9px 16px',
            borderRadius: 8,
            border: '1px solid var(--line-2, #ccc)',
            color: 'var(--brand, #3a5)',
            textDecoration: 'none',
            fontWeight: 600,
          }}
        >
          Go home
        </Link>
      </div>
    </div>
  );
}
