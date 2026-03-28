//
//  AppDelegate.swift
//  pandora
//
//  Created by Manik Rana on 24/03/26.
//

import AppKit
import Darwin
import Foundation

class AppDelegate: NSObject, NSApplicationDelegate {

    var mainWindow: ProjectWindow?
    var daemonProcess: Process?
    private let debugLogStore = DebugLogStore.shared

    func applicationDidFinishLaunching(_ notification: Notification) {
        // suppress the default empty window AppKit creates
        NSApp.setActivationPolicy(.regular)
        NSWindow.allowsAutomaticWindowTabbing = false
        debugLogStore.append("Application did finish launching", source: "app")

        // open last project or show project picker
        openInitialProject()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool {
        // don't quit — switch to accessory mode to keep menu bar item alive
        // (daemon keeps running regardless)
        NSApp.setActivationPolicy(.accessory)
        return false
    }

    func applicationShouldHandleReopen(_ app: NSApplication, hasVisibleWindows: Bool) -> Bool {
        NSApp.setActivationPolicy(.regular)
        openInitialProject()
        return true
    }

    func applicationWillTerminate(_ notification: Notification) {
        stopDaemonIfNeeded()
    }

    // Open the current project window.
    // Single-project mode is the current implementation target.
    func openInitialProject() {
        guard mainWindow == nil else {
            // Window already exists — bring it to front
            mainWindow?.showWindow(nil)
            mainWindow?.window?.makeKeyAndOrderFront(nil)
            return
        }
        let projectPath = NSHomeDirectory()
        debugLogStore.append("Opening project at \(projectPath)", source: "app")
        launchPandoraDaemon(projectPath: projectPath)
        let projectWindow = ProjectWindow(projectPath: projectPath)
        projectWindow.showWindow(nil)
        projectWindow.window?.makeKeyAndOrderFront(nil)
        self.mainWindow = projectWindow
        // Bring app to front — needed when launching from launchd or Dock
        NSApp.activate(ignoringOtherApps: true)
    }

    private func launchPandoraDaemon(projectPath: String) {
        guard daemonProcess == nil else { return }

        let daemonExecutable = (Bundle.main.resourcePath as NSString?)?
            .appendingPathComponent("pandorad")
        if let daemonExecutable, FileManager.default.isExecutableFile(atPath: daemonExecutable) {
            debugLogStore.append("Launching bundled pandorad", source: "app")
            launchProcess(
                executableURL: URL(fileURLWithPath: daemonExecutable),
                arguments: [projectPath],
                currentDirectoryURL: nil
            )
            return
        }

        #if DEBUG
        let sourceURL = URL(fileURLWithPath: #filePath)
        let repoRoot = sourceURL
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let daemonDirectory = repoRoot.appendingPathComponent("daemon", isDirectory: true)
        let daemonEntry = daemonDirectory.appendingPathComponent("src/index.ts")

        guard FileManager.default.fileExists(atPath: daemonEntry.path) else {
            NSLog("AppDelegate: debug pandorad entry not found at %@", daemonEntry.path)
            debugLogStore.append("Debug pandorad entry not found at \(daemonEntry.path)", source: "app")
            return
        }

        guard let bunExecutable = resolveBunExecutablePath() else {
            debugLogStore.append("Could not find Bun for dev pandorad launch", source: "app")
            return
        }

        debugLogStore.append("Launching dev pandorad from \(daemonEntry.path) with \(bunExecutable)", source: "app")
        launchProcess(
            executableURL: URL(fileURLWithPath: bunExecutable),
            arguments: ["run", daemonEntry.path, projectPath],
            currentDirectoryURL: daemonDirectory
        )
        #endif
    }

    private func resolveBunExecutablePath() -> String? {
        let environment = ProcessInfo.processInfo.environment
        let candidates: [String] = [
            environment["BUN_BIN"],
            environment["HOME"].map { "\($0)/.bun/bin/bun" },
            "/opt/homebrew/bin/bun",
            "/usr/local/bin/bun"
        ].compactMap { $0 }

        for candidate in candidates where FileManager.default.isExecutableFile(atPath: candidate) {
            return candidate
        }

        return nil
    }

    private func launchProcess(
        executableURL: URL,
        arguments: [String],
        currentDirectoryURL: URL?
    ) {
        let process = Process()
        process.executableURL = executableURL
        process.arguments = arguments
        process.currentDirectoryURL = currentDirectoryURL
        #if DEBUG
        let devPandoraHome = (NSTemporaryDirectory() as NSString).appendingPathComponent("pandora-dev-home")
        var environment = ProcessInfo.processInfo.environment
        environment["PANDORA_HOME"] = devPandoraHome
        environment["PANDORA_PARENT_PID"] = String(ProcessInfo.processInfo.processIdentifier)
        process.environment = environment
        #endif
        process.standardOutput = Pipe()
        process.standardError = Pipe()

        let errorPipe = Pipe()
        process.standardError = errorPipe

        errorPipe.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            guard data.isEmpty == false, let output = String(data: data, encoding: .utf8) else { return }
            NSLog("pandorad stderr: %@", output.trimmingCharacters(in: .whitespacesAndNewlines))
            Task { @MainActor in
                DebugLogStore.shared.append(output, source: "daemon stderr")
            }
        }

        if let outputPipe = process.standardOutput as? Pipe {
            outputPipe.fileHandleForReading.readabilityHandler = { handle in
                let data = handle.availableData
                guard data.isEmpty == false, let output = String(data: data, encoding: .utf8) else { return }
                Task { @MainActor in
                    DebugLogStore.shared.append(output, source: "daemon stdout")
                }
            }
        }

        do {
            try process.run()
            daemonProcess = process
            process.terminationHandler = { [weak self] terminatedProcess in
                Task { @MainActor in
                    if self?.daemonProcess === terminatedProcess {
                        self?.daemonProcess = nil
                    }
                }
            }
            NSLog("AppDelegate: launched pandorad via %@", executableURL.path)
            debugLogStore.append("Launched pandorad via \(executableURL.path)", source: "app")
        } catch {
            NSLog("AppDelegate: failed to launch pandorad: %@", error.localizedDescription)
            debugLogStore.append("Failed to launch pandorad: \(error.localizedDescription)", source: "app")
        }
    }

    private func stopDaemonIfNeeded() {
        guard let daemonProcess else { return }
        if daemonProcess.isRunning {
            daemonProcess.terminate()
            DispatchQueue.global().asyncAfter(deadline: .now() + 1.0) {
                if daemonProcess.isRunning {
                    kill(daemonProcess.processIdentifier, SIGKILL)
                }
            }
        }
        self.daemonProcess = nil
    }
}
