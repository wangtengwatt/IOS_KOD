import { isFirstDay } from '../hooks/useVersion'
import { initSettingsStore } from '../stores/settingsStore'
import platform from '../platform'

function loadPlausible(): Promise<void> {
  if (document.querySelector('script[data-kod-telemetry="plausible"]')) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.defer = true
    script.dataset.kodTelemetry = 'plausible'
    script.dataset.domain = 'app.chatboxai.app'
    script.src = 'https://plausible.midway.run/js/script.local.hash.js'
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Unable to load analytics'))
    document.head.appendChild(script)
  })
}

;(async () => {
  try {
    const settings = await initSettingsStore()
    if (!settings.allowReportingAndTracking) {
      return
    }
    await loadPlausible()

    const version = await platform.getVersion().catch(() => 'unknown')
    const is_first_day = isFirstDay()

    // 设置 Plausible 全局属性
    if (window.plausible) {
      // 为所有后续的 pageview 和事件设置默认属性
      const originalPlausible = window.plausible
      const enhancedPlausible = (event: string, options?: { props?: Record<string, unknown> }) => {
        const enhancedOptions = {
          ...options,
          props: {
            ...options?.props,
            version,
            is_first_day,
          },
        }
        return originalPlausible(event, enhancedOptions)
      }

      // 复制原始函数的队列属性
      if ('q' in originalPlausible && (originalPlausible as unknown as { q: unknown[] }).q) {
        ;(enhancedPlausible as unknown as { q: unknown[] }).q = (originalPlausible as unknown as { q: unknown[] }).q
      }

      window.plausible = enhancedPlausible
    }
  } catch (e) {
    console.error('Failed to initialize Plausible with version:', e)
  }
})()
