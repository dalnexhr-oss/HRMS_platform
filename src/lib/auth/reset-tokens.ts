// Generate single-use password-reset tokens. Email the random 32-byte token and store only its
// SHA-256 digest. Delete consumed tokens and expire unused ones.
import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { db } from '@/lib/db/mongo';
import { usersCollection } from '@/lib/db/collections';

// How long a reset link stays valid. Short by design.
export const resetTokenTtlMinutes = 60;

export const resetTokensCollection = 'password_reset_tokens';

interface ResetTokenDoc {
  _id: string;
  user_id: string;
  // A password or session revocation makes previously issued links unusable.
  token_version: number;
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
  const user = await (await usersCollection()).findOne({ _id: userId, disabled: false });
  if (!user) {
    throw new Error('That account is unavailable for a password reset.');
  }
  const raw = randomBytes(32).toString('base64url');
  const collection = await tokens();

  await collection.deleteMany({ user_id: userId });
  await collection.insertOne({
    _id: randomBytes(16).toString('hex'),
    user_id: userId,
    token_version: user.token_version,
    token_hash: hashToken(raw),
    expires_at: new Date(Date.now() + resetTokenTtlMinutes * 60_000),
    created_at: new Date(),
    requested_ip: requestedIp,
  });

  return raw;
}

export interface ResetTokenClaim {
  userId: string;
  tokenVersion: number;
}

async function currentClaim(doc: ResetTokenDoc | null): Promise<ResetTokenClaim | null> {
  // Links without a credential version cannot be proven current.
  if (!doc || !Number.isInteger(doc.token_version)) {
    return null;
  }
  const user = await (
    await usersCollection()
  ).findOne({
    _id: doc.user_id,
    disabled: false,
    token_version: doc.token_version,
  });
  return user ? { userId: user._id, tokenVersion: doc.token_version } : null;
}

// Atomically spend the link. The password write must also compare tokenVersion so a password
// change between consumption and the write cannot be undone by the older link.
export async function consumeResetToken(raw: string): Promise<ResetTokenClaim | null> {
  if (!raw) {
    return null;
  }
  const collection = await tokens();
  const doc = await collection.findOneAndDelete({
    token_hash: hashToken(raw),
    expires_at: { $gt: new Date() },
  });
  return currentClaim(doc);
}

// True when a token would be accepted, without spending it.
export async function peekResetToken(raw: string): Promise<boolean> {
  if (!raw) {
    return false;
  }
  const collection = await tokens();
  const doc = await collection.findOne({
    token_hash: hashToken(raw),
    expires_at: { $gt: new Date() },
  });
  return (await currentClaim(doc)) !== null;
}
