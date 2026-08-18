import { Capacitor, registerPlugin } from '@capacitor/core'
import type { SuanbaoReminder } from '@shared/types/suanbao'

interface KODNotificationsPlugin {
  requestPermissions(): Promise<{ granted: boolean }>
  reconcileReminders(options: {
    reminders: Array<Pick<SuanbaoReminder, 'id' | 'title' | 'triggerAt' | 'timezone' | 'recurrence'>>
  }): Promise<{ scheduled: number; permission: string }>
}

const NativeNotifications = registerPlugin<KODNotificationsPlugin>('KODNotifications')

export async function requestIOSReminderPermission() {
  if (Capacitor.getPlatform() !== 'ios') return false
  return (await NativeNotifications.requestPermissions()).granted
}

export async function reconcileIOSReminders(reminders: SuanbaoReminder[]) {
  if (Capacitor.getPlatform() !== 'ios') return { scheduled: 0, permission: 'unavailable' }
  return NativeNotifications.reconcileReminders({
    reminders: reminders
      .filter((reminder) => reminder.status === 'scheduled')
      .map(({ id, title, triggerAt, timezone, recurrence }) => ({ id, title, triggerAt, timezone, recurrence })),
  })
}
