import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.rycalories.iron',
  appName: 'Iron',
  webDir: 'dist',
  android: {
    backgroundColor: '#0b0b0d',
    allowMixedContent: false,
  },
  plugins: {
    // Route fetch/XHR through native HTTP on Android.
    //
    // Not a performance tweak: Open Food Facts' search host sends no Access-Control-Allow-Origin,
    // so a WebView fetch to it is blocked before the response is read and the label lookup fails
    // every time. A native request is not subject to CORS. The app makes no other network calls —
    // every asset is local — so this changes nothing else.
    CapacitorHttp: {
      enabled: true,
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_iron',
      iconColor: '#ff8a2a',
    },
  },
};

export default config;
