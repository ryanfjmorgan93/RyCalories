import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ deviceScaleFactor: 1 });
const glyph = (fill, pad) => `<g fill="${fill}" transform="translate(${pad} ${pad}) scale(${(512 - 2 * pad) / 512})">
    <rect x="72" y="196" width="40" height="120" rx="12"/><rect x="120" y="164" width="48" height="184" rx="14"/>
    <rect x="344" y="164" width="48" height="184" rx="14"/><rect x="400" y="196" width="40" height="120" rx="12"/>
    <rect x="168" y="236" width="176" height="40" rx="10"/></g>`;
const svgLegacy = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#0b0b0d"/>${glyph('#ff8a2a', 0)}</svg>`;
const svgRound = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><circle cx="256" cy="256" r="256" fill="#0b0b0d"/>${glyph('#ff8a2a', 40)}</svg>`;
const svgFg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${glyph('#ff8a2a', 96)}</svg>`; // adaptive: keep within the safe zone
const svgStat = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${glyph('#ffffff', 40)}</svg>`; // notification: white on transparent
async function render(svg, size, out) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent"><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" width="${size}" height="${size}" style="display:block"/></body></html>`);
  writeFileSync(out, await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } }));
}
const res = 'android/app/src/main/res';
const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, m] of Object.entries(dens)) {
  mkdirSync(`${res}/mipmap-${d}`, { recursive: true });
  mkdirSync(`${res}/drawable-${d}`, { recursive: true });
  await render(svgLegacy, Math.round(48 * m), `${res}/mipmap-${d}/ic_launcher.png`);
  await render(svgRound, Math.round(48 * m), `${res}/mipmap-${d}/ic_launcher_round.png`);
  await render(svgFg, Math.round(108 * m), `${res}/mipmap-${d}/ic_launcher_foreground.png`);
  await render(svgStat, Math.round(24 * m), `${res}/drawable-${d}/ic_stat_iron.png`);
}
await browser.close();
console.log('icons ok');
