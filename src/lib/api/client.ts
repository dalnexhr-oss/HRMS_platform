// The one way browser code calls /api routes. It adds what a bare fetch leaves out: a timeout,
// cancellation, retries for requests that are safe to repeat, a single shared request when the same
// call is made twice at once, and one error type whatever went wrong.
//
// Self-contained on purpose (type-only imports): the integration tests load this file directly.
import type { ApiErrorBody } from '@/lib/api/errors';

type ApiMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** How a request failed. Only `http` carries a status from the server. */
type ApiFailureKind = 'http' | 'timeout' | 'network' | 'offline' | 'aborted';

interface ApiRequestOptions {
  method?: ApiMethod;
  /** Sent as JSON. */
  body?: unknown;
  /** Cancels this caller's wait; the request itself stops once nobody is waiting on it. */
  signal?: AbortSignal;
  /** Per attempt, including reading the response. */
  timeoutMs?: number;
  /**
   * Extra attempts after the first. Only honoured for GET, or for a write that carries an
   * idempotencyKey — any other write is sent once, because repeating it could apply it twice.
   */
  retries?: number;
  /** Sent as the Idempotency-Key header; the server replays the first result for a repeat. */
  idempotencyKey?: string;
  /** Join an identical request already in flight instead of sending another. Default true. */
  dedupe?: boolean;
  /** Shown when the server gave no usable message. */
  fallbackMessage?: string;
}

interface ApiClientEnvironment {
  fetch: (input: string, init: RequestInit) => Promise<Response>;
  isOnline: () => boolean;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  random: () => number;
}

const defaultTimeoutMs = 15_000;
const defaultRetries = 2;
const retryBaseMs = 400;
const retryCapMs = 5_000;
const retryAfterCapMs = 10_000;
// Statuses that say "not now" rather than "no".
const retryableStatuses = new Set([408, 429, 502, 503, 504]);

const failureText: Record<Exclude<ApiFailureKind, 'http'>, string> = {
  timeout: 'The server took too long to respond. Check your connection and try again.',
  network: 'Could not reach the server. Check your connection and try again.',
  offline: 'You are offline. Reconnect and try again.',
  aborted: 'The request was cancelled.',
};

class ApiClientError extends Error {
  kind: ApiFailureKind;
  status: number | null;
  code: string;
  requestId: string | null;
  /** True when sending the same request again could succeed. */
  retryable: boolean;

  constructor(
    kind: ApiFailureKind,
    message: string,
    details: {
      status?: number | null;
      code?: string;
      requestId?: string | null;
      retryable?: boolean;
    } = {},
  ) {
    super(message);
    this.name = 'ApiClientError';
    this.kind = kind;
    this.status = details.status ?? null;
    this.code = details.code ?? kind.toUpperCase();
    this.requestId = details.requestId ?? null;
    this.retryable = details.retryable ?? (kind === 'timeout' || kind === 'network');
  }
}

function isApiClientError(value: unknown): value is ApiClientError {
  return value instanceof ApiClientError;
}

/** True for a cancellation the caller asked for — not something to show the user. */
function isAbort(value: unknown): boolean {
  return isApiClientError(value) && value.kind === 'aborted';
}

function waitFor(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new ApiClientError('aborted', failureText.aborted));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ApiClientError('aborted', failureText.aborted));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

const browserEnvironment: ApiClientEnvironment = {
  fetch: (input, init) => globalThis.fetch(input, init),
  isOnline: () => typeof navigator === 'undefined' || navigator.onLine !== false,
  sleep: waitFor,
  random: Math.random,
};

