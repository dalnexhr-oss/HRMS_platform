// One error shape for every /api route: { error, code, requestId }. `error` stays a plain sentence
// because existing screens print it as-is; `code` is what callers branch on.
//
// Shared by route handlers, the edge middleware and the browser client, so it imports nothing.

const apiErrorCodes = {
  badRequest: 'BAD_REQUEST',
  validationFailed: 'VALIDATION_FAILED',
  notSignedIn: 'NOT_SIGNED_IN',
  forbidden: 'FORBIDDEN',
  notFound: 'NOT_FOUND',
  conflict: 'CONFLICT',
  payloadTooLarge: 'PAYLOAD_TOO_LARGE',
  unsupportedMediaType: 'UNSUPPORTED_MEDIA_TYPE',
  unavailable: 'UNAVAILABLE',
  internal: 'INTERNAL',
  // Attendance refusals the punch UI words differently from a generic failure.
  webPunchDisabled: 'WEB_PUNCH_DISABLED',
  locationRequired: 'LOCATION_REQUIRED',
  noEmployeeRecord: 'NO_EMPLOYEE_RECORD',
  attendanceClosed: 'ATTENDANCE_CLOSED',
  punchSequence: 'PUNCH_SEQUENCE',
  idempotencyKeyReused: 'IDEMPOTENCY_KEY_REUSED',
} as const;

type ApiErrorCode = (typeof apiErrorCodes)[keyof typeof apiErrorCodes];

interface ApiErrorBody {
  error: string;
  code: string;
  requestId?: string;
}

/** A failure the caller is meant to see: the message and status are sent to the client as-is. */
class ApiError extends Error {
  status: number;
  code: ApiErrorCode;

  constructor(status: number, code: ApiErrorCode, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/** The code a bare status maps to, for responses built without an ApiError. */
function codeForStatus(status: number): ApiErrorCode {
  switch (status) {
    case 400:
      return apiErrorCodes.badRequest;
    case 401:
      return apiErrorCodes.notSignedIn;
    case 403:
      return apiErrorCodes.forbidden;
    case 404:
      return apiErrorCodes.notFound;
    case 409:
      return apiErrorCodes.conflict;
    case 413:
      return apiErrorCodes.payloadTooLarge;
    case 415:
      return apiErrorCodes.unsupportedMediaType;
    case 422:
      return apiErrorCodes.validationFailed;
    case 503:
      return apiErrorCodes.unavailable;
    default:
      return status >= 500 ? apiErrorCodes.internal : apiErrorCodes.badRequest;
  }
}

const notSignedInMessage = 'Your session has expired. Sign in again.';

export { ApiError, apiErrorCodes, codeForStatus, notSignedInMessage };
export type { ApiErrorBody, ApiErrorCode };
