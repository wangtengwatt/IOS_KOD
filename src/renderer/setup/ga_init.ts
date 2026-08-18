import platforms from '@/platform'
import { initSettingsStore } from '@/stores/settingsStore'

function loadGoogleAnalytics(): Promise<void> {
  if (document.querySelector('script[data-kod-telemetry="google"]')) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.async = true
    script.dataset.kodTelemetry = 'google'
    script.src = 'https://www.googletagmanager.com/gtag/js?id=G-B365F44W6E'
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Unable to load analytics'))
    document.head.appendChild(script)
  })
}

;(async () => {
  try {
    const settings = await initSettingsStore()
    if (!settings.allowReportingAndTracking) return
    await loadGoogleAnalytics()
    await platforms.initTracking()
  } catch (e) {
    console.error(e)
  }
})()
