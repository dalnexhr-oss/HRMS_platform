export const assetLinkMaxLength = 1024;

type AssetLinkResult = { ok: true; url: string | null } | { ok: false; error: string };

/** Only web URLs can be saved as a scannable asset destination. Blank removes the mapping. */
export function parseAssetLink(value: unknown): AssetLinkResult {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) {
    return { ok: true, url: null };
  }
  if (!/^https?:\/\//i.test(text) || /[\s\\]/.test(text)) {
    return { ok: false, error: 'Enter a full http:// or https:// link without spaces.' };
  }
  try {
    const url = new URL(text);
    if (!url.hostname || url.username || url.password) {
      return { ok: false, error: 'Use a web link without an embedded username or password.' };
    }
    if (url.href.length > assetLinkMaxLength) {
      return { ok: false, error: `Keep the QR link within ${assetLinkMaxLength} characters.` };
    }
    return { ok: true, url: url.href };
  } catch {
    return { ok: false, error: 'Enter a valid web link for the QR code.' };
  }
}
