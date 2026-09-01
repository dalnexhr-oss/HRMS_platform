// ============================================================================
// The handful of session constants that BOTH the edge and the server need.
//
// Split out of session.ts because that module imports 'server-only' and
// next/headers, neither of which middleware can load. Keeping the cookie name
// here means the gate and the reader can never disagree about it.
// ============================================================================

/** Session cookie name. Changing it signs everybody out. */
export const SESSION_COOKIE = 'dalnex_session';
