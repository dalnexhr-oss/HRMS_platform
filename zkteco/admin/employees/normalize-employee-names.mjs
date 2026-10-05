// Normalize workbook display names for exact identity matching.
function cleanEmployeeName(value) {
  return String(value)
    .replace(/\s*\(on paper DOB[^)]*\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeEmployeeName(value) {
  return cleanEmployeeName(value).normalize('NFKC').toLowerCase();
}

export { cleanEmployeeName, normalizeEmployeeName };
