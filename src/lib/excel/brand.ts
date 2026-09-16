// Shared Excel letterhead. writeBrandHeader reserves rows 1–3 and returns the data-header row.
// writeBrandOverlay adds a floating logo without changing register geometry.
//
// Set ws.columns with keys and widths only: its header property writes to row 1 and would overwrite
// the letterhead. Write column labels to the row returned by writeBrandHeader.
import type ExcelJS from 'exceljs';
import { logoAspect, logoPngBase64 } from '@/lib/brand/logo';
import { company } from '@/lib/brand/company';
import { todayIST } from '@/lib/format';

// The row a banded sheet's data header lands on (rows 1–3 are the band).
export const headerRow = 4;

// One embedded copy of the PNG per workbook, however many sheets use it.
const logoIds = new WeakMap<ExcelJS.Workbook, number>();

function logoId(wb: ExcelJS.Workbook): number {
  let id = logoIds.get(wb);
  if (id === undefined) {
    id = wb.addImage({ base64: logoPngBase64, extension: 'png' });
    logoIds.set(wb, id);
  }
  return id;
}

// Float the logo over the sheet at a cell anchor (0-indexed col/row), sized by height in px with
// the artwork's own aspect. Cells underneath stay untouched.
export function writeBrandOverlay(
  wb: ExcelJS.Workbook,
  ws: ExcelJS.Worksheet,
  opts: { col: number; row: number; height: number },
): void {
  ws.addImage(logoId(wb), {
    tl: { col: opts.col, row: opts.row },
    ext: { width: Math.round(opts.height * logoAspect), height: opts.height },
    editAs: 'oneCell',
  });
}

// Write the rows 1–3 letterhead: logo, report title, subtitle (defaulting to "Dalnex LLP ·
// Generated YYYY-MM-DD"). Returns headerRow, where the caller puts its data header.
export function writeBrandHeader(
  wb: ExcelJS.Workbook,
  ws: ExcelJS.Worksheet,
  opts: { title: string; subtitle?: string },
): number {
  ws.getRow(1).height = 26; // clears the 34px logo together with row 2's default height
  writeBrandOverlay(wb, ws, { col: 0, row: 0, height: 34 });

  const title = ws.getCell(2, 1);
  title.value = opts.title;
  title.font = { bold: true, size: 13, color: { argb: 'FF0E7A8F' } }; // --brand

  const subtitle = ws.getCell(3, 1);
  subtitle.value = opts.subtitle ?? `${company} · Generated ${todayIST()}`;
  subtitle.font = { size: 9, color: { argb: 'FF808080' } };

  return headerRow;
}
