//
//  SurfaceRegistry.swift
//  pandora
//
//  Created by Manik Rana on 24/03/26.
//

import AppKit
import Combine
import Foundation

@MainActor
final class SurfaceRegistry: ObservableObject {
    static let shared = SurfaceRegistry()
    let objectWillChange = ObservableObjectPublisher()

    private var viewsBySessionID: [String: GhosttyNSView] = [:]
    private var pendingOutput: [String: [Data]] = [:]
    private var pendingFocusSessionID: String?
    private(set) var focusedSessionID: String?
    weak var daemonClient: DaemonClient?
    var onFocusSession: ((String) -> Void)?
    var onCycleTabs: ((Bool) -> Bool)?

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
            if pendingFocusSessionID == sessionID || focusedSessionID == sessionID {
                DispatchQueue.main.async { [weak self] in
                    guard let self else { return }
                    _ = self.focus(sessionID: sessionID, notifyFocusChange: false)
                }
            }
        }

        synchronizeFocus(for: view)

        return view
    }

    func register(_ view: GhosttyNSView, for sessionID: String) {
        viewsBySessionID[sessionID] = view
        flushPendingOutput(for: sessionID)
        if pendingFocusSessionID == sessionID || focusedSessionID == sessionID {
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                _ = self.focus(sessionID: sessionID, notifyFocusChange: false)
            }
        } else {
            synchronizeFocus(for: view)
        }
    }

    func unregister(sessionID: String) {
        if viewsBySessionID.removeValue(forKey: sessionID) != nil, focusedSessionID == sessionID {
            focusedSessionID = nil
            pendingFocusSessionID = nil
            applyFocusState()
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
    func focus(sessionID: String, notifyFocusChange: Bool = true) -> Bool {
        guard let view = viewsBySessionID[sessionID] else {
            focusedSessionID = sessionID
            pendingFocusSessionID = sessionID
            return false
        }
        focusedSessionID = sessionID
        pendingFocusSessionID = nil
        view.window?.makeFirstResponder(view)
        applyFocusState()
        if notifyFocusChange {
            DispatchQueue.main.async { [weak self] in
                self?.onFocusSession?(sessionID)
            }
        }
        return true
    }

    func clearFocus() {
        pendingFocusSessionID = nil
        focusedSessionID = nil
        // Force-tell ghostty that every surface is unfocused, bypassing the
        // `isGhosttyFocused` guard. This ensures cursor blinking stops when entering
        // sidebar mode even if our tracked state diverged from ghostty's internal state.
        viewsBySessionID.values.forEach { $0.forceGhosttyUnfocus() }
        // Only resign first responder if a terminal currently holds it.
        if NSApp.keyWindow?.firstResponder is GhosttyNSView {
            NSApp.keyWindow?.makeFirstResponder(nil)
        }
    }

    func claimFocus(for view: GhosttyNSView) {
        if let sessionID = viewsBySessionID.first(where: { $0.value === view })?.key {
            focusedSessionID = sessionID
            pendingFocusSessionID = nil
            applyFocusState()
            DispatchQueue.main.async { [weak self] in
                self?.onFocusSession?(sessionID)
            }
        } else {
            applyFocusState()
        }
    }

    func releaseFocus(for view: GhosttyNSView) {
        if let sessionID = viewsBySessionID.first(where: { $0.value === view })?.key,
           focusedSessionID == sessionID {
            focusedSessionID = nil
            pendingFocusSessionID = nil
        }
        applyFocusState()
    }

    func synchronizeFocus(for view: GhosttyNSView) {
        applyFocusState()
    }

    func handleCommandBracket(forward: Bool) -> Bool {
        onCycleTabs?(forward) ?? false
    }

    private func applyFocusState() {
        for (sessionID, view) in viewsBySessionID {
            view.applyRegistryFocus(sessionID == focusedSessionID)
        }
    }
}
