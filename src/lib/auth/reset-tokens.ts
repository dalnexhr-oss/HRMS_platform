// ============================================================================
// Password-reset tokens. SERVER ONLY.
//
// Replaces GoTrue's resetPasswordForEmail / recovery link.
//
// Two rules this file exists to enforce:
//   1. Only a HASH of the token is stored. The raw token exists in the email
//      and nowhere else, so a leaked database dump cannot be used to take over
//      accounts — the same reason passwords are hashed.
//   2. Expiry is a TTL index, not application logic. Mongo deletes the document
//      itself, so a token cannot outlive its window because someone forgot a
//      `where expires_at > now()` clause.
//
// Single use: consuming a token deletes it, so a reset link in a forwarded
// email or a browser history is spent the moment it is first used.
// ============================================================================
import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { db } from '@/lib/db/mongo';

/** How long a reset link stays valid. Short by design. */
export const RESET_TOKEN_TTL_MINUTES = 60;

export const RESET_TOKENS_COLLECTION = 'password_reset_tokens';

interface ResetTokenDoc {
  _id: string;
  user_id: string;
  /** SHA-256 of the raw token. The raw value is never persisted. */
  token_hash: string;
  expires_at: Date;
  created_at: Date;
  /** Recorded for the audit trail, not used for validation. */
  requested_ip: string | null;
}

/**
 * SHA-256, not scrypt.
 *
 * Deliberate: a reset token is 32 bytes of CSPRNG output, so there is no
 * dictionary to attack and no work factor worth paying. Passwords are different
 * — they are low-entropy and human-chosen, which is why they get scrypt.
 */
function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

async function tokens() {
  return (await db()).collection<ResetTokenDoc>(RESET_TOKENS_COLLECTION);
}

/**
 * Issue a reset token for a user and return the RAW value to put in the link.
 *
 * Any token the user already held is discarded first, so requesting a second
 * link invalidates the first — otherwise every request would widen the window
 * of live tokens.
 */
export async function createResetToken(
  userId: string,
  requestedIp: string | null = null,
): Promise<string> {
  const raw = randomBytes(32).toString('base64url');
  const collection = await tokens();

  await collection.deleteMany({ user_id: userId });
  await collection.insertOne({
    _id: randomBytes(16).toString('hex'),
    user_id: userId,
    token_hash: hashToken(raw),
    expires_at: new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60_000),
    created_at: new Date(),
    requested_ip: requestedIp,
  });

  return raw;
}

/**
 * Redeem a token, returning the user id it belongs to, or null.
 *
 * The delete is the validation: findOneAndDelete is atomic, so two requests
 * racing on the same link cannot both succeed. `expires_at` is still checked in
 * the filter because the TTL monitor only runs about once a minute — the index
 * is the cleanup, this is the guarantee.
 */
export async function consumeResetToken(raw: string): Promise<string | null> {
  if (!raw) return null;
  const collection = await tokens();
  const doc = await collection.findOneAndDelete({
    token_hash: hashToken(raw),
    expires_at: { $gt: new Date() },
  });
  return doc?.user_id ?? null;
}

/** True when a token would be accepted, without spending it. */
export async function peekResetToken(raw: string): Promise<boolean> {
  if (!raw) return false;
  const collection = await tokens();
  const count = await collection.countDocuments(
    { token_hash: hashToken(raw), expires_at: { $gt: new Date() } },
    { limit: 1 },
  );
  return count > 0;
}
