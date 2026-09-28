import type { QueryError } from '@/types/query';

const queryErrorCodes = {
  duplicateKey: 'DUPLICATE_KEY',
  validationFailed: 'VALIDATION_FAILED',
  permissionDenied: 'PERMISSION_DENIED',
  notSignedIn: 'NOT_SIGNED_IN',
  noResult: 'QUERY_NO_RESULT',
} as const;

function queryErrorMessage(error: QueryError): string {
  return [error.message, error.details, error.hint].filter(Boolean).join(' — ');
}

function isMongoDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000;
}

export { queryErrorCodes, queryErrorMessage, isMongoDuplicateKey };
