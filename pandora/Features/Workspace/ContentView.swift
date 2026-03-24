//
//  ContentView.swift
//  pandora
//
//  Created by Manik Rana on 24/03/26.
//

import AppKit
import Bonsplit
import SwiftUI

struct ContentView: View {
    let projectPath: String
    @StateObject private var daemonClient: DaemonClient
    @StateObject private var workspaceStore: WorkspaceStore
    @StateObject private var surfaceRegistry: SurfaceRegistry
    @StateObject private var workspaceController = PandoraWorkspaceController()
    @StateObject private var debugLogStore = DebugLogStore.shared
    @State private var keyMonitor: Any?

    init(projectPath: String) {
        self.projectPath = projectPath

        let daemonClient = DaemonClient(projectPath: projectPath)
        _daemonClient = StateObject(wrappedValue: daemonClient)
        _workspaceStore = StateObject(wrappedValue: WorkspaceStore(daemonClient: daemonClient))
        _surfaceRegistry = StateObject(wrappedValue: SurfaceRegistry.shared)
    }

    var body: some View {
        VStack(spacing: 0) {
            HSplitView {
                SidebarShellView(store: workspaceStore)
                    .frame(minWidth: 280, idealWidth: 320, maxWidth: 360)

                mainArea
            }

            Divider()

            BottomActionBarView(
                store: workspaceStore,
                onFocusVisible: focusVisibleWorkspace,
                onUnfocus: unfocusWorkspace
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onAppear {
            surfaceRegistry.configure(daemonClient: daemonClient)
            workspaceController.bind(store: workspaceStore, surfaceRegistry: surfaceRegistry)
            daemonClient.onOutputChunk = { sessionID, data in
                Task { @MainActor in
                    surfaceRegistry.feedOutput(sessionID: sessionID, data: data)
                }
            }
            daemonClient.connect()
            installKeyboardMonitor()
        }
        .onDisappear {
            removeKeyboardMonitor()
        }
        .onChange(of: workspaceStore.visibleWorkspace) { _, workspace in
            workspaceController.render(workspace: workspace, slotsByID: workspaceStore.slotsByID)
            workspaceController.synchronizeTerminalFocus()
        }
        .onChange(of: workspaceStore.actualFocusedSession?.id) { _, _ in
            workspaceController.synchronizeTerminalFocus()
        }
    }

    @ViewBuilder
    private var mainArea: some View {
        if workspaceStore.visibleWorkspace == nil {
            emptyState(
                title: startupTitle,
                subtitle: startupSubtitle
            )
        } else {
            PandoraWorkspaceView(
                store: workspaceStore,
                workspaceController: workspaceController,
                surfaceRegistry: surfaceRegistry
            )
        }
    }

    private func emptyState(title: String, subtitle: String) -> some View {
        VStack(spacing: 18) {
            VStack(spacing: 10) {
                Image(systemName: "square.split.2x1")
                    .font(.system(size: 28))
                    .foregroundStyle(.secondary)
                Text(title)
                    .font(.system(size: 14, weight: .medium))
                Text(subtitle)
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
            }

            diagnosticsPanel
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
        .background(Color(nsColor: .windowBackgroundColor))
    }

    private var diagnosticsPanel: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Startup Diagnostics")
                .font(.system(size: 12, weight: .semibold))

            Text("Socket: \(daemonClient.debugSocketPath)")
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(.secondary)

            ScrollView {
                LazyVStack(alignment: .leading, spacing: 4) {
                    ForEach(Array(debugLogStore.lines.suffix(12).enumerated()), id: \.offset) { _, line in
                        Text(line)
                            .font(.system(size: 11, design: .monospaced))
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: 160)
            .padding(10)
            .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
        .frame(width: 560, alignment: .leading)
        .padding(14)
        .background(Color(nsColor: .underPageBackgroundColor), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private var startupTitle: String {
        switch daemonClient.connectionState {
        case .connecting:
            return "Launching Pandora"
        case .connected:
            return "Preparing workspace"
        case .failed:
            return "Preparing workspace"
        case .disconnected:
            return "Launching Pandora"
        }
    }

    private var startupSubtitle: String {
        switch daemonClient.connectionState {
        case .connecting:
            return "Setting up your project workspace."
        case .connected:
            return "Creating the first workspace for this project."
        case .failed:
            return "Pandora is still starting your project workspace."
        case .disconnected:
            return "Setting up your project workspace."
        }
    }

    private func installKeyboardMonitor() {
        guard keyMonitor == nil else { return }
        keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
            handleKeyDown(event) ? nil : event
        }
    }

    private func removeKeyboardMonitor() {
        guard let keyMonitor else { return }
        NSEvent.removeMonitor(keyMonitor)
        self.keyMonitor = nil
    }

    private func handleKeyDown(_ event: NSEvent) -> Bool {
        let modifiers = event.modifierFlags.intersection(.deviceIndependentFlagsMask)

        if modifiers.contains(.command) {
            switch event.keyCode {
            case 123:
                activateSidebarNavigation()
                return true
            case 124:
                if workspaceStore.keyboardNavigationArea == .sidebar {
                    focusVisibleWorkspace()
                    return true
                }
                return navigatePane(.right)
            case 125:
                if workspaceStore.keyboardNavigationArea == .sidebar {
                    workspaceStore.navigateSidebarSelection(offset: 1)
                    return true
                }
                return navigatePane(.down)
            case 126:
                if workspaceStore.keyboardNavigationArea == .sidebar {
                    workspaceStore.navigateSidebarSelection(offset: -1)
                    return true
                }
                return navigatePane(.up)
            default:
                break
            }
        }

        if modifiers.contains(.command), event.charactersIgnoringModifiers == "[" {
            return cycleFocusedTab(forward: false)
        }

        if modifiers.contains(.command), event.charactersIgnoringModifiers == "]" {
            return cycleFocusedTab(forward: true)
        }

        guard modifiers.isEmpty, shouldHandleUnmodifiedNavigation else {
            return false
        }

        switch event.keyCode {
        case 125:
            guard workspaceStore.keyboardNavigationArea == .sidebar else { return false }
            workspaceStore.navigateSidebarSelection(offset: 1)
            return true
        case 126:
            guard workspaceStore.keyboardNavigationArea == .sidebar else { return false }
            workspaceStore.navigateSidebarSelection(offset: -1)
            return true
        case 36, 76:
            guard workspaceStore.keyboardNavigationArea == .sidebar else { return false }
            focusVisibleWorkspace()
            return true
        default:
            return false
        }
    }

    private func cycleFocusedTab(forward: Bool) -> Bool {
        guard workspaceStore.keyboardNavigationArea == .workspace else {
            return false
        }
        guard workspaceController.selectAdjacentTab(forward: forward),
              let sessionID = workspaceStore.actualFocusedSession?.id else {
            return false
        }
        return surfaceRegistry.focus(sessionID: sessionID)
    }

    private func navigatePane(_ direction: NavigationDirection) -> Bool {
        guard workspaceStore.keyboardNavigationArea == .workspace,
              workspaceController.focusDirection(direction),
              let sessionID = workspaceStore.actualFocusedSession?.id else {
            return false
        }
        return surfaceRegistry.focus(sessionID: sessionID)
    }

    private var shouldHandleUnmodifiedNavigation: Bool {
        if workspaceStore.keyboardNavigationArea == .sidebar {
            return true
        }

        guard let responder = NSApp.keyWindow?.firstResponder else {
            return true
        }

        return !(responder is NSTextView)
    }

    private func focusVisibleWorkspace() {
        workspaceStore.focusVisibleWorkspace()
        if let sessionID = workspaceStore.focusedSession?.id {
            _ = surfaceRegistry.focus(sessionID: sessionID)
        }
    }

    private func unfocusWorkspace() {
        workspaceStore.unfocusWorkspace()
        surfaceRegistry.clearFocus()
        SidebarFocusBridge.shared.focus()
    }

    private func activateSidebarNavigation() {
        workspaceStore.activateSidebarNavigation()
        surfaceRegistry.clearFocus()
        SidebarFocusBridge.shared.focus()
    }
}
