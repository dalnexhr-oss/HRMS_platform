// ============================================================================
// Password hashing. SERVER ONLY, Node runtime only.
//
// GoTrue did this for us. It now lives here, using scrypt from node:crypto:
// memory-hard, in the standard library, and — unlike bcrypt or argon2 — with no
// native module to compile, which matters on Windows.
//
// Node's crypto is NOT available in the edge runtime, so anything importing
// this file must run on Node. Only the sign-in and password-change paths do;
// middleware verifies the JWT instead and never touches a hash.
//
// Stored format:  scrypt$N$r$p$<salt b64>$<hash b64>
// The parameters travel with the hash so they can be raised later without
// invalidating every existing password.
// ============================================================================
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

// OWASP's floor for scrypt. N=2^16 costs ~64MB and ~100ms per hash, which is
// the point — it is the attacker's cost too.
const N = 65_536;
const R = 8;
const P = 1;
const KEYLEN = 64;
const SALT_BYTES = 16;
// scrypt's default maxmem (32MB) is below what N=65536 needs, so it must be
// raised explicitly or every call throws "memory limit exceeded".
const MAXMEM = 192 * 1024 * 1024;

/** Hash a plaintext password for storage. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await scryptAsync(password.normalize('NFKC'), salt, KEYLEN, {
    N,
    r: R,
    p: P,
    maxmem: MAXMEM,
  });
  return [
    'scrypt',
    N,
    R,
    P,
    salt.toString('base64'),
    hash.toString('base64'),
  ].join('$');
}

/**
 * Check a password against a stored hash. Returns false rather than throwing on
 * a malformed or unrecognised hash — a corrupt row must read as "wrong
 * password", never as a 500 that tells an attacker the account exists.
 */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  try {
    const [scheme, n, r, p, saltB64, hashB64] = stored.split('$');
    if (scheme !== 'scrypt') return false;

    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const actual = await scryptAsync(password.normalize('NFKC'), salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: MAXMEM,
    });

    // Length must match before timingSafeEqual, which throws on a mismatch.
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/**
 * Minimum password rules for the sign-up and reset paths.
 *
 * Length is the only requirement that measurably helps; character-class rules
 * push people towards "Password1!" and were dropped deliberately.
 */
export function validatePassword(password: string): string | null {
  if (password.length < 10) return 'Use at least 10 characters.';
  if (password.length > 200) return 'That password is too long.';
  return null;
}

/** A random password for invite flows, shown once and never stored in clear. */
export function generatePassword(): string {
  // base64url over 18 bytes → 24 URL-safe characters, no ambiguity about
  // padding or shell-unsafe symbols.
  return randomBytes(18).toString('base64url');
}
