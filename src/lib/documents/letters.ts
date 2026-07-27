// ============================================================================
// System document generation (PDF). SERVER ONLY.
//
// Produces simple, professional single-column letters (relieving / experience /
// full-&-final statement) as PDF bytes using pdf-lib — a pure-JS library, so no
// headless browser or native binary is needed. The bytes are then stored in the
// `generated-documents` bucket (see src/lib/storage.ts uploadFileService) and a
// signed URL is handed to the employee/HR.
//
// This is intentionally layout-light: an A4 page, a heading, dated body
// paragraphs and a signatory block. Richer templating (letterhead image, tables)
// can grow here without changing callers.
// ============================================================================
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

export interface LetterSpec {
  /** Heading, e.g. "Relieving Letter" or "Full & Final Settlement". */
  title: string;
  /** Reference/date line under the title, e.g. "Ref: DN-REL-DN001 · 27 Jul 2026". */
  reference?: string;
  /** Salutation, e.g. "Dear Meera Kulkarni,". */
  salutation?: string;
  /** Body paragraphs, rendered in order with spacing between. */
  paragraphs: string[];
  /** Simple label/value lines rendered as a block (e.g. F&F line items). */
  lines?: { label: string; value: string }[];
  /** Closing, e.g. "For Dalnex LLP". */
  signatoryName?: string;
  signatoryTitle?: string;
}

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 56;
const CONTENT_WIDTH = A4.width - MARGIN * 2;

/** Greedy word-wrap to a pixel width for the given font/size. */
function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const trial = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(trial, size) > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = trial;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Render a letter to PDF bytes. Handles page overflow by adding pages as the
 * cursor runs past the bottom margin.
 */
export async function renderLetterPdf(spec: LetterSpec): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.1, 0.1, 0.12);
  const muted = rgb(0.4, 0.4, 0.45);

  let page: PDFPage = doc.addPage([A4.width, A4.height]);
  let y = A4.height - MARGIN;

  const ensureRoom = (needed: number) => {
    if (y - needed < MARGIN) {
      page = doc.addPage([A4.width, A4.height]);
      y = A4.height - MARGIN;
    }
  };

  const drawLine = (text: string, f: PDFFont, size: number, color = ink, gap = size * 0.5) => {
    ensureRoom(size + gap);
    page.drawText(text, { x: MARGIN, y, size, font: f, color });
    y -= size + gap;
  };

  const drawParagraph = (text: string, size = 11) => {
    for (const l of wrap(text, font, size, CONTENT_WIDTH)) drawLine(l, font, size, ink, 4);
    y -= 8; // paragraph spacing
  };

  // Header
  drawLine('DALNEX LLP', bold, 16);
  drawLine(spec.title, bold, 13, ink, 6);
  if (spec.reference) drawLine(spec.reference, font, 9, muted, 12);
  y -= 6;

  if (spec.salutation) {
    drawLine(spec.salutation, font, 11, ink, 10);
  }

  for (const p of spec.paragraphs) drawParagraph(p);

  if (spec.lines?.length) {
    y -= 4;
    for (const { label, value } of spec.lines) {
      ensureRoom(16);
      page.drawText(label, { x: MARGIN, y, size: 10, font, color: muted });
      page.drawText(value, {
        x: A4.width - MARGIN - bold.widthOfTextAtSize(value, 10),
        y,
        size: 10,
        font: bold,
        color: ink,
      });
      y -= 16;
    }
    y -= 8;
  }

  if (spec.signatoryName) {
    y -= 24;
    drawLine('For Dalnex LLP', font, 11, ink, 22);
    drawLine(spec.signatoryName, bold, 11, ink, 2);
    if (spec.signatoryTitle) drawLine(spec.signatoryTitle, font, 9, muted, 2);
  }

  return doc.save();
}
