import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.kai.kod',
  appName: 'KOD蒜粒',
  webDir: 'release/app/dist/renderer',
  server: {
    androidScheme: 'https',
    iosScheme: 'https',
  },
}

export default config
