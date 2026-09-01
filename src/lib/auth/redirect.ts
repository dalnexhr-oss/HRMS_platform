// ============================================================================
// Where a post-sign-in `?next=` may point.
//
// THE ATTACK. An open redirect on a login page is a phishing multiplier: the
// link the victim clicks is genuinely this application, on the real domain,
// with a real certificate — they type real credentials — and the redirect then
// hands them to the attacker's copy of the site to "try again".
//
// THE BUG THIS REPLACES. The check was `startsWith('/') && !startsWith('//')`,
// reasoning that a protocol-relative `//evil.com` is the only escape. It is
// not. Browsers normalise a BACKSLASH to a forward slash in the authority
// position of a URL with a special scheme (WHATWG URL, "special authority
// slashes" state), so `/\evil.com` passes both of those checks, is emitted as
// `Location: /\evil.com`, and resolves to `https://evil.com`. `/\/evil.com`,
// `/\\evil.com` and the percent-encoded `%5C` forms all do the same thing.
//
// THE RULE HERE. Do not enumerate what is dangerous — resolve the value the
// way a browser will and require that the result is still on our own origin.
// A path survives only if it parses to the same origin as the base we resolve
// against, which no absolute URL, protocol-relative URL, backslash trick or
// non-http scheme can do.
// ============================================================================

/**
 * A sentinel origin used only for resolution.
 *
 * The real deployment origin is not needed and deliberately not used: we are
 * asking "does this value stay relative", and any fixed origin answers that.
 * Using a placeholder also means the check behaves identically in development,
 * in CI and in production rather than depending on configuration being right.
 */
const BASE = 'https://redirect.invalid';

/**
 * The path to redirect to, or null when the value cannot be trusted.
 *
 * Returns a path-with-query-and-fragment, never an absolute URL, so the caller
 * can hand it straight to redirect().
 */
export function safeRedirectPath(value: string | null | undefined): string | null {
  if (!value) return null;

  // Must be written as a root-relative path. A bare 'evil.com' would resolve
  // against the base as a relative path and look same-origin, so requiring the
  // leading '/' is what stops that reading as a host.
  if (!value.startsWith('/')) return null;

  // A backslash anywhere in the leading separators is the whole trick above;
  // there is no legitimate reason for one in a route this application serves,
  // encoded or not.
  if (/[\\]/.test(value) || /%5c/i.test(value)) return null;

  // Control characters and whitespace can be stripped by the browser during
  // URL parsing, which changes what the value means after it has been checked.
  if (/[\x00-\x20\x7f]/.test(value)) return null;

  let url: URL;
  try {
    url = new URL(value, BASE);
  } catch {
    return null;
  }

  // The decisive check: after full URL parsing, are we still on the same
  // origin? '//evil.com', '/\evil.com', 'https://evil.com' and
  // 'javascript:alert(1)' all fail here.
  if (url.origin !== BASE) return null;
  if (url.protocol !== 'https:') return null; // inherited from BASE; a scheme of its own fails

  return `${url.pathname}${url.search}${url.hash}`;
}
