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
    LocalNotifications: {
      smallIcon: 'ic_stat_iron',
      iconColor: '#ff8a2a',
    },
  },
};

export default config;
