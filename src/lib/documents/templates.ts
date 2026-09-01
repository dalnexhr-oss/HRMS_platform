// ============================================================================
// Document templates — the WORDS of every system-generated HR document.
//
// Companion to ./letters.ts: that module owns *layout* (A4, wrapping, fonts) and
// knows nothing about HR; this module owns *content* and knows nothing about
// PDFs. Callers compose them — `renderLetterPdf(buildRelievingLetter(input))` —
// so wording can be reviewed and corrected by HR without anyone touching page
// geometry, and a new letter type is a new pure function here rather than a
// second renderer.
//
// Three rules shape everything below, all of them learned the hard way:
//
// 1. NO AMBIENT TIME. Not one `new Date()` / `Date.now()`. Every date is an
//    input, because these documents are regenerated on demand (an employee
//    re-downloads a relieving letter a year later) and the reissued copy MUST be
//    byte-identical to the original. A server-clock date would also silently
//    shift by a day whenever the container runs in UTC and the office is IST.
//
// 2. NO RUPEE SIGN IN LETTER TEXT. renderLetterPdf embeds StandardFonts.Helvetica,
//    which is WinAnsi-encoded; U+20B9 (₹) is not in WinAnsi and pdf-lib THROWS on
//    encode rather than dropping the glyph — so a single ₹ in an F&F statement
//    fails the whole download. Money in LetterSpec is therefore "Rs. 1,23,456.00".
//    (src/lib/format.ts `inr()` keeps the ₹ — that output is for the browser.)
//    Amounts also carry 2 decimals here, unlike the rounded UI figures, because a
//    settlement statement is an accounting record and must foot exactly.
//
// 3. NO INVENTED FACTS. Relieving/experience letters assert only what the HRMS
//    actually stores: identity, dates, designation. Nothing about performance,
//    conduct, or eligibility for rehire — those are claims the database cannot
//    back and that carry real legal weight for the firm.
// ============================================================================
import type { LetterSpec } from './letters';
// One escaper for every HTML email body in the app, next to sendEmail().
import { escapeHtml } from '@/lib/email';
// Legal entity name used across every generated document.
import { COMPANY } from '@/lib/brand/company';
import { logoPngBytes } from '@/lib/brand/logo';

/** Rendered under "For Dalnex LLP" in the signatory block of every letter. */
const SIGNATORY_NAME = 'Authorised Signatory';
const SIGNATORY_TITLE = 'Human Resources';

const MONTH_ABBR = [
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
  /** 1-12. */
  m: number;
  /** 1-31. */
  d: number;
}

/**
 * Split a 'YYYY-MM-DD' string into calendar parts, or null when unparseable.
 *
 * Deliberately string-based rather than `new Date(iso)`: a date can arrive as a
 * bare '2026-07-27' or as '2026-07-27T00:00:00+00:00', and Date would
 * re-interpret that in the server's zone and hand back the previous day for any
 * negative-offset host. Matching the leading Y-M-D takes both shapes literally.
 */
function parseIsoDate(iso: string | null | undefined): DateParts | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((iso ?? '').trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, m: mo, d };
}

/**
 * '2026-07-27' -> '27 Jul 2026'. Falls back to the raw input when it does not
 * look like an ISO date, so a bad value shows up in the document as the odd
 * string it is instead of as a plausible-but-wrong date.
 */
