// ============================================================================
// The Dalnex letterhead for .xlsx exports. SERVER ONLY (exceljs).
//
// Two modes:
//   writeBrandHeader  — rows 1–3 become a letterhead (logo, title, subtitle)
//                       and the data header moves to HEADER_ROW. For report
//                       sheets whose layout is ours to choose.
//   writeBrandOverlay — a floating logo only; no cell is written and no row is
//                       inserted. For sheets whose geometry is parsed back
//                       (the register layout parseRegister.ts reads).
//
// Call-order gotcha for banded sheets: exceljs's ws.columns setter writes any
// `header` values straight into row 1, over the band. Builders therefore set
// columns with key+width only and write the header row themselves:
//
//   ws.columns = COLUMNS.map(({ key, width }) => ({ key, width }));
//   const headerRow = writeBrandHeader(wb, ws, { title });
//   ws.getRow(headerRow).values = COLUMNS.map((c) => c.header);
// ============================================================================
import type ExcelJS from 'exceljs';
import { LOGO_ASPECT, LOGO_PNG_BASE64 } from '@/lib/brand/logo';
import { COMPANY } from '@/lib/brand/company';
import { todayIST } from '@/lib/format';

/** The row a banded sheet's data header lands on (rows 1–3 are the band). */
export const HEADER_ROW = 4;

// One embedded copy of the PNG per workbook, however many sheets use it.
const logoIds = new WeakMap<ExcelJS.Workbook, number>();

function logoId(wb: ExcelJS.Workbook): number {
  let id = logoIds.get(wb);
  if (id === undefined) {
    id = wb.addImage({ base64: LOGO_PNG_BASE64, extension: 'png' });
    logoIds.set(wb, id);
  }
  return id;
}

/**
 * Float the logo over the sheet at a cell anchor (0-indexed col/row), sized by
 * height in px with the artwork's own aspect. Cells underneath stay untouched.
 */
export function writeBrandOverlay(
  wb: ExcelJS.Workbook,
  ws: ExcelJS.Worksheet,
  opts: { col: number; row: number; height: number },
): void {
  ws.addImage(logoId(wb), {
    tl: { col: opts.col, row: opts.row },
    ext: { width: Math.round(opts.height * LOGO_ASPECT), height: opts.height },
    editAs: 'oneCell',
  });
}

/**
 * Write the rows 1–3 letterhead: logo, report title, subtitle (defaulting to
 * "Dalnex LLP · Generated YYYY-MM-DD"). Returns HEADER_ROW, where the caller
 * puts its data header.
 */
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
  subtitle.value = opts.subtitle ?? `${COMPANY} · Generated ${todayIST()}`;
  subtitle.font = { size: 9, color: { argb: 'FF808080' } };

  return HEADER_ROW;
}
