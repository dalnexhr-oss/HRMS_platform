// ============================================================================
// Transactional email over your OWN SMTP server (nodemailer). SERVER ONLY.
//
// Deliberately NOT a third-party sending API — mail goes straight out through
// the SMTP host you configure, so nothing about employees leaves for an outside
// provider. Mirrors notify.ts's contract: BEST-EFFORT and never throws. A failed
// email must not roll back the business action that triggered it (creating an
// employee still succeeds if the welcome mail fails — it is logged instead).
//
// Config (.env):
//   SMTP_HOST      e.g. mail.dalnex.com
//   SMTP_PORT      465 (implicit TLS) or 587 (STARTTLS). Default 587.
//   SMTP_SECURE    'true' to force implicit TLS (set automatically when PORT=465)
//   SMTP_USER      mailbox / auth user
//   SMTP_PASS      mailbox password / app password
//   EMAIL_FROM     "Dalnex HR <hr@dalnex.com>"
//
// When host/from are missing, sending is disabled and calls no-op with a warning
// — exactly like notifications when the service key is absent. The `nodemailer`
// package is imported lazily so a missing config never affects the rest of the app.
// ============================================================================

export interface SendEmailInput {
  to: string | string[];
  subject: string;
  /** Plain-text body. */
  text: string;
  /** Optional HTML body; falls back to `text` when omitted. */
  html?: string;
  /** Optional file attachments. A `cid` makes the attachment inline-embeddable
   *  from the HTML body via `<img src="cid:...">` (works in clients that block
   *  remote images, no public URL needed). */
  attachments?: {
    filename: string;
    content: Uint8Array | Buffer;
    cid?: string;
    contentType?: string;
  }[];
}

interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
}

/** Resolve SMTP config from env, or null when the minimum (host + from) is absent. */
function smtpConfig(): SmtpConfig | null {
  const host = process.env.SMTP_HOST;
  const from = process.env.EMAIL_FROM;
  if (!host || !from) return null;
  const port = Number(process.env.SMTP_PORT ?? 587) || 587;
  // Port 465 is implicit TLS; 587/25 use STARTTLS. SMTP_SECURE can force it.
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;
  return {
    host,
    port,
    secure,
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from,
  };
}

/** True when a host + from-address are present. Check before offering email. */
export function isEmailConfigured(): boolean {
  return smtpConfig() !== null;
}

function warn(context: string, detail: unknown): void {
  console.warn(
    `[dalnex-hrms] email(${context}) failed — the action itself succeeded: ` +
      (detail instanceof Error ? detail.message : String(detail)),
  );
}

export type SendResult = { ok: boolean; id?: string; error?: string };

/**
 * Send one email through the configured SMTP server. Never throws; returns
 * {ok:false} on any failure so callers may surface a soft warning ("saved, but
 * the welcome email could not be sent").
 */
export async function sendEmail(input: SendEmailInput): Promise<SendResult> {
  const cfg = smtpConfig();
  if (!cfg) {
    warn(input.subject, 'SMTP_HOST or EMAIL_FROM is not set, so email is disabled.');
    return { ok: false, error: 'Email is not configured.' };
  }

  try {
    const nodemailer = (await import('nodemailer')).default;
    const transport = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      // Auth is optional — some internal relays accept mail without it.
      auth: cfg.user && cfg.pass ? { user: cfg.user, pass: cfg.pass } : undefined,
    });

    const info = await transport.sendMail({
      from: cfg.from,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
      attachments: input.attachments?.map((a) => ({
        filename: a.filename,
        content: Buffer.from(a.content),
        cid: a.cid,
        contentType: a.contentType,
      })),
    });
    return { ok: true, id: info.messageId };
  } catch (e) {
    warn(input.subject, e);
    return { ok: false, error: e instanceof Error ? e.message : 'Email send failed.' };
  }
}
