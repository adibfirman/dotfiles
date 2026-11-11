// Herdr Notify: macOS notifications for the agent-notify mod, with the Herdr icon.
//   herdr-notify post <id> <title> <body> <herdr-app path> <action> <args json>
//   herdr-notify status    prints whether macOS lets Herdr Notify post
// A click brings Herdr to the front and runs `herdr-app do <action> <args json>`.
// A new notification with the same <id> replaces the old one.
// It posts nothing while Herdr is the front app: the in-app toast is enough.
//
// Based on herdr/notifier/main.swift from cockpit (https://github.com/quaresc/cockpit),
// MIT License, Copyright (c) 2026 quaresc. See LICENSE in this folder.
// Changed in this dotfiles repo: no buttons and no URLs, the click runs herdr-app
// instead of cockpit.sh, the caller picks the notification id, and nothing is
// posted while Herdr is the front app.
import Cocoa
import UserNotifications

let herdrBundle = "dev.herdr.app"

final class Notifier: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate {
    let center = UNUserNotificationCenter.current()

    func applicationDidFinishLaunching(_ notification: Notification) {
        center.delegate = self
        let args = CommandLine.arguments
        if args.count == 2, args[1] == "status" {
            center.getNotificationSettings { settings in
                let names = ["not asked yet", "denied", "allowed", "provisional", "ephemeral"]
                let status = settings.authorizationStatus.rawValue
                print(status < names.count ? names[status] : "unknown")
                self.quit(after: 0)
            }
        } else if args.count == 8, args[1] == "post" {
            post(id: args[2], title: args[3], body: args[4], cli: args[5], action: args[6], json: args[7])
        } else {
            // Launched by a click: the response arrives through the delegate, then the app leaves.
            quit(after: 10)
        }
    }

    func post(id: String, title: String, body: String, cli: String, action: String, json: String) {
        if NSWorkspace.shared.frontmostApplication?.bundleIdentifier == herdrBundle {
            print("skipped: Herdr is the front app")
            quit(after: 0)
            return
        }
        center.requestAuthorization(options: [.alert, .sound]) { granted, error in
            if !granted {
                FileHandle.standardError.write("herdr-notify: not allowed (\(error?.localizedDescription ?? "denied in System Settings"))\n".data(using: .utf8)!)
            }
            let content = UNMutableNotificationContent()
            content.title = title
            content.body = body
            content.sound = .default
            content.userInfo = ["cli": cli, "action": action, "json": json]
            let request = UNNotificationRequest(identifier: id, content: content, trigger: nil)
            self.center.add(request) { error in
                if let error {
                    FileHandle.standardError.write("herdr-notify: \(error.localizedDescription)\n".data(using: .utf8)!)
                }
                self.quit(after: 0.3)
            }
        }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler done: @escaping () -> Void) {
        let info = response.notification.request.content.userInfo
        if response.actionIdentifier == UNNotificationDefaultActionIdentifier,
           let cli = info["cli"] as? String, let action = info["action"] as? String, let json = info["json"] as? String {
            if let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: herdrBundle) {
                NSWorkspace.shared.openApplication(at: url, configuration: NSWorkspace.OpenConfiguration())
            }
            let task = Process()
            task.executableURL = URL(fileURLWithPath: cli)
            task.arguments = ["do", action, json]
            if (try? task.run()) != nil { task.waitUntilExit() }
        }
        done()
        quit(after: 0.5)
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler show: @escaping (UNNotificationPresentationOptions) -> Void) {
        show([.banner, .sound, .list])
    }

    func quit(after seconds: Double) {
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds) { NSApp.terminate(nil) }
    }
}

let app = NSApplication.shared
let notifier = Notifier()
app.delegate = notifier
app.setActivationPolicy(.prohibited)
app.run()
