'use client';

import { useEffect } from 'react';

/**
 * The last-resort boundary. A normal `error.tsx` renders *inside* the root
 * layout, so it cannot catch a failure in the layout itself. This one replaces
 * the whole document, which is why it must render its own `<html>`/`<body>` and
 * leans on inline styles rather than the app stylesheet — when this shows, the
 * assumption that anything else loaded correctly no longer holds. It only runs
 * in production; in development Next.js shows its error overlay instead.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '1rem',
          padding: '1.5rem',
          textAlign: 'center',
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          color: '#0f172a',
          background: '#ffffff',
        }}
      >
        <h1 style={{ fontSize: '1.5rem', fontWeight: 600, margin: 0 }}>Something went wrong</h1>
        <p style={{ maxWidth: '28rem', fontSize: '0.875rem', color: '#64748b', margin: 0 }}>
          An unexpected error stopped the app from loading. Please try again — if it keeps
          happening, get in touch with our team.
        </p>
        {error.digest ? (
          <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: 0 }}>
            Reference: <code>{error.digest}</code>
          </p>
        ) : null}
        <button
          type="button"
          onClick={reset}
          style={{
            marginTop: '0.5rem',
            height: '2.25rem',
            padding: '0 1rem',
            borderRadius: '0.375rem',
            border: 'none',
            cursor: 'pointer',
            fontSize: '0.875rem',
            fontWeight: 500,
            color: '#ffffff',
            background: '#0f766e',
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
