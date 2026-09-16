// HS256 session JWTs shared by Node and edge runtimes through jose. The default lifetime is one
// year; server session checks compare ver with users.token_version to enforce revocation. A stolen
// cookie remains usable until it expires or the account's version changes.
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import type { AppRole } from '@/types/database';

// How long an issued token stays valid. One year unless overridden.
export const sessionMaxAgeDays = Number(process.env.SESSION_MAX_AGE_DAYS ?? 365);
export const sessionMaxAgeSeconds = sessionMaxAgeDays * 24 * 60 * 60;

const issuer = 'dalnex-hrms';
const audience = 'dalnex-hrms-session';
const alg = 'HS256';

// Claims carried in the session cookie. Kept small — it ships on every request.
export interface SessionClaims {
  // users._id
  sub: string;
  email: string;
  role: AppRole;
  // employees._id, or null for staff with no employee record.
  eid: string | null;
  // Mirrors users.token_version. A mismatch means the session was revoked.
  ver: number;
}

let cachedKey: Uint8Array | null = null;

function secretKey(): Uint8Array {
  if (cachedKey) return cachedKey;

  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      'AUTH_SECRET is missing or too short (needs 32+ characters). Generate one:\n' +
        "  node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\"\n" +
        'then add it to .env.local as AUTH_SECRET=…',
    );
  }
  return (cachedKey = new TextEncoder().encode(secret));
}

// True when a usable AUTH_SECRET is configured. Never throws.
export function isAuthConfigured(): boolean {
  const secret = process.env.AUTH_SECRET;
  return Boolean(secret && secret.length >= 32);
}

// Issue a session token for a user.
export async function signSession(claims: SessionClaims): Promise<string> {
  return new SignJWT({ ...claims } as unknown as JWTPayload)
    .setProtectedHeader({ alg: alg })
    .setSubject(claims.sub)
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(`${sessionMaxAgeDays}d`)
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
      issuer: issuer,
      audience: audience,
      algorithms: [alg],
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
