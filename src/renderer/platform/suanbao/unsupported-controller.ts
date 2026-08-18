import type { SuanbaoPlatformCapabilities } from '@shared/types/suanbao'
import type { SuanbaoPlatformController } from './interface'

export class UnsupportedSuanbaoPlatformController implements SuanbaoPlatformController {
  constructor(private readonly reason: string) {}

  getCapabilities(): Promise<SuanbaoPlatformCapabilities> {
    const ios = typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent)
    return Promise.resolve({
      overlay: 'in-app',
      notifications: ios,
      backgroundScheduling: ios ? 'reliable' : 'foreground-only',
      geolocation: typeof navigator !== 'undefined' && 'geolocation' in navigator,
      systemCalendarRead: false,
      reason: this.reason,
    })
  }

  setEnabled(_enabled: boolean): Promise<void> {
    return Promise.resolve()
  }
  show(): Promise<void> {
    return Promise.resolve()
  }
  hide(): Promise<void> {
    return Promise.resolve()
  }
  openMainWindow(): Promise<void> {
    return Promise.resolve()
  }
}