function formatDate(iso: string): string {
  const p = parseIsoDate(iso);
  if (!p) return (iso ?? '').trim();
  return `${p.d} ${MONTH_ABBR[p.m - 1]} ${p.y}`;
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/** Proleptic Gregorian leap rule — the one Postgres `date` also uses. */
function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/**
 * The calendar day after `p`, computed arithmetically.
 *
 * Deliberately NOT `new Date(...)` + setDate: constructing a Date would drag the
 * host time zone (and, for two-digit years, the 1900-offset legacy rule) into a
 * number that must be identical on every machine that regenerates the letter.
 */
function nextDay(p: DateParts): DateParts {
  const len = p.m === 2 && isLeapYear(p.y) ? 29 : DAYS_IN_MONTH[p.m - 1];
  if (p.d < len) return { y: p.y, m: p.m, d: p.d + 1 };
  if (p.m < 12) return { y: p.y, m: p.m + 1, d: 1 };
  return { y: p.y + 1, m: 1, d: 1 };
}

/** Sortable YYYYMMDD key, for comparing two DateParts without building a Date. */
function ordinal(p: DateParts): number {
  return p.y * 10000 + p.m * 100 + p.d;
}

/**
 * Whole-calendar-month tenure between two ISO dates, e.g. '3 years and 2 months'.
 * Returns null when either date is unparseable or the range is inverted — the
 * caller then simply omits the sentence rather than printing '-1 months'.
 *
 * `toIso` is the LAST WORKING DAY and is therefore INCLUSIVE, so the count runs
 * to the day after it. Without that step someone who joined on 1 Jan and left on
 * 31 Dec gets '11 months' printed directly beneath a line saying they were
 * "employed from 1 Jan 2020 to 31 Dec 2020" — a certificate that contradicts
 * itself in two adjacent sentences, handed to a prospective employer.
 */
function formatTenure(fromIso: string, toIso: string): string | null {
  const a = parseIsoDate(fromIso);
  const last = parseIsoDate(toIso);
  if (!a || !last) return null;
  // Check the inversion on the raw dates: after the +1 day an end date one day
  // before the start would otherwise round up into 'less than one month'.
  if (ordinal(last) < ordinal(a)) return null;

  const b = nextDay(last);
  let months = (b.y - a.y) * 12 + (b.m - a.m);
  if (b.d < a.d) months -= 1; // the final month is not yet complete
  if (months < 0) return null;
  if (months === 0) return 'less than one month';

  const years = Math.floor(months / 12);
  const rest = months % 12;
  const parts: string[] = [];
  if (years > 0) parts.push(`${years} ${years === 1 ? 'year' : 'years'}`);
  if (rest > 0) parts.push(`${rest} ${rest === 1 ? 'month' : 'months'}`);
  return parts.join(' and ');
}

/**
 * 1234567.5 -> 'Rs. 12,34,567.50'. Indian digit grouping (last three, then
 * pairs) with exactly two decimals.
 *
 * Grouping is done by hand rather than via `toLocaleString('en-IN')` because
 * that depends on the Node build shipping full ICU — a small-icu runtime
 * silently degrades to Western grouping, which would make the same settlement
 * render differently across deploys. See the header for why the prefix is
 * 'Rs. ' and not '₹'. Non-finite input is treated as zero so a null column can
 * never print 'Rs. NaN' on a legal document.
 */
function formatMoney(amount: number): string {
  const n = Number.isFinite(amount) ? amount : 0;
  const fixed = Math.abs(n).toFixed(2);
  const dot = fixed.indexOf('.');
  const whole = fixed.slice(0, dot);
  const frac = fixed.slice(dot + 1);

  const last3 = whole.slice(-3);
  const head = whole.slice(0, -3);
  const grouped = head ? `${head.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}` : last3;

  return `${n < 0 ? '-' : ''}Rs. ${grouped}.${frac}`;
}

/** Trim and collapse whitespace; '' when absent. Keeps stray DB spacing out of prose. */
function clean(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

/** Shared identity/date fields of the two separation letters. */
export interface SeparationLetterInput {
  employeeName: string;
  employeeCode: string;
  /** Role held at separation. Omitted from the prose entirely when absent. */
  designation?: string;
  /** 'YYYY-MM-DD'. */
  dateOfJoining: string;
  /** 'YYYY-MM-DD'. */
  lastWorkingDay: string;
  /** 'YYYY-MM-DD' — the date printed on the letter, supplied by the caller. */
  issuedOn: string;
}

/**
 * Relieving letter: addressed to the employee, confirming that employment ended
 * and that they are released from their duties.
 *
 * Says only what HR records support — dates, code, designation — plus the two
 * clauses the firm needs on the record: surviving obligations, and the fact that
 * settlement of dues is a separate exercise (so this letter is never read as a
 * receipt for money).
 */
export function buildRelievingLetter(input: SeparationLetterInput): LetterSpec {
  const name = clean(input.employeeName);
  const code = clean(input.employeeCode);
  const role = clean(input.designation);
  const joined = formatDate(input.dateOfJoining);
  const relieved = formatDate(input.lastWorkingDay);
  const issued = formatDate(input.issuedOn);

  const heldRole = role ? `, most recently in the position of ${role},` : '';

  return {
    title: 'Relieving Letter',
    reference: `Ref: DN-REL-${code} · ${issued}`,
    salutation: `Dear ${name},`,
    paragraphs: [
      `This is to confirm that your employment with ${COMPANY} (Employee Code: ${code}) ` +
        `commenced on ${joined} and concluded on ${relieved}. You served ${COMPANY}${heldRole} ` +
        `for the duration of that period.`,
      `You stand relieved of all duties and responsibilities at ${COMPANY} with effect from ` +
        `the close of business on ${relieved}. Access to company systems, premises and ` +
        `records is withdrawn from the same date.`,
      `Obligations that survive the end of employment — including confidentiality in respect ` +
        `of company and client information, and the return of any company property issued to ` +
        `you — continue to apply in accordance with the terms of your employment agreement.`,
      `Full and final settlement of dues, where applicable, is processed separately and is ` +
        `communicated through a distinct settlement statement.`,
      `${COMPANY} thanks you for your association with the firm and extends its best wishes ` +
        `for your future endeavours.`,
    ],
    signatoryName: SIGNATORY_NAME,
    signatoryTitle: SIGNATORY_TITLE,
  };
}

/**
 * Experience / service certificate: addressed to the world ("To Whomsoever It
 * May Concern") because its whole purpose is to be handed to a third party such
 * as a prospective employer or a bank.
 *
 * That audience is exactly why it stays strictly factual — tenure, code, role.
 * A "performed excellently" line here is an assertion the firm would have to
 * defend, and the HRMS holds no field that substantiates it.
 */
export function buildExperienceLetter(input: SeparationLetterInput): LetterSpec {
  const name = clean(input.employeeName);
  const code = clean(input.employeeCode);
  const role = clean(input.designation);
  const joined = formatDate(input.dateOfJoining);
  const until = formatDate(input.lastWorkingDay);
  const issued = formatDate(input.issuedOn);
  const tenure = formatTenure(input.dateOfJoining, input.lastWorkingDay);

  const paragraphs: string[] = [
    `This is to certify that ${name} (Employee Code: ${code}) was employed with ${COMPANY} ` +
      `from ${joined} to ${until}.`,
  ];

  paragraphs.push(
    role
      ? `At the time of separation, ${name} held the position of ${role} and carried out the ` +
          `duties associated with that role.`
      : `During this period, ${name} carried out the duties assigned by ${COMPANY}.`,
  );

  if (tenure) {
    paragraphs.push(`The total period of service with ${COMPANY} was ${tenure}.`);
  }

  paragraphs.push(
    `${name} is no longer in the employment of ${COMPANY} with effect from ${until}.`,
    `This certificate is issued on ${issued} at the request of the employee and states the ` +
      `record of service maintained by ${COMPANY}. It may be verified with the Human ` +
      `Resources department of ${COMPANY} quoting the reference above.`,
  );

  return {
    title: 'Experience Certificate',
    reference: `Ref: DN-EXP-${code} · ${issued}`,
    salutation: 'To Whomsoever It May Concern',
    paragraphs,
    signatoryName: SIGNATORY_NAME,
    signatoryTitle: SIGNATORY_TITLE,
  };
}

/** Line items of a full & final settlement, as computed by the payroll layer. */
export interface FullAndFinalInput {
  employeeName: string;
  employeeCode: string;
  /** 'YYYY-MM-DD'. */
  lastWorkingDay: string;
  /** 'YYYY-MM-DD' — the date printed on the statement. */
  issuedOn: string;
  /** Earning: salary earned up to and including the last working day. */
  salaryPayable: number;
  /** Earning: encashment of the unused leave balance. */
  leaveEncashment: number;
  /** Earning: approved reimbursement claims not yet paid out. */
  pendingReimbursements: number;
  /** Deduction: value recovered for company assets not returned. */
  assetRecovery: number;
  /** Deduction: advances, notice-period shortfall, and any other recovery. */
  otherDeductions: number;
  /** Authoritative net. Printed as given — see buildFullAndFinalStatement. */
  netPayable: number;
}

/**
 * Full & final settlement statement.
 *
 * `netPayable` is printed exactly as supplied and is NOT recomputed from the
 * components. The stored figure is what payroll approved and what the bank
 * transfer will match, so re-deriving it here would only create a way for the
 * PDF to disagree with the money that actually moves. The gross and total-
 * deduction subtotals ARE derived, because they are plain sums of the printed
 * lines and a reader would otherwise have to add the column up by hand.
 *
 * That is also why the net line is labelled plainly and not "(A - B)": HR may
 * round or override the approved figure (see full_and_final.net_payable in
 * 0037), and a label asserting arithmetic the two printed subtotals do not
 * actually produce turns a rounded settlement into an apparent error on a
 * document that is meant to foot exactly.
 *
 * A negative net (recoveries exceeding earnings) is a real outcome, so the
 * closing paragraph switches to "recoverable from you" rather than printing a
 * minus-signed payment.
 */
export function buildFullAndFinalStatement(input: FullAndFinalInput): LetterSpec {
  const name = clean(input.employeeName);
  const code = clean(input.employeeCode);
  const lastDay = formatDate(input.lastWorkingDay);
  const issued = formatDate(input.issuedOn);

  const num = (v: number) => (Number.isFinite(v) ? v : 0);
  const salary = num(input.salaryPayable);
  const leave = num(input.leaveEncashment);
  const reimb = num(input.pendingReimbursements);
  const assets = num(input.assetRecovery);
  const other = num(input.otherDeductions);
  const net = num(input.netPayable);

  const gross = salary + leave + reimb;
  const deductions = assets + other;

  const closing =
    net < 0
      ? `An amount of ${formatMoney(Math.abs(net))} is recoverable from you. Please arrange ` +
        `to remit this amount to ${COMPANY} to close the settlement.`
      : `The net amount payable of ${formatMoney(net)} will be credited to the bank account ` +
        `registered with ${COMPANY}, subject to statutory deductions where applicable.`;

  return {
    title: 'Full & Final Settlement',
    reference: `Ref: DN-FNF-${code} · ${issued}`,
    salutation: `Dear ${name},`,
    paragraphs: [
      `This statement sets out the full and final settlement of dues in respect of your ` +
        `employment with ${COMPANY} (Employee Code: ${code}), your last working day being ` +
        `${lastDay}. It is issued on ${issued}.`,
      `All amounts are stated in Indian Rupees and reflect the records held by ${COMPANY} as ` +
        `on the date of issue. The computation is set out at the end of this statement.`,
      closing,
      `Should any line in this statement not agree with your own records, please write to ` +
        `the Human Resources team of ${COMPANY} quoting the reference above.`,
    ],
    lines: [
      { label: `Salary payable up to ${lastDay}`, value: formatMoney(salary) },
      { label: 'Leave encashment', value: formatMoney(leave) },
      { label: 'Pending reimbursements', value: formatMoney(reimb) },
      { label: 'Gross payable (A)', value: formatMoney(gross) },
      { label: 'Less: asset recovery', value: formatMoney(assets) },
      { label: 'Less: other deductions', value: formatMoney(other) },
      { label: 'Total deductions (B)', value: formatMoney(deductions) },
      { label: 'Net payable', value: formatMoney(net) },
    ],
    signatoryName: SIGNATORY_NAME,
    signatoryTitle: SIGNATORY_TITLE,
  };
}

/** Inputs for the welcome email sent when an employee record goes live. */
export interface WelcomeEmailInput {
  employeeName: string;
  employeeCode: string;
  /** 'YYYY-MM-DD' — first day at work. */
  startDate: string;
  /** Absolute URL of the employee portal, e.g. 'https://hr.dalnex.com'. */
  portalUrl: string;
}

/** Shape accepted by sendEmail() in src/lib/email.ts (minus `to`). */
export interface WelcomeEmail {
  subject: string;
  text: string;
  html: string;
  /** The inline logo the HTML references via cid: — pass straight to sendEmail().
   *  A CID attachment renders even in clients that block remote images. */
  attachments: { filename: string; content: Uint8Array; cid: string; contentType: string }[];
}

/**
 * Welcome email for a newly onboarded employee.
 *
 * Not a LetterSpec: this one is never a PDF, so it returns the subject/text/html
 * triple that `sendEmail()` takes. Both bodies are built from the same facts and
 * carry the same content — a text-only client must not lose the portal address.
 *
 * Everything interpolated into the HTML is escaped, and the portal link is only
 * rendered as an anchor when it is genuinely http(s); a stored value like
 * `javascript:…` degrades to plain text rather than becoming a clickable payload
 * in an employee's inbox.
 */
export function buildWelcomeEmail(input: WelcomeEmailInput): WelcomeEmail {
  const name = clean(input.employeeName);
  const code = clean(input.employeeCode);
  const start = formatDate(input.startDate);
  const url = clean(input.portalUrl);
  const isWebUrl = /^https?:\/\//i.test(url);

  const subject = `Welcome to ${COMPANY}, ${name}`;

  const text = [
    `Dear ${name},`,
    '',
    `Welcome to ${COMPANY}. We are glad to have you with us.`,
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
    COMPANY,
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
    `<img src="cid:dalnex-logo" width="132" alt="${escapeHtml(COMPANY)}" ` +
    `style="display:block;border:0;height:auto;margin:0 0 16px" />` +
    `<h1 style="margin:0 0 20px;font-size:22px;font-weight:700">Welcome aboard, ${eName}</h1>` +
    `<p style="margin:0 0 16px">We are glad to have you with us. Your employee record has ` +
    `been created and your first working day is <strong>${eStart}</strong>.</p>` +
    `<p style="margin:0 0 16px">Your employee code is <strong>${eCode}</strong>. Please quote ` +
    `it in any correspondence with the Human Resources team.</p>` +
    `<p style="margin:0 0 16px">Sign in to the employee portal to complete your profile, ` +
    `upload your documents, mark attendance, apply for leave and view your payslips.</p>` +
    portalBlock +
    `<p style="margin:0 0 16px">Sign in with this email address. If you have not set a ` +
    `password yet, use the &ldquo;Forgot password&rdquo; link on the sign-in page to create ` +
    `one.</p>` +
    `<p style="margin:0 0 24px">If anything looks incorrect, reply to this email and the ` +
    `Human Resources team will help you sort it out.</p>` +
    `<p style="margin:0;color:#6b7280;font-size:13px">Warm regards,<br />Human Resources<br />` +
    `${escapeHtml(COMPANY)}</p>` +
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
