// Accept only same-origin paths for post-login redirects. Resolve URLs as the browser does: a
// leading-slash check alone misses backslash and encoded authority escapes.

// Use a fixed sentinel origin to check whether a redirect stays relative, independently of
// deployment configuration.
const base = 'https://redirect.invalid';

// The path to redirect to, or null when the value cannot be trusted. Returns a
// path-with-query-and-fragment, never an absolute URL, so the caller can hand it straight to
// redirect().
export function safeRedirectPath(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  // Must be written as a root-relative path. A bare 'evil.com' would resolve
  // against the base as a relative path and look same-origin, so requiring the
  // leading '/' is what stops that reading as a host.
  if (!value.startsWith('/')) {
    return null;
  }

  // A backslash anywhere in the leading separators is the whole trick above;
  // there is no legitimate reason for one in a route this application serves,
  // encoded or not.
  if (/[\\]/.test(value) || /%5c/i.test(value)) {
    return null;
  }

  // Control characters and whitespace can be stripped by the browser during
  // URL parsing, which changes what the value means after it has been checked.
  if (/[\x00-\x20\x7f]/.test(value)) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(value, base);
  } catch {
    return null;
  }

  // The decisive check: after full URL parsing, are we still on the same
  // origin? '//evil.com', '/\evil.com', 'https://evil.com' and
  // 'javascript:alert(1)' all fail here.
  if (url.origin !== base) {
    return null;
  }
  if (url.protocol !== 'https:') {
    // inherited from BASE; a scheme of its own fails
    return null;
  }

  return `${url.pathname}${url.search}${url.hash}`;
}