/** A key for one user action. Uses getRandomValues, which also works on plain-HTTP LAN hosts. */
function newIdempotencyKey(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

interface SharedRequest {
  promise: Promise<unknown>;
  controller: AbortController;
  waiting: number;
}

function createApiClient(overrides: Partial<ApiClientEnvironment> = {}) {
  const env: ApiClientEnvironment = { ...browserEnvironment, ...overrides };
  const inFlight = new Map<string, SharedRequest>();
  function retryDelay(attempt: number, retryAfterMs: number | null): number {
    if (retryAfterMs !== null) {
      return Math.min(retryAfterMs, retryAfterCapMs);
    }
    const ceiling = Math.min(retryCapMs, retryBaseMs * 2 ** (attempt - 1));
    // Jitter so tabs that failed together do not all come back together.
    return Math.round(ceiling * (0.75 + env.random() * 0.5));
  }

  async function attemptOnce(
    method: ApiMethod,
    path: string,
    bodyText: string | undefined,
    options: ApiRequestOptions,
    shared: AbortSignal,
  ): Promise<
    { ok: true; data: unknown } | { ok: false; error: ApiClientError; retryAfterMs: number | null }
  > {
    if (!env.isOnline()) {
      return {
        ok: false,
        error: new ApiClientError('offline', failureText.offline, { retryable: false }),
        retryAfterMs: null,
      };
    }

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, options.timeoutMs ?? defaultTimeoutMs);
    const onAbort = () => controller.abort();
    shared.addEventListener('abort', onAbort, { once: true });

    let status: number | null = null;
    try {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (bodyText !== undefined) {
        headers['Content-Type'] = 'application/json';
      }
      if (options.idempotencyKey) {
        headers['Idempotency-Key'] = options.idempotencyKey;
      }
      const response = await env.fetch(path, {
        method,
        headers,
        body: bodyText,
        signal: controller.signal,
        cache: 'no-store',
        credentials: 'same-origin',
      });
      status = response.status;

      if (response.ok) {
        const data: unknown = status === 204 ? undefined : await response.json();
        return { ok: true, data };
      }

      const body = (await response.json().catch(() => null)) as Partial<ApiErrorBody> | null;
      const retryAfter = Number(response.headers.get('retry-after'));
      return {
        ok: false,
        error: new ApiClientError(
          'http',
          typeof body?.error === 'string' && body.error
            ? body.error
            : (options.fallbackMessage ?? `The request failed (${status}).`),
          {
            status,
            code: typeof body?.code === 'string' ? body.code : `HTTP_${status}`,
            requestId: body?.requestId ?? response.headers.get('x-request-id'),
            retryable: retryableStatuses.has(status),
          },
        ),
        retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : null,
      };
    } catch {
      const kind: ApiFailureKind = shared.aborted ? 'aborted' : timedOut ? 'timeout' : 'network';
      return {
        ok: false,
        error: new ApiClientError(kind, failureText[kind], { status }),
        retryAfterMs: null,
      };
    } finally {
      clearTimeout(timer);
      shared.removeEventListener('abort', onAbort);
    }
  }

  async function send(
    method: ApiMethod,
    path: string,
    bodyText: string | undefined,
    options: ApiRequestOptions,
    shared: AbortSignal,
  ): Promise<unknown> {
    const repeatable = method === 'GET' || Boolean(options.idempotencyKey);
    const retries = repeatable ? Math.max(0, options.retries ?? defaultRetries) : 0;

    for (let attempt = 1; ; attempt += 1) {
      const result = await attemptOnce(method, path, bodyText, options, shared);
      if (result.ok) {
        return result.data;
      }
      if (!result.error.retryable || attempt > retries || shared.aborted) {
        throw result.error;
      }
      await env.sleep(retryDelay(attempt, result.retryAfterMs), shared);
    }
  }

  /** Call a JSON /api route. Resolves with the parsed body; rejects with ApiClientError. */
  function request<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
    const method = options.method ?? 'GET';
    const { signal } = options;
    if (signal?.aborted) {
      return Promise.reject(new ApiClientError('aborted', failureText.aborted));
    }

    const bodyText = options.body === undefined ? undefined : JSON.stringify(options.body);
    const key =
      options.dedupe === false
        ? null
        : `${method} ${path} ${options.idempotencyKey ?? ''} ${bodyText ?? ''}`;

    let entry = key === null ? undefined : inFlight.get(key);
    if (!entry) {
      const controller = new AbortController();
      const created: SharedRequest = {
        controller,
        waiting: 0,
        promise: send(method, path, bodyText, options, controller.signal).finally(() => {
          if (key !== null && inFlight.get(key) === created) {
            inFlight.delete(key);
          }
        }),
      };
      // Every caller attaches its own handlers below; this keeps a fully abandoned request from
      // surfacing as an unhandled rejection.
      created.promise.catch(() => undefined);
      if (key !== null) {
        inFlight.set(key, created);
      }
      entry = created;
    }

    const current = entry;
    current.waiting += 1;
    if (!signal) {
      return current.promise as Promise<T>;
    }

    return new Promise<T>((resolve, reject) => {
      const onAbort = () => {
        current.waiting -= 1;
        if (current.waiting === 0) {
          // Nobody is left to use the answer: stop the request and let a later call start afresh.
          if (key !== null && inFlight.get(key) === current) {
            inFlight.delete(key);
          }
          current.controller.abort();
        }
        reject(new ApiClientError('aborted', failureText.aborted));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      current.promise.then(
        (value) => {
          signal.removeEventListener('abort', onAbort);
          resolve(value as T);
        },
        (error: unknown) => {
          signal.removeEventListener('abort', onAbort);
          reject(error);
        },
      );
    });
  }

  return {
    request,
  };
}

const apiClient = createApiClient();
const apiRequest = apiClient.request;

/** The sentence to show a person for any thrown value. */
function apiErrorMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

export {
  ApiClientError,
  apiClient,
  apiErrorMessage,
  apiRequest,
  createApiClient,
  isAbort,
  isApiClientError,
  newIdempotencyKey,
};
export type { ApiClientEnvironment, ApiFailureKind, ApiMethod, ApiRequestOptions };
