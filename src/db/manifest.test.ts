/**
 * What leaves the phone through Android's own backup: the database and nothing else. Google backup
 * (about once a day) and phone-to-phone transfer copy the WebView's IndexedDB, so a new phone set up
 * from the backup gets the data back (asked for after a stolen phone, November 2026); the WebView's
 * Local Storage, where the Claude key lives, never goes. Same shape as db.test.ts's DB_VERSION check:
 * read the real files, not copies of them. No test can run a real backup and restore: that needs a
 * phone and a Google account.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');
const MANIFEST = read('android/app/src/main/AndroidManifest.xml');
const RULES = read('android/app/src/main/res/xml/data_extraction_rules.xml');

/** The attributes of the one `<application ...>` opening tag. */
function applicationTag(xml: string): string {
  const match = /<application\b[^>]*>/.exec(xml);
  if (!match) throw new Error('AndroidManifest.xml has no <application> element');
  return match[0];
}

/** The include and exclude lines of one section of the rules, comments left out. */
function section(name: 'cloud-backup' | 'device-transfer'): string[] {
  const body = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(RULES.replace(/<!--[\s\S]*?-->/g, ''))?.[1] ?? '';
  return [...body.matchAll(/<(include|exclude)[^>]*\/>/g)].map((m) => m[0].replace(/\s+/g, ' '));
}

describe('AndroidManifest.xml', () => {
  it('turns Android backup on, through the rules file only', () => {
    const tag = applicationTag(MANIFEST);
    expect(tag.match(/android:allowBackup="([^"]*)"/g)).toEqual(['android:allowBackup="true"']);
    expect(tag).toContain('android:dataExtractionRules="@xml/data_extraction_rules"');
    // Android 12 and later read only the rules file; the app runs on nothing older.
    expect(tag).not.toContain('android:fullBackupContent');
    expect(Number(/minSdkVersion = (\d+)/.exec(read('android/variables.gradle'))![1])).toBeGreaterThanOrEqual(31);
  });

  it('backs up the database, never the Local Storage that holds the Claude key, the same in both sections', () => {
    const cloud = section('cloud-backup');
    expect(cloud).toEqual(section('device-transfer'));
    const included = cloud.filter((l) => l.startsWith('<include'));
    expect(included).toEqual(['<include domain="root" path="app_webview/" />']);
    for (const path of ['app_webview/Default/Local Storage/', 'app_webview/Local Storage/']) {
      expect(cloud).toContain(`<exclude domain="root" path="${path}" />`);
    }
  });
});

describe('Health Connect', () => {
  const PLUGIN = readFileSync(fileURLToPath(new URL('../../node_modules/@capgo/capacitor-health/android/src/main/AndroidManifest.xml', import.meta.url)), 'utf8');
  const health = (xml: string) => [...xml.matchAll(/<uses-permission android:name="(android\.permission\.health\.[A-Z_]+)"([^>]*)\/>/g)];

  it('keeps reading steps and weight and removes every other health permission the plugin declares', () => {
    const READ = ['android.permission.health.READ_STEPS', 'android.permission.health.READ_WEIGHT'];
    const kept = health(MANIFEST).filter(([, , rest]) => !rest.includes('tools:node="remove"')).map(([, name]) => name);
    const removed = new Set(health(MANIFEST).filter(([, , rest]) => rest.includes('tools:node="remove"')).map(([, name]) => name));
    expect(kept).toEqual(READ);
    // Nothing is ever written.
    expect(kept.some((n) => n.includes('WRITE'))).toBe(false);
    // A plugin update that adds a kind of health data has to be removed here too.
    for (const [, name] of health(PLUGIN)) if (!READ.includes(name)) expect(removed).toContain(name);
    expect(MANIFEST).toContain('xmlns:tools="http://schemas.android.com/tools"');
  });

  it('has the rationale entries Health Connect needs before it will show its permission screen', () => {
    expect(MANIFEST).toContain('<action android:name="androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE" />');
    expect(MANIFEST).toMatch(/<activity-alias[^>]*android:permission="android\.permission\.START_VIEW_PERMISSION_USAGE"[\s\S]*?android\.intent\.action\.VIEW_PERMISSION_USAGE[\s\S]*?android\.intent\.category\.HEALTH_PERMISSIONS[\s\S]*?<\/activity-alias>/);
    expect(MANIFEST).toContain('<package android:name="com.google.android.apps.healthdata" />');
  });
});

/**
 * The launcher icon (assets/app-icon/level.svg, rendered by scripts/app-icon.mjs). What can be
 * checked here is the wiring and the file sizes Android expects per density: a foreground of the
 * wrong size is drawn too big or too small, and nothing else would say so. How it looks on a real
 * launcher cannot be tested without a phone.
 */
describe('the launcher icon', () => {
  const RES = '../../android/app/src/main/res';
  const size = (path: string): [number, number] => {
    const png = readFileSync(fileURLToPath(new URL(path, import.meta.url)));
    expect(png.subarray(1, 4).toString('latin1'), path).toBe('PNG');
    return [png.readUInt32BE(16), png.readUInt32BE(20)];
  };

  it('is an adaptive icon: the hexagon over the tile, round or not', () => {
    for (const name of ['ic_launcher', 'ic_launcher_round']) {
      const xml = read(`android/app/src/main/res/mipmap-anydpi-v26/${name}.xml`);
      expect(xml).toContain('<background android:drawable="@drawable/ic_launcher_background"/>');
      expect(xml).toContain('<foreground android:drawable="@mipmap/ic_launcher_foreground"/>');
    }
    // The tile is the gradient, not the template's teal grid; the splash screen shows the same icon.
    const tile = read('android/app/src/main/res/drawable/ic_launcher_background.xml');
    expect(tile).toContain('android:type="radial"');
    expect(tile).not.toContain('#26A69A');
    expect(read('android/app/src/main/res/values/styles.xml')).toContain('<item name="windowSplashScreenAnimatedIcon">@mipmap/ic_launcher_foreground</item>');
  });

  it.each([
    ['mdpi', 1],
    ['hdpi', 1.5],
    ['xhdpi', 2],
    ['xxhdpi', 3],
    ['xxxhdpi', 4],
  ] as const)('has every file at the size %s asks for', (density, k) => {
    // A layer is 108 dp, a plain icon 48 dp.
    expect(size(`${RES}/mipmap-${density}/ic_launcher_foreground.png`)).toEqual([108 * k, 108 * k]);
    expect(size(`${RES}/mipmap-${density}/ic_launcher.png`)).toEqual([48 * k, 48 * k]);
    expect(size(`${RES}/mipmap-${density}/ic_launcher_round.png`)).toEqual([48 * k, 48 * k]);
  });

  it('has the web icons the manifest in vite.config.ts names', () => {
    expect(size('../../public/icons/icon-192.png')).toEqual([192, 192]);
    expect(size('../../public/icons/icon-512.png')).toEqual([512, 512]);
    expect(size('../../public/icons/icon-512-maskable.png')).toEqual([512, 512]);
    // The browser-tab icon is drawn as an image, where HTML inside SVG does not render.
    expect(read('public/icons/icon.svg')).not.toContain('foreignObject');
  });
});
