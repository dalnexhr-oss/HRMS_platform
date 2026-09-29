import { createHash, timingSafeEqual } from 'node:crypto';

interface DevicePunch {
  deviceId: string;
  /** Raw attendance packet UID; it may differ from the enrolled user's internal UID. */
  uid: string;
  userId: string;
  timestamp: string;
  punch: number;
  status: number;
}

function deviceTokenMatches(header: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < 32 || !header?.startsWith('Bearer ')) {
    return false;
  }
  const actual = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function parseDevicePunch(input: unknown, deviceId: string, now = new Date()): DevicePunch {
  if (!input || typeof input !== 'object') {
    throw new Error('Expected a device punch object.');
  }
  const value = input as Record<string, unknown>;
  for (const key of ['deviceId', 'uid', 'userId', 'timestamp']) {
    if (typeof value[key] !== 'string' || !value[key] || String(value[key]).length > 128) {
      throw new Error(`Invalid ${key}.`);
    }
  }
  if (!deviceId) {
    throw new Error(
      'Device is not configured for this endpoint: ZKTECO_DEVICE_ID is missing in HRMS. Set it to the bridge deviceId and restart HRMS.',
    );
  }
  if (value.deviceId !== deviceId) {
    throw new Error(
      `Device is not configured for this endpoint: the bridge sends "${value.deviceId}" but HRMS expects "${deviceId}". Set HRMS ZKTECO_DEVICE_ID to the existing bridge deviceId and restart HRMS.`,
    );
  }
  if (!/^\d+$/.test(String(value.uid)) || !/^[\w.-]+$/.test(String(value.userId))) {
    throw new Error('Invalid device user identity.');
  }
  // Require an explicit offset; server-local timestamps must never change attendance dates.
  const timestamp = String(value.timestamp);
  const instant = new Date(timestamp);
  const [year, month, day] = timestamp.slice(0, 10).split('-').map(Number);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      timestamp,
    ) ||
    !Number.isFinite(instant.getTime()) ||
    !Number.isFinite(calendar.getTime()) ||
    calendar.toISOString().slice(0, 10) !== timestamp.slice(0, 10) ||
    instant.getTime() > now.getTime() ||
    instant.getUTCFullYear() < 2000
  ) {
    throw new Error('Invalid timestamp or device clock is ahead of the server.');
  }
  for (const key of ['punch', 'status']) {
    if (!Number.isInteger(value[key]) || Number(value[key]) < 0 || Number(value[key]) > 255) {
      throw new Error(`Invalid ${key}.`);
    }
  }
  return {
    deviceId: String(value.deviceId),
    uid: String(value.uid),
    userId: String(value.userId),
    timestamp: instant.toISOString(),
    punch: Number(value.punch),
    status: Number(value.status),
  };
}

function deviceEventId(event: DevicePunch): string {
  // Retain raw attendance packet identity across retries and code/name corrections.
  // Replacing this UID with the enrollment UID would change existing queue/receipt hashes.
  return createHash('sha256')
    .update(JSON.stringify([event.deviceId, event.uid, event.timestamp, event.punch, event.status]))
    .digest('hex');
}

function devicePunchKind(punch: number, mode: string, lastKind?: string): 'in' | 'out' {
  if (mode === 'toggle') {
    return lastKind === 'in' ? 'out' : 'in';
  }
  if (mode !== 'device') {
    throw new Error('ZKTECO_PUNCH_MODE must be toggle or device.');
  }
  if ([0, 3, 4].includes(punch)) {
    return 'in';
  }
  if ([1, 2, 5].includes(punch)) {
    return 'out';
  }
  throw new Error(`Unsupported device punch code: ${punch}.`);
}

export { deviceTokenMatches, parseDevicePunch, deviceEventId, devicePunchKind };
export type { DevicePunch };
