/**
 * Nothing leaves the phone through Android's own backup. The app keeps its own backups
 * (Documents/Iron, Settings → Export), and Settings → About lists the only things that leave the
 * device; an `allowBackup="true"` manifest with no rules uploads the whole IndexedDB to the
 * owner's Google account behind that list's back. Same shape as db.test.ts's DB_VERSION check: read
 * the real file, not a copy of it.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const MANIFEST = readFileSync(fileURLToPath(new URL('../../android/app/src/main/AndroidManifest.xml', import.meta.url)), 'utf8');

/** The attributes of the one `<application ...>` opening tag. */
function applicationTag(xml: string): string {
  const match = /<application\b[^>]*>/.exec(xml);
  if (!match) throw new Error('AndroidManifest.xml has no <application> element');
  return match[0];
}

describe('AndroidManifest.xml', () => {
  it('turns Android backup off', () => {
    const tag = applicationTag(MANIFEST);
    expect(tag.match(/android:allowBackup="([^"]*)"/g)).toEqual(['android:allowBackup="false"']);
  });

  it('declares no backup rules that would switch it back on for some data', () => {
    const tag = applicationTag(MANIFEST);
    expect(tag).not.toContain('android:fullBackupContent');
    expect(tag).not.toContain('android:dataExtractionRules');
  });
});

describe('Health Connect', () => {
  const PLUGIN = readFileSync(fileURLToPath(new URL('../../node_modules/@capgo/capacitor-health/android/src/main/AndroidManifest.xml', import.meta.url)), 'utf8');
  const health = (xml: string) => [...xml.matchAll(/<uses-permission android:name="(android\.permission\.health\.[A-Z_]+)"([^>]*)\/>/g)];

  it('keeps reading steps and removes every other health permission the plugin declares', () => {
    const kept = health(MANIFEST).filter(([, , rest]) => !rest.includes('tools:node="remove"')).map(([, name]) => name);
    const removed = new Set(health(MANIFEST).filter(([, , rest]) => rest.includes('tools:node="remove"')).map(([, name]) => name));
    expect(kept).toEqual(['android.permission.health.READ_STEPS']);
    // A plugin update that adds a kind of health data has to be removed here too.
    for (const [, name] of health(PLUGIN)) if (name !== 'android.permission.health.READ_STEPS') expect(removed).toContain(name);
    expect(MANIFEST).toContain('xmlns:tools="http://schemas.android.com/tools"');
  });

  it('has the rationale entries Health Connect needs before it will show its permission screen', () => {
    expect(MANIFEST).toContain('<action android:name="androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE" />');
    expect(MANIFEST).toMatch(/<activity-alias[^>]*android:permission="android\.permission\.START_VIEW_PERMISSION_USAGE"[\s\S]*?android\.intent\.action\.VIEW_PERMISSION_USAGE[\s\S]*?android\.intent\.category\.HEALTH_PERMISSIONS[\s\S]*?<\/activity-alias>/);
    expect(MANIFEST).toContain('<package android:name="com.google.android.apps.healthdata" />');
  });
});
