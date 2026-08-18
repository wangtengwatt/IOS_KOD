import Capacitor
import Foundation
import UserNotifications

@objc(NotificationPlugin)
public final class NotificationPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NotificationPlugin"
    public let jsName = "KODNotifications"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "requestPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reconcileReminders", returnType: CAPPluginReturnPromise)
    ]

    private let prefix = "kod.reminder."

    @objc public func requestPermissions(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { granted, error in
            if let error {
                call.reject("无法请求通知权限", nil, error)
                return
            }
            call.resolve(["granted": granted])
        }
    }

    @objc public func reconcileReminders(_ call: CAPPluginCall) {
        let raw = call.getArray("reminders", JSObject.self) ?? []
        let center = UNUserNotificationCenter.current()
        center.getNotificationSettings { settings in
            guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else {
                call.resolve(["scheduled": 0, "permission": self.permissionName(settings.authorizationStatus)])
                return
            }
            center.getPendingNotificationRequests { existing in
                let existingIds = existing.map(\.identifier).filter { $0.hasPrefix(self.prefix) }
                let desiredIds = Set(raw.compactMap { $0["id"] as? String }.map { self.prefix + $0 })
                center.removePendingNotificationRequests(withIdentifiers: existingIds.filter { !desiredIds.contains($0) })

                let group = DispatchGroup()
                let lock = NSLock()
                var scheduled = 0
                var firstError: Error?
                for value in raw {
                    guard let id = value["id"] as? String,
                          let title = value["title"] as? String,
                          let triggerAt = value["triggerAt"] as? NSNumber,
                          triggerAt.doubleValue > Date().timeIntervalSince1970 * 1000 else { continue }
                    let content = UNMutableNotificationContent()
                    content.title = "KOD 蒜宝提醒"
                    content.body = title
                    content.sound = .default
                    content.userInfo = ["route": "suanbao-settings", "reminderId": id]
                    let date = Date(timeIntervalSince1970: triggerAt.doubleValue / 1000)
                    let recurrence = value["recurrence"] as? String
                    let trigger: UNNotificationTrigger
                    if recurrence == "daily" {
                        trigger = UNCalendarNotificationTrigger(
                            dateMatching: Calendar.current.dateComponents([.hour, .minute], from: date), repeats: true)
                    } else if recurrence == "weekly" {
                        trigger = UNCalendarNotificationTrigger(
                            dateMatching: Calendar.current.dateComponents([.weekday, .hour, .minute], from: date), repeats: true)
                    } else {
                        trigger = UNTimeIntervalNotificationTrigger(
                            timeInterval: max(1, date.timeIntervalSinceNow), repeats: false)
                    }
                    group.enter()
                    center.add(UNNotificationRequest(identifier: self.prefix + id, content: content, trigger: trigger)) { error in
                        lock.lock()
                        if let error, firstError == nil { firstError = error }
                        if error == nil { scheduled += 1 }
                        lock.unlock()
                        group.leave()
                    }
                }
                group.notify(queue: .main) {
                    if let firstError {
                        call.reject("无法安排本地提醒", nil, firstError)
                    } else {
                        call.resolve(["scheduled": scheduled, "permission": "granted"])
                    }
                }
            }
        }
    }

    private func permissionName(_ status: UNAuthorizationStatus) -> String {
        switch status {
        case .authorized: return "granted"
        case .provisional: return "provisional"
        case .denied: return "denied"
        case .notDetermined: return "prompt"
        case .ephemeral: return "limited"
        @unknown default: return "unavailable"
        }
    }
}
