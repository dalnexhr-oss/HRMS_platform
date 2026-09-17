/**
 * Build HR letter PDFs with pdf-lib. Generated files are stored in the generated-documents bucket
 * and served through authenticated routes.
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { logoAspect, logoPngBytes } from '@/lib/brand/logo';
import type { PDFFont, PDFPage } from 'pdf-lib';

export interface LetterSpec {
  // Heading, e.g. "Relieving Letter" or "Full & Final Settlement".
  title: string;
  // Reference/date line under the title, e.g. "Ref: DN-REL-DN001 · 27 Jul YYYY".
  reference?: string;
  // Salutation, e.g. "Dear Meera Kulkarni,".
  salutation?: string;
  // Body paragraphs, rendered in order with spacing between.
  paragraphs: string[];
  // Simple label/value lines rendered as a block (e.g. F&F line items).
  lines?: Array<{ label: string; value: string }>;
  // Closing, e.g. "For Dalnex LLP".
  signatoryName?: string;
  signatoryTitle?: string;
}

const a4 = { width: 595.28, height: 841.89 };
const margin = 56;
const contentWidth = a4.width - margin * 2;

// Greedy word-wrap to a pixel width for the given font/size.
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
  if (line) {
    lines.push(line);
  }
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
  const logo = await doc.embedPng(logoPngBytes());
  const ink = rgb(0.1, 0.1, 0.12);
  const muted = rgb(0.4, 0.4, 0.45);
  const teal = rgb(0.055, 0.478, 0.561); // --brand #0E7A8F

  let page: PDFPage = doc.addPage([a4.width, a4.height]);
  let y = a4.height - margin;

  const ensureRoom = (needed: number) => {
    if (y - needed < margin) {
      page = doc.addPage([a4.width, a4.height]);
      y = a4.height - margin;
    }
  };

  const drawLine = (text: string, f: PDFFont, size: number, color = ink, gap = size * 0.5) => {
    ensureRoom(size + gap);
    page.drawText(text, { x: margin, y, size, font: f, color });
    y -= size + gap;
  };

  const drawParagraph = (text: string, size = 11) => {
    for (const l of wrap(text, font, size, contentWidth)) {
      drawLine(l, font, size, ink, 4);
    }
    y -= 8; // paragraph spacing
  };

  // Header — the Dalnex logo as letterhead, with a brand-teal rule under it.
  const logoW = 132;
  const logoH = logoW / logoAspect; // ≈45pt
  page.drawImage(logo, { x: margin, y: y - logoH, width: logoW, height: logoH });
  y -= logoH + 14;
  page.drawLine({
    start: { x: margin, y },
    end: { x: a4.width - margin, y },
    thickness: 1,
    color: teal,
  });
  y -= 22;
  drawLine(spec.title, bold, 13, ink, 6);
  if (spec.reference) {
    drawLine(spec.reference, font, 9, muted, 12);
  }
  y -= 6;

  if (spec.salutation) {
    drawLine(spec.salutation, font, 11, ink, 10);
  }

  for (const p of spec.paragraphs) {
    drawParagraph(p);
  }

  if (spec.lines?.length) {
    y -= 4;
    for (const { label, value } of spec.lines) {
      ensureRoom(16);
      page.drawText(label, { x: margin, y, size: 10, font, color: muted });
      page.drawText(value, {
        x: a4.width - margin - bold.widthOfTextAtSize(value, 10),
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
    if (spec.signatoryTitle) {
      drawLine(spec.signatoryTitle, font, 9, muted, 2);
    }
  }

  // Footer on every page — a multi-page F&F would otherwise have bare pages.
  const pages = doc.getPages();
  pages.forEach((p, ix) => {
    const label = `Dalnex LLP · Computer-generated document · Page ${ix + 1} of ${pages.length}`;
    p.drawText(label, {
      x: (a4.width - font.widthOfTextAtSize(label, 8)) / 2,
      y: margin / 2,
      size: 8,
      font,
      color: muted,
    });
  });

  return doc.save();
}
