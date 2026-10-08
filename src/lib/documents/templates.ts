// The welcome email sent when an employee record goes live.
// One escaper for every HTML email body in the app, next to sendEmail().
import { escapeHtml } from '@/lib/email-delivery';
// Legal entity name used across every generated document.
import { company } from '@/lib/brand/company';
import { logoPngBytes } from '@/lib/brand/logo';

const monthAbbr = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

interface DateParts {
  y: number;
  // 1-12.
  m: number;
  // 1-31.
  d: number;
}

// Parses 'YYYY-MM-DD' string to calendar parts ({ y, m, d }), or null if invalid.
function parseIsoDate(iso: string | null | undefined): DateParts | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((iso ?? '').trim());
  if (!m) {
    return null;
  }
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) {
    return null;
  }
  return { y, m: mo, d };
}

// Formats ISO date to 'D Mon YYYY' (e.g. '27 Jul YYYY'). Falls back to trimmed input if unparseable.
function formatDate(iso: string): string {
  const p = parseIsoDate(iso);
  if (!p) {
    return (iso ?? '').trim();
  }
  return `${p.d} ${monthAbbr[p.m - 1]} ${p.y}`;
}

/** Trim and collapse whitespace; '' when absent. Keeps stray DB spacing out of prose. */
function clean(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

/** Inputs for the welcome email sent when an employee record goes live. */
interface WelcomeEmailInput {
  employeeName: string;
  employeeCode: string;
  /** 'YYYY-MM-DD' — first day at work. */
  startDate: string;
  /** Absolute URL of the employee portal, e.g. 'https://hr.dalnex.com'. */
  portalUrl: string;
}

/** Shape accepted by sendEmail() in src/lib/email-delivery.ts (minus `to`). */
interface WelcomeEmail {
  subject: string;
  text: string;
  html: string;
  /** The inline logo the HTML references via cid: — pass straight to sendEmail().
   *  A CID attachment renders even in clients that block remote images. */
  attachments: Array<{ filename: string; content: Uint8Array; cid: string; contentType: string }>;
}

/**
 * Build matching text and HTML welcome emails. Escape interpolated HTML and only make HTTP(S)
 * portal URLs clickable.
 */
function buildWelcomeEmail(input: WelcomeEmailInput): WelcomeEmail {
  const name = clean(input.employeeName);
  const code = clean(input.employeeCode);
  const start = formatDate(input.startDate);
  const url = clean(input.portalUrl);
  const isWebUrl = /^https?:\/\//i.test(url);

  const subject = `Welcome to ${company}, ${name}`;

  const text = [
    `Dear ${name},`,
    '',
    `Welcome to ${company}. We are glad to have you with us.`,
    '',
    `Your employee record has been created and your first working day is ${start}.`,
    `Your employee code is ${code} — please quote it in any correspondence with the Human`,
    'Resources team.',
    '',
    'You can sign in to the employee portal to complete your profile, upload your documents,',
    'mark attendance, apply for leave and view your payslips:',
    url || '(portal address will be shared separately)',
    '',
    'Sign in with this email address. If you have not set a password yet, use the',
    '"Forgot password" link on the sign-in page to create one.',
    '',
    'If anything looks incorrect, reply to this email and the Human Resources team will',
    'help you sort it out.',
    '',
    'Warm regards,',
    'Human Resources',
    company,
  ].join('\n');

  const eName = escapeHtml(name);
  const eCode = escapeHtml(code);
  const eStart = escapeHtml(start);
  const eUrl = escapeHtml(url);
  const portalBlock = isWebUrl
    ? `<p style="margin:0 0 24px"><a href="${eUrl}" style="display:inline-block;` +
      `background:#1f2937;color:#ffffff;text-decoration:none;padding:10px 18px;` +
      `border-radius:6px;font-weight:600">Open the employee portal</a></p>` +
      `<p style="margin:0 0 24px;font-size:13px;color:#6b7280">Or paste this address into ` +
      `your browser: ${eUrl}</p>`
    : `<p style="margin:0 0 24px;font-size:13px;color:#6b7280">The portal address will be ` +
      `shared with you separately.</p>`;

  const html =
    `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;` +
    `font-size:15px;line-height:1.6;color:#111827;max-width:560px;margin:0 auto;padding:24px">` +
    `<img src="cid:dalnex-logo" width="132" alt="${escapeHtml(company)}" ` +
    `style="display:block;border:0;height:auto;margin:0 0 16px" />` +
    `<h1 style="margin:0 0 20px;font-size:22px;font-weight:700">Welcome aboard, ${eName}</h1>` +
    `<p style="margin:0 0 16px">We are glad to have you with us. Your employee record has ` +
    `been created and your first working day is <strong>${eStart}</strong>.</p>` +
    `<p style="margin:0 0 16px">Your employee code is <strong>${eCode}</strong>. Please quote ` +
    `it in any correspondence with the Human Resources team.</p>` +
    `<p style="margin:0 0 16px">Sign in to the employee portal to complete your profile, ` +
    `upload your documents, mark attendance, apply for leave and view your payslips.</p>${
      portalBlock
    }<p style="margin:0 0 16px">Sign in with this email address. If you have not set a ` +
    `password yet, use the &ldquo;Forgot password&rdquo; link on the sign-in page to create ` +
    `one.</p>` +
    `<p style="margin:0 0 24px">If anything looks incorrect, reply to this email and the ` +
    `Human Resources team will help you sort it out.</p>` +
    `<p style="margin:0;color:#6b7280;font-size:13px">Warm regards,<br />Human Resources<br />` +
    `${escapeHtml(company)}</p>` +
    `</div>`;

  return {
    subject,
    text,
    html,
    attachments: [
      {
        filename: 'dalnex-logo.png',
        content: logoPngBytes(),
        cid: 'dalnex-logo',
        contentType: 'image/png',
      },
    ],
  };
}

export { buildWelcomeEmail };
export type { WelcomeEmailInput, WelcomeEmail };
