import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
const svg = readFileSync('public/icons/icon.svg', 'utf8');
const maskable = svg.replace('rx="112"', 'rx="0"');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
async function render(src, size, out) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent"><img src="data:image/svg+xml;base64,${Buffer.from(src).toString('base64')}" width="${size}" height="${size}" style="display:block"/></body></html>`);
  const buf = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  writeFileSync(out, buf);
  console.log('wrote', out, buf.length);
}
await render(svg, 192, 'public/icons/icon-192.png');
await render(svg, 512, 'public/icons/icon-512.png');
await render(maskable, 512, 'public/icons/icon-512-maskable.png');
await browser.close();
