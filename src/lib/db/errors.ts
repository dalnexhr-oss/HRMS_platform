import type { QueryError } from '@/types/query';

export const queryErrorCodes = {
  duplicateKey: 'DUPLICATE_KEY',
  validationFailed: 'VALIDATION_FAILED',
  permissionDenied: 'PERMISSION_DENIED',
  notSignedIn: 'NOT_SIGNED_IN',
  noResult: 'QUERY_NO_RESULT',
} as const;

export function queryErrorMessage(error: QueryError): string {
  return [error.message, error.details, error.hint].filter(Boolean).join(' — ');
}

export function isMongoDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000;
}
