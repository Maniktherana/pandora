//
//  WorkspaceDragBridge.swift
//  pandora
//
//  Created by Manik Rana on 25/03/26.
//

import Combine
import AppKit

enum DragKind: Equatable {
    case workspaceRow(id: String)
    case contentTab
}

@MainActor
final class WorkspaceDragBridge: ObservableObject {
    static let shared = WorkspaceDragBridge()

    @Published private(set) var dragKind: DragKind? = nil
    private(set) var enteredMainWorkspace = false
    private var localMouseUpMonitor: Any?
    private var localKeyMonitor: Any?
    private var resignObserver: NSObjectProtocol?

    /// Backward-compat computed property used by existing observers
    var draggedWorkspaceID: String? {
        if case .workspaceRow(let id) = dragKind { return id }
        return nil
    }

    var isWorkspaceRowDrag: Bool {
        if case .workspaceRow = dragKind { return true }
        return false
    }

    var isContentTabDrag: Bool {
        dragKind == .contentTab
    }

    func beginDragging(workspaceID: String) {
        enteredMainWorkspace = false
        dragKind = .workspaceRow(id: workspaceID)
        installCleanupHooks()
    }

    func beginTabDragging() {
        enteredMainWorkspace = false
        dragKind = .contentTab
        installCleanupHooks()
    }

    func endDragging() {
        enteredMainWorkspace = false
        dragKind = nil
        removeCleanupHooks()
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
