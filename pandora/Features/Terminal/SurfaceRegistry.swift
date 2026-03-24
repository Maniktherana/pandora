//
//  SurfaceRegistry.swift
//  pandora
//
//  Created by Manik Rana on 24/03/26.
//

import AppKit
import Foundation
import Combine

@MainActor
final class SurfaceRegistry: ObservableObject {
    static let shared = SurfaceRegistry()

    private var viewsBySessionID: [String: GhosttyNSView] = [:]
    private var pendingOutput: [String: [Data]] = [:]
    private var pendingFocusSessionID: String?
    private weak var focusedView: GhosttyNSView?
    weak var daemonClient: DaemonClient?
    var onFocusSession: ((String) -> Void)?

    func configure(daemonClient: DaemonClient?) {
        self.daemonClient = daemonClient
    }

    func view(
        for sessionID: String?,
        presentationMode: SlotPresentationMode,
        surfaceRegistry: SurfaceRegistry
    ) -> GhosttyNSView {
        let view: GhosttyNSView
        if let sessionID, let existing = viewsBySessionID[sessionID] {
            view = existing
        } else {
            view = GhosttyNSView(frame: .zero)
        }

        view.configure(
            sessionID: sessionID,
            presentationMode: presentationMode,
            surfaceRegistry: surfaceRegistry
        )

        if let sessionID {
            viewsBySessionID[sessionID] = view
            flushPendingOutput(for: sessionID)
            if pendingFocusSessionID == sessionID {
                focus(sessionID: sessionID)
            }
        }

        synchronizeFocus(for: view)

        return view
    }

    func register(_ view: GhosttyNSView, for sessionID: String) {
        viewsBySessionID[sessionID] = view
        flushPendingOutput(for: sessionID)
        synchronizeFocus(for: view)
    }

    func unregister(sessionID: String) {
        if let view = viewsBySessionID.removeValue(forKey: sessionID), focusedView === view {
            focusedView = nil
        }
    }

    func feedOutput(sessionID: String, data: Data) {
        if let view = viewsBySessionID[sessionID] {
            view.feedOutput(data)
        } else {
            pendingOutput[sessionID, default: []].append(data)
        }
    }

    func flushPendingOutput(for sessionID: String) {
        guard let view = viewsBySessionID[sessionID] else { return }
        let buffered = pendingOutput.removeValue(forKey: sessionID) ?? []
        buffered.forEach { view.feedOutput($0) }
    }

    func sendInput(sessionID: String, data: Data) {
        daemonClient?.input(sessionID: sessionID, data: data)
    }

    func sendResize(sessionID: String, cols: Int, rows: Int) {
        daemonClient?.resize(sessionID: sessionID, cols: cols, rows: rows)
    }

    @discardableResult
    func focus(sessionID: String) -> Bool {
        guard let view = viewsBySessionID[sessionID] else {
            pendingFocusSessionID = sessionID
            return false
        }
        pendingFocusSessionID = nil
        view.window?.makeFirstResponder(view)
        claimFocus(for: view)
        return true
    }

    func clearFocus() {
        pendingFocusSessionID = nil
        guard let focusedView else { return }
        focusedView.window?.makeFirstResponder(nil)
        releaseFocus(for: focusedView)
    }

    func claimFocus(for view: GhosttyNSView) {
        if focusedView !== view {
            focusedView?.applyGhosttyFocus(false)
            focusedView = view
        }
        view.applyGhosttyFocus(true)
        if let sessionID = viewsBySessionID.first(where: { $0.value === view })?.key {
            onFocusSession?(sessionID)
        }
    }

    func releaseFocus(for view: GhosttyNSView) {
        if focusedView === view {
            focusedView = nil
        }
        view.applyGhosttyFocus(false)
    }

    func synchronizeFocus(for view: GhosttyNSView) {
        if focusedView === view {
            view.applyGhosttyFocus(true)
        } else {
            view.applyGhosttyFocus(false)
        }
    }
}
