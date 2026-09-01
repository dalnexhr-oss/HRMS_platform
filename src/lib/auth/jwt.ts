// ============================================================================
// Session tokens. Signed JWTs, HS256, valid for one year.
//
// Uses `jose` rather than jsonwebtoken because middleware runs on the EDGE
// runtime, where node:crypto is unavailable. jose works in both runtimes, so
// the same verify path serves middleware, Server Components and Route Handlers.
//
// WHY A LONG-LIVED TOKEN IS SAFE HERE: an expiry a year out means the token
// itself can never be recalled, so the claims below carry a `ver` counter that
// is checked against the user document on every request. Bumping
// users.token_version invalidates every token that account holds — which is
// what makes sign-out, password change and "disable login" actually work. The
// token is long-lived; the SESSION is revocable.
//
// The trade-off that remains: a stolen cookie stays useful until someone
// notices and bumps the counter. That is the cost of a year-long session, and
// it is why the cookie is httpOnly, sameSite=lax and secure in production.
// ============================================================================
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import type { AppRole } from '@/types/database';

/** How long an issued token stays valid. One year unless overridden. */
export const SESSION_MAX_AGE_DAYS = Number(process.env.SESSION_MAX_AGE_DAYS ?? 365);
export const SESSION_MAX_AGE_SECONDS = SESSION_MAX_AGE_DAYS * 24 * 60 * 60;

const ISSUER = 'dalnex-hrms';
const AUDIENCE = 'dalnex-hrms-session';
const ALG = 'HS256';

/** Claims carried in the session cookie. Kept small — it ships on every request. */
export interface SessionClaims {
  /** users._id */
  sub: string;
  email: string;
  role: AppRole;
  /** employees._id, or null for staff with no employee record. */
  eid: string | null;
  /** Mirrors users.token_version. A mismatch means the session was revoked. */
  ver: number;
}

let cachedKey: Uint8Array | null = null;

function secretKey(): Uint8Array {
  if (cachedKey) return cachedKey;

  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      'AUTH_SECRET is missing or too short (needs 32+ characters). Generate one:\n' +
        '  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"\n' +
        'then add it to .env.local as AUTH_SECRET=…',
    );
  }
  return (cachedKey = new TextEncoder().encode(secret));
}

/** True when a usable AUTH_SECRET is configured. Never throws. */
export function isAuthConfigured(): boolean {
  const secret = process.env.AUTH_SECRET;
  return Boolean(secret && secret.length >= 32);
}

/** Issue a session token for a user. */
export async function signSession(claims: SessionClaims): Promise<string> {
  return new SignJWT({ ...claims } as unknown as JWTPayload)
    .setProtectedHeader({ alg: ALG })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_DAYS}d`)
    .sign(secretKey());
}

/**
 * Verify a token's signature, issuer, audience and expiry.
 *
 * Returns null on ANY failure — expired, tampered, wrong key, malformed. The
 * caller treats null as "not signed in"; there is nothing useful to tell a
 * visitor about which of those it was.
 *
 * This does NOT check `ver` against the database — it cannot, because
 * middleware has no database access on the edge. Call assertLiveSession() on
 * the server for that.
 */
export async function verifySession(token: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: [ALG],
    });

    // Shape-check rather than trusting the payload: a token signed with the
    // right key but an older claim set must not produce an undefined role.
    const { sub, email, role, eid, ver } = payload as unknown as SessionClaims;
    if (typeof sub !== 'string' || typeof email !== 'string') return null;
    if (typeof role !== 'string' || typeof ver !== 'number') return null;

    return { sub, email, role, eid: typeof eid === 'string' ? eid : null, ver };
  } catch {
    return null;
  }
}
