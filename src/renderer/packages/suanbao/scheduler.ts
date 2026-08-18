import type { SuanbaoReminder } from '@shared/types/suanbao'
import type { SuanbaoRepository } from './repositories/SuanbaoRepository'

const MAX_TIMER_DELAY = 2_147_000_000

export interface SuanbaoReminderDelivery {
  deliver(reminder: SuanbaoReminder): Promise<void> | void
  reconcile?(reminders: SuanbaoReminder[]): Promise<void> | void
  onError?(reason: unknown): void
}

export const silentReminderDelivery: SuanbaoReminderDelivery = {
  deliver: () => undefined,
}

export function nextReminderTrigger(reminder: SuanbaoReminder, now: number): number | null {
  if (!reminder.recurrence) return null
  const interval = reminder.recurrence === 'daily' ? 24 * 60 * 60_000 : 7 * 24 * 60 * 60_000
  const elapsed = Math.max(0, now - reminder.triggerAt)
  return reminder.triggerAt + (Math.floor(elapsed / interval) + 1) * interval
}

export class SuanbaoReminderScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null
  private reconciling: Promise<void> | null = null
  private started = false
  private readonly onVisibilityChange = () => {
    if (typeof document === 'undefined' || document.visibilityState === 'visible') this.reconcileInBackground()
  }
  private readonly onFocus = () => this.reconcileInBackground()

  constructor(
    private readonly repository: SuanbaoRepository,
    private readonly delivery: SuanbaoReminderDelivery = silentReminderDelivery,
    private readonly now: () => number = Date.now
  ) {}

  async start() {
    if (!this.started) {
      this.started = true
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibilityChange)
      if (typeof window !== 'undefined') window.addEventListener('focus', this.onFocus)
    }
    await this.reconcile()
  }

  async stop() {
    this.started = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibilityChange)
    if (typeof window !== 'undefined') window.removeEventListener('focus', this.onFocus)
    await this.reconciling?.catch(() => undefined)
  }

  reconcile(): Promise<void> {
    if (!this.reconciling) {
      this.reconciling = this.runReconcile().finally(() => {
        this.reconciling = null
      })
    }
    return this.reconciling
  }

  private async runReconcile() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const now = this.now()
    const due = await this.repository.listScheduledReminders(now)
    for (const reminder of due) {
      await this.delivery.deliver(reminder)
      const nextTriggerAt = nextReminderTrigger(reminder, now)
      await this.repository.saveReminder({
        ...reminder,
        triggerAt: nextTriggerAt ?? reminder.triggerAt,
        status: nextTriggerAt === null ? 'fired' : 'scheduled',
        firedAt: now,
        updatedAt: now,
        revision: reminder.revision + 1,
      })
    }
    await this.delivery.reconcile?.(await this.repository.listReminders())
    const next = (await this.repository.listScheduledReminders())[0]
    if (!next || !this.started) return
    const delay = Math.min(MAX_TIMER_DELAY, Math.max(0, next.triggerAt - this.now()))
    this.timer = setTimeout(() => this.reconcileInBackground(), delay)
  }

  private reconcileInBackground() {
    void this.reconcile().catch((reason) => this.delivery.onError?.(reason))
  }
}
