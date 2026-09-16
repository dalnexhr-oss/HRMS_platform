// Generate single-use password-reset tokens. Email the random 32-byte token and store only its
// SHA-256 digest. Delete consumed tokens and expire unused ones.
import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { db } from '@/lib/db/mongo';

// How long a reset link stays valid. Short by design.
export const resetTokenTtlMinutes = 60;

export const resetTokensCollection = 'password_reset_tokens';

interface ResetTokenDoc {
  _id: string;
  user_id: string;
  // SHA-256 of the raw token. The raw value is never persisted.
  token_hash: string;
  expires_at: Date;
  created_at: Date;
  // Recorded for the audit trail, not used for validation.
  requested_ip: string | null;
}

// Computes SHA-256 digest of high-entropy CSPRNG tokens.
function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

async function tokens() {
  return (await db()).collection<ResetTokenDoc>(resetTokensCollection);
}

// Issue a reset token for a user and return the RAW value to put in the link. Any token the user
// already held is discarded first, so requesting a second link invalidates the first — otherwise
// every request would widen the window of live tokens.
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
    expires_at: new Date(Date.now() + resetTokenTtlMinutes * 60_000),
    created_at: new Date(),
    requested_ip: requestedIp,
  });

  return raw;
}

// Redeem a token, returning the user id it belongs to, or null. The delete is the validation:
// findOneAndDelete is atomic, so two requests racing on the same link cannot both succeed.
// `expires_at` is still checked in the filter because the TTL monitor only runs about once a minute
// — the index is the cleanup, this is the guarantee.
export async function consumeResetToken(raw: string): Promise<string | null> {
  if (!raw) return null;
  const collection = await tokens();
  const doc = await collection.findOneAndDelete({
    token_hash: hashToken(raw),
    expires_at: { $gt: new Date() },
  });
  return doc?.user_id ?? null;
}

// True when a token would be accepted, without spending it.
export async function peekResetToken(raw: string): Promise<boolean> {
  if (!raw) return false;
  const collection = await tokens();
  const count = await collection.countDocuments(
    { token_hash: hashToken(raw), expires_at: { $gt: new Date() } },
    { limit: 1 },
  );
  return count > 0;
}
