// One policy for account administration, web punches, and device ingestion.
import type { PunchAccess } from '@/types/punch';

const webPunchDisabled =
  'Use the ZKTeco machine to punch in or out. Web punching is disabled for your account.';

function isPunchAccess(value: unknown): value is PunchAccess {
  return value === 'both' || value === 'web' || value === 'zkteco';
}

function readPunchAccess(value: unknown): PunchAccess {
  // Accounts created before this setting retain their existing access to both methods.
  if (value == null) {
    return 'both';
  }
  if (!isPunchAccess(value)) {
    throw new Error('Invalid punch access setting. Ask an administrator to update your account.');
  }
  return value;
}

function allowsWebPunch(value: unknown): boolean {
  return readPunchAccess(value) !== 'zkteco';
}

function allowsZktecoPunch(value: unknown): boolean {
  return readPunchAccess(value) !== 'web';
}

export { isPunchAccess, readPunchAccess, allowsWebPunch, allowsZktecoPunch, webPunchDisabled };
