// Renders every app icon file from assets/app-icon/level.svg. Run by hand after changing the
// master (`node scripts/app-icon.mjs`), and commit what it writes; never run in CI.
//
// Android: the adaptive icon's foreground layer is 108 dp of which the launcher shows the middle
// 72, so the icon is drawn at two thirds, centred, on nothing (the tile is the background layer,
// res/drawable/ic_launcher_background.xml). The same file is the splash screen's icon. The plain
// ic_launcher / ic_launcher_round files are the whole tile, for anything that still asks for them.
// Web: the rounded tile at 192 and 512, and the square one for a maskable icon.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(root, 'assets/app-icon/level.svg'), 'utf8').replace(/<!--[\s\S]*?-->/, '');
const res = (path) => join(root, 'android/app/src/main/res', path);
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });

/** One PNG of `size` px: the master at `scale` of it, centred, clipped to `radius`, with or without its tile. */
async function render(out, size, { scale = 1, radius = '0', tile = true } = {}) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>*{margin:0}html,body{background:transparent}
    #box{width:${size}px;height:${size}px;display:grid;place-items:center;overflow:hidden;border-radius:${radius}}
    #box svg{width:${size * scale}px;height:${size * scale}px}${tile ? '' : '#tile{display:none}'}</style><div id="box">${svg}</div>`);
  await page.locator('#box').screenshot({ path: out, omitBackground: true });
}

for (const [name, k] of Object.entries(DENSITIES)) {
  await render(res(`mipmap-${name}/ic_launcher_foreground.png`), 108 * k, { scale: 2 / 3, tile: false });
  await render(res(`mipmap-${name}/ic_launcher.png`), 48 * k, { radius: '22%' });
  await render(res(`mipmap-${name}/ic_launcher_round.png`), 48 * k, { radius: '50%' });
}
await render(join(root, 'public/icons/icon-192.png'), 192, { radius: '22%' });
await render(join(root, 'public/icons/icon-512.png'), 512, { radius: '22%' });
await render(join(root, 'public/icons/icon-512-maskable.png'), 512);
await browser.close();
