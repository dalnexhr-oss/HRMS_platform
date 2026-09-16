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

// Return the raw reset token for the email link. Remove existing tokens first so a new request
// invalidates earlier links.
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

// Atomically consume a valid reset token and return its user ID. Check expires_at in the query
// because TTL cleanup is asynchronous.
export async function consumeResetToken(raw: string): Promise<string | null> {
  if (!raw) {
    return null;
  }
  const collection = await tokens();
  const doc = await collection.findOneAndDelete({
    token_hash: hashToken(raw),
    expires_at: { $gt: new Date() },
  });
  return doc?.user_id ?? null;
}

// True when a token would be accepted, without spending it.
export async function peekResetToken(raw: string): Promise<boolean> {
  if (!raw) {
    return false;
  }
  const collection = await tokens();
  const count = await collection.countDocuments(
    { token_hash: hashToken(raw), expires_at: { $gt: new Date() } },
    { limit: 1 },
  );
  return count > 0;
}
