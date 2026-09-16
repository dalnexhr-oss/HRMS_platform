// Register export styles based on the company workbook. Status cells use bold black text and solid
// ARGB fills.

// Attendance status fills from the reference workbook.
export const statusFill: Record<string, string> = {
  P: 'FF70AD47', // green — present (verified in reference)
  HD: 'FFBFBFBF', // grey — half day (verified)
  WO: 'FFFFFF00', // yellow — week off (verified)
  L: 'FFFF0000', // red — leave (verified)
  LM: 'FF806000', // olive — late mark (verified)

  // Additional statuses use the same palette family as the reference workbook.
  OH: 'FF00B0F0', // cyan — official holiday
  CO: 'FFB4A7D6', // violet — comp off
  S: 'FFED7D31', // orange — site
  T: 'FFF4B183', // peach — travel
  AB: 'FFC00000', // dark red— absent
};

// Header fills, likewise taken from the reference sheet.
export const headerFill = {
  // B1 year + B2 month.
  period: 'FFFFC000',
  // Row 3 weekday names.
  weekday: 'FF5B9BD5',
  // Row 5 'Empl. ID' label row.
  emplId: 'FFA4C2F4',
  // Column B on a block's status row (the employee-name cell).
  blockLabel: 'FFBFBFBF',
  // Summary count band header.
  summary: 'FFEDE9E1',
} as const;

// The reference sheet formats every punch/duration cell as h:mm.
export const timeFormat = 'h:mm';

// 'HH:MM' -> an Excel serial time (fraction of a day), or null. The reference stores punches as
// REAL time values formatted h:mm, not text. Writing them the same way keeps the export visually
// identical AND keeps it re-importable: parseRegister's excelValueToMinutes() multiplies a numeric
// cell by 1440 to recover minutes.
export function clockToExcelTime(clock: string | null): number | null {
  if (!clock) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(clock.trim());
  if (!m) return null;
  const mins = Number(m[1]) * 60 + Number(m[2]);
  if (!Number.isFinite(mins) || mins < 0) return null;
  return mins / 1440;
}
