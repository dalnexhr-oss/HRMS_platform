// Accept explicit calendar dates; never guess ambiguous workbook dates.
function calendarDate(cell, label) {
  const value = cell.value;
  if (value == null || cell.text.trim() === '') {
    return null;
  }
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const raw = cell.text.trim();
  let year;
  let month;
  let day;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  const parts = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(raw);
  if (iso) {
    [, year, month, day] = iso.map(Number);
  } else if (parts && Number(parts[2]) > 12) {
    [, month, day, year] = parts.map(Number);
  } else if (parts && Number(parts[1]) > 12) {
    [, day, month, year] = parts.map(Number);
  } else {
    throw new Error(
      `${label}: ambiguous or unsupported date ${raw}; keep the workbook date explicit.`,
    );
  }
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error(`${label}: invalid calendar date.`);
  }
  return parsed.toISOString().slice(0, 10);
}

export { calendarDate };
