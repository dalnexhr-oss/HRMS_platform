// Resolve the application origin for outgoing links. Password-reset links must use a configured
// origin in production; trusting Host or X-Forwarded-Host could send reset tokens to another site.
// Missing configuration is an error.
import 'server-only';
import { headers } from 'next/headers';

// Require APP_URL in production for outgoing email links. Development may fall back to request
// host headers; return null if no usable origin is available.
export async function appOrigin(): Promise<string | null> {
  const configured = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (configured) {
    return configured.replace(/\/$/, '');
  }

  if (process.env.NODE_ENV === 'production') {
    return null;
  }

  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

// Shown when APP_URL is missing in production — a deployment fault, not a user one.
export const originNotConfigured =
  'This site’s address is not configured, so a reset link cannot be sent. ' +
  'Ask an administrator to set APP_URL.';
