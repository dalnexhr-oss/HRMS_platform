// ============================================================================
// Transactional email via Resend. SERVER ONLY.
//
// Mirrors notify.ts's contract: BEST-EFFORT and never throws. A failed email
// must not roll back the business action that triggered it (creating an
// employee still succeeds if the welcome email fails — it is logged instead).
//
// Config (.env): RESEND_API_KEY (re_…) and EMAIL_FROM ("Dalnex HR <hr@dalnex.com>").
// When either is missing, sending is disabled and calls no-op with a warning —
// exactly like notifications when the service key is absent. The `resend`
// package is imported lazily so a missing key never affects the rest of the app.
// ============================================================================

export interface SendEmailInput {
  to: string | string[];
  subject: string;
  /** Plain-text body. */
  text: string;
  /** Optional HTML body; falls back to `text` when omitted. */
  html?: string;
  /** Optional file attachments. */
  attachments?: { filename: string; content: Uint8Array | Buffer }[];
}

function emailFrom(): string | undefined {
  return process.env.EMAIL_FROM;
}

function apiKey(): string | undefined {
  return process.env.RESEND_API_KEY;
}

/** True when a Resend key + from-address are present. Check before offering email. */
export function isEmailConfigured(): boolean {
  return Boolean(apiKey() && emailFrom());
}

function warn(context: string, detail: unknown): void {
  console.warn(
    `[dalnex-hrms] email(${context}) failed — the action itself succeeded: ` +
      (detail instanceof Error ? detail.message : String(detail)),
  );
}

export type SendResult = { ok: boolean; id?: string; error?: string };

/**
 * Send one email. Never throws; returns {ok:false} on any failure so callers
 * may surface a soft warning ("saved, but the welcome email could not be sent").
 */
export async function sendEmail(input: SendEmailInput): Promise<SendResult> {
  const from = emailFrom();
  const key = apiKey();
  if (!from || !key) {
    warn(input.subject, 'RESEND_API_KEY or EMAIL_FROM is not set, so email is disabled.');
    return { ok: false, error: 'Email is not configured.' };
  }

  try {
    const { Resend } = await import('resend');
    const resend = new Resend(key);
    const { data, error } = await resend.emails.send({
      from,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html ?? undefined,
      attachments: input.attachments?.map((a) => ({
        filename: a.filename,
        content: Buffer.from(a.content),
      })),
    });
    if (error) {
      warn(input.subject, error.message ?? error);
      return { ok: false, error: error.message ?? 'Email send failed.' };
    }
    return { ok: true, id: data?.id };
  } catch (e) {
    warn(input.subject, e);
    return { ok: false, error: e instanceof Error ? e.message : 'Email send failed.' };
  }
}
