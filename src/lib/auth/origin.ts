// ============================================================================
// The application's own absolute origin, for links that leave the app.
//
// There is exactly ONE definition because there were two, and they disagreed
// in the way that matters. Both build a password-reset URL, which carries a
// single-use token that IS the account:
//
//   actions/password.ts  fell back to the request's Host / X-Forwarded-Host —
//                        attacker-controlled, so a reset requested for someone
//                        else's address delivered a genuine email from this
//                        system pointing the victim's token at the attacker.
//   actions/users.ts     fell back to the empty string, producing
//                        `<a href="/auth/update-password?token=…">` in an
//                        email: a dead relative link, with the token spent.
//
// Neither failure is visible to the person who triggered it. So: the origin
// comes from configuration, the request headers are trusted only where there
// is nobody to phish, and "not configured" is an error the caller must handle
// rather than a string that silently produces a broken or hostile link.
// ============================================================================
import 'server-only';
import { headers } from 'next/headers';

/**
 * The absolute base URL for links in outgoing email, or null when it cannot be
 * established safely.
 *
 * APP_URL IS REQUIRED IN PRODUCTION. The development fallback below reads the
 * request's own Host / X-Forwarded-Host, and both are supplied by whoever made
 * the request — see the header. On a developer's own machine there is no
 * victim, and requiring configuration there would mean the reset flow never
 * gets tested locally.
 */
export async function appOrigin(): Promise<string | null> {
  const configured = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (configured) return configured.replace(/\/$/, '');

  if (process.env.NODE_ENV === 'production') return null;

  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

/** Shown when APP_URL is missing in production — a deployment fault, not a user one. */
export const ORIGIN_NOT_CONFIGURED =
  'This site’s address is not configured, so a reset link cannot be sent. ' +
  'Ask an administrator to set APP_URL.';
