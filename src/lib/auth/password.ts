// Hash passwords with Node.js scrypt. Store the work factors with the hash so they can change
// without invalidating existing passwords.
//
// Format: scrypt$N$r$p$<salt_b64>$<hash_b64>
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

// OWASP recommended work factors for scrypt (N=65536, r=8, p=1).
const scryptN = 65_536;
const scryptR = 8;
const scryptP = 1;
const keyLength = 64;
const saltBytes = 16;
// scrypt's default maxmem (32MB) is below what N=65536 needs, so it must be
// raised explicitly or every call throws "memory limit exceeded".
const maxmem = 192 * 1024 * 1024;

// Hash a plaintext password for storage.
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(saltBytes);
  const hash = await scryptAsync(password.normalize('NFKC'), salt, keyLength, {
    N: scryptN,
    r: scryptR,
    p: scryptP,
    maxmem,
  });
  return [
    'scrypt',
    scryptN,
    scryptR,
    scryptP,
    salt.toString('base64'),
    hash.toString('base64'),
  ].join('$');
}

// Check a password against a stored hash. Returns false rather than throwing on a malformed or
// unrecognised hash — a corrupt row must read as "wrong password", never as a 500 that tells an
// attacker the account exists.
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [scheme, n, r, p, saltB64, hashB64] = stored.split('$');
    if (scheme !== 'scrypt') {
      return false;
    }

    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const actual = await scryptAsync(password.normalize('NFKC'), salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem,
    });

    // Length must match before timingSafeEqual, which throws on a mismatch.
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// Minimum password rules for the sign-up and reset paths. Length is the only requirement that
// measurably helps; character-class rules push people towards "Password1!" and were dropped
// deliberately.
export function validatePassword(password: string): string | null {
  if (password.length < 10) {
    return 'Use at least 10 characters.';
  }
  if (password.length > 200) {
    return 'That password is too long.';
  }
  return null;
}

// A random password for invite flows, shown once and never stored in clear.
export function generatePassword(): string {
  // base64url over 18 bytes → 24 URL-safe characters, no ambiguity about
  // padding or shell-unsafe symbols.
  return randomBytes(18).toString('base64url');
}
