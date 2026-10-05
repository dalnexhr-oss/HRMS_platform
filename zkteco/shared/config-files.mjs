import { readFile } from 'node:fs/promises';

export async function readOptional(file) {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return '';
    }
    throw error;
  }
}

export function replaceEnv(text, values) {
  const remaining = new Map(Object.entries(values));
  const seen = new Set();
  const lines = text.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (!match || !Object.hasOwn(values, match[1])) {
      return [line];
    }
    const key = match[1];
    if (seen.has(key)) {
      return [];
    }
    seen.add(key);
    remaining.delete(key);
    return [`${key}=${JSON.stringify(values[key]).replace(/\$/g, '\\$')}`];
  });
  for (const [key, value] of remaining) {
    lines.push(`${key}=${JSON.stringify(value).replace(/\$/g, '\\$')}`);
  }
  return `${lines.join('\n').trim()}\n`;
}
