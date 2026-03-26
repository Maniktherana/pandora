//
//  WorkspaceDragBridge.swift
//  pandora
//
//  Created by Manik Rana on 25/03/26.
//

import Combine
import AppKit

@MainActor
final class WorkspaceDragBridge: ObservableObject {
    static let shared = WorkspaceDragBridge()

    @Published private(set) var draggedWorkspaceID: String?
    private(set) var enteredMainWorkspace = false
    private var localMouseUpMonitor: Any?
    private var localKeyMonitor: Any?
    private var resignObserver: NSObjectProtocol?

    func beginDragging(workspaceID: String) {
        enteredMainWorkspace = false
        installCleanupHooks()
        DispatchQueue.main.async { [weak self] in
            self?.draggedWorkspaceID = workspaceID
        }
    }

    func endDragging() {
        enteredMainWorkspace = false
        removeCleanupHooks()
        DispatchQueue.main.async { [weak self] in
            self?.draggedWorkspaceID = nil
        }
    }

    func markEnteredMainWorkspace() {
        enteredMainWorkspace = true
    }

    private func installCleanupHooks() {
        guard localMouseUpMonitor == nil, localKeyMonitor == nil, resignObserver == nil else { return }

        localMouseUpMonitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseUp, .rightMouseUp]) { [weak self] event in
            Task { @MainActor [weak self] in
                self?.endDragging()
            }
            return event
        }

        localKeyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            if event.keyCode == 53 {
                Task { @MainActor [weak self] in
                    self?.endDragging()
                }
                return nil
            }
            return event
        }

        resignObserver = NotificationCenter.default.addObserver(
            forName: NSApplication.didResignActiveNotification,
            object: NSApp,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.endDragging()
            }
        }
    }

    private func removeCleanupHooks() {
        if let localMouseUpMonitor {
            NSEvent.removeMonitor(localMouseUpMonitor)
            self.localMouseUpMonitor = nil
        }

        if let localKeyMonitor {
            NSEvent.removeMonitor(localKeyMonitor)
            self.localKeyMonitor = nil
        }

        if let resignObserver {
            NotificationCenter.default.removeObserver(resignObserver)
            self.resignObserver = nil
        }
    }
}
