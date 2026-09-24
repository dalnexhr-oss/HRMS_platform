// Normalize workbook display names for exact identity matching.
function cleanName(value) {
  return String(value)
    .replace(/\s*\(on paper DOB[^)]*\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalName(value) {
  return cleanName(value).normalize('NFKC').toLowerCase();
}

export { cleanName, normalName };
