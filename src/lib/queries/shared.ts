import 'server-only';
import { queryErrorMessage } from '@/lib/db/query-errors';
import type { QueryError } from '@/types/query';

// Normalizes BSON Date or string timestamp to an ISO string for client serialization.
// Calendar date strings (YYYY-MM-DD) are preserved as-is.
function iso(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return (value as string | null) ?? '';
}

// Normalizes date values while preserving null/undefined for nullable fields.
function isoOrNull(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return iso(value);
}

// Throw an Error with query context so failures retain a useful stack and message.
function fail(context: string, error: QueryError): never {
  const detail = queryErrorMessage(error);
  const code = error.code ? ` (${error.code})` : '';
  throw new Error(`${context}: ${detail}${code}`);
}

/** A stored numeric (number, Decimal128 or string) as a plain number, or null. */
function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = typeof value === 'number' ? value : Number(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

export { fail, iso, isoOrNull, numberOrNull };
