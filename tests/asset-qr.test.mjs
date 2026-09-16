import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import sharp from 'sharp';
import jsQR from 'jsqr';
import { parseAssetLink } from '../src/lib/asset-link.ts';
import { AssetQrCode } from '../src/components/assets/AssetQrCode.tsx';

test('asset links accept web destinations and allow removing a mapping', () => {
  assert.deepEqual(parseAssetLink(' https://example.com/asset/42?q=abc#details '), {
    ok: true,
    url: 'https://example.com/asset/42?q=abc#details',
  });
  assert.deepEqual(parseAssetLink(''), { ok: true, url: null });
  assert.deepEqual(parseAssetLink(null), { ok: true, url: null });
  assert.equal(parseAssetLink('http://localhost:3000/assets').ok, true);
});

test('asset links reject identifiers, unsafe protocols, credentials, and oversized URLs', () => {
  for (const value of [
    'SERIAL-123',
    '/assets/42',
    'javascript:alert(1)',
    'data:text/html,x',
    '//example.com',
    'https://user:password@example.com',
    'https://',
    'https://example.com/a b',
    'https://example.com/\\x',
    `https://example.com/${'x'.repeat(1024)}`,
  ]) {
    assert.equal(parseAssetLink(value).ok, false, value);
  }
});

test('unconfigured and invalid asset links do not render a misleading QR', () => {
  for (const url of [null, '', 'SERIAL-123', 'javascript:alert(1)']) {
    assert.doesNotMatch(
      renderToStaticMarkup(createElement(AssetQrCode, { url, name: 'Laptop' })),
      /<svg/,
    );
  }
});

test('rendered QR scans to the saved destination, including a long URL', async () => {
  for (const url of [
    'https://example.com/assets/laptop-42?view=details#owner',
    `https://example.com/assets/42?token=${'abcdef0123456789'.repeat(50)}`,
    `https://example.com/${'a'.repeat(1004)}`,
  ]) {
    const markup = renderToStaticMarkup(createElement(AssetQrCode, { url, name: 'Laptop' }));
    const svg = markup.match(/<svg[\s\S]*?<\/svg>/)?.[0];
    assert.ok(svg);
    const { data, info } = await sharp(Buffer.from(svg))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const decoded = jsQR(new Uint8ClampedArray(data), info.width, info.height);
    assert.equal(decoded?.data, url);
    assert.match(markup, /Open linked page/);
  }
});
