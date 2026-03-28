//
//  ContentView.swift
//  pandora
//
//  Created by Manik Rana on 24/03/26.
//

import AppKit
import SwiftUI

struct ContentView: View {
    private let sidebarWidth: CGFloat = 320
    private let titlebarControlSize: CGFloat = 24

    let projectPath: String
    @ObservedObject var chromeMetrics: WindowChromeMetrics
    @StateObject private var daemonClient: DaemonClient
    @StateObject private var workspaceStore: WorkspaceStore
    @StateObject private var surfaceRegistry: SurfaceRegistry
    @StateObject private var workspaceController = PandoraWorkspaceController()
    @StateObject private var debugLogStore = DebugLogStore.shared
    @State private var keyMonitor: Any?
    @State private var isShowingDiagnostics = false
    @State private var isPresentingAddTerminal = false
    @State private var isSidebarHidden = false

    init(projectPath: String, chromeMetrics: WindowChromeMetrics) {
        self.projectPath = projectPath
        self.chromeMetrics = chromeMetrics

        let daemonClient = DaemonClient(projectPath: projectPath)
        _daemonClient = StateObject(wrappedValue: daemonClient)
        _workspaceStore = StateObject(wrappedValue: WorkspaceStore(daemonClient: daemonClient))
        _surfaceRegistry = StateObject(wrappedValue: SurfaceRegistry.shared)
    }

    var body: some View {
        VStack(spacing: 0) {
            workspaceChromeLayout

            Divider()

            BottomActionBarView(
                store: workspaceStore,
                onFocusVisible: focusVisibleWorkspace,
                onUnfocus: unfocusWorkspace,
                onShowDiagnostics: { isShowingDiagnostics = true }
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onAppear {
            surfaceRegistry.configure(daemonClient: daemonClient)
            workspaceController.bind(store: workspaceStore, surfaceRegistry: surfaceRegistry)
            workspaceController.render(
                workspace: workspaceStore.visibleWorkspace,
                slotsByID: workspaceStore.slotsByID
            )
            workspaceController.synchronizeTerminalFocus()
            surfaceRegistry.onFocusSession = { sessionID in
                Task { @MainActor in
                    workspaceStore.focusSessionFromSurface(sessionID: sessionID)
                }
            }
            surfaceRegistry.onCycleTabs = { forward in
                cycleFocusedTab(forward: forward)
            }
            daemonClient.onOutputChunk = { sessionID, data in
                Task { @MainActor in
                    surfaceRegistry.feedOutput(sessionID: sessionID, data: data)
                }
            }
            daemonClient.connect()
            WorkspaceCloseTabBridge.shared.onCloseFocusedTab = {
                workspaceController.closeFocusedTab()
            }
            installKeyboardMonitor()
            DispatchQueue.main.async {
                if workspaceStore.keyboardNavigationArea == .sidebar {
                    SidebarFocusBridge.shared.focus()
                    workspaceController.synchronizeTerminalFocus()
                }
            }
        }
        .onDisappear {
            surfaceRegistry.onFocusSession = nil
            surfaceRegistry.onCycleTabs = nil
            WorkspaceCloseTabBridge.shared.onCloseFocusedTab = nil
            removeKeyboardMonitor()
        }
        .onChange(of: workspaceStore.visibleWorkspace) { _, workspace in
            workspaceController.render(workspace: workspace, slotsByID: workspaceStore.slotsByID)
            workspaceController.synchronizeTerminalFocus()
            if workspaceStore.keyboardNavigationArea == .sidebar {
                DispatchQueue.main.async {
                    SidebarFocusBridge.shared.focus()
                }
            }
        }
        .onChange(of: workspaceStore.actualFocusedSession?.id) { _, _ in
            workspaceController.synchronizeTerminalFocus()
        }
        .sheet(isPresented: $isShowingDiagnostics) {
            diagnosticsSheet
        }
        .sheet(isPresented: $isPresentingAddTerminal) {
            AddTerminalSheet(store: workspaceStore)
        }
    }

    @ViewBuilder
    private var workspaceChromeLayout: some View {
        if isSidebarHidden {
            mainColumn
        } else {
            HStack(spacing: 0) {
                sidebarColumn
                    .frame(width: sidebarWidth)

                Divider()

                mainColumn
            }
        }
    }

    private var sidebarColumn: some View {
        VStack(spacing: 0) {
            sidebarTopInset
            SidebarShellView(store: workspaceStore, workspaceController: workspaceController)
        }
        .frame(maxHeight: .infinity)
        .background(VisualEffectBackdrop(material: .sidebar, blendingMode: .behindWindow))
    }

    private var mainColumn: some View {
        VStack(spacing: 0) {
            mainTopInset
            mainArea
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var sidebarTopInset: some View {
        topInsetStrip(material: .sidebar) {
            HStack(spacing: 8) {
                Spacer(minLength: 0)

                chromeButton(systemName: "plus") {
                    isPresentingAddTerminal = true
                }

                chromeButton(systemName: "sidebar.left") {
                    toggleSidebar()
                }
            }
            .padding(.leading, chromeMetrics.leadingClearance)
            .padding(.trailing, 12)
        }
    }

    private var mainTopInset: some View {
        topInsetStrip(material: .titlebar) {
            HStack(spacing: 8) {
                if isSidebarHidden {
                    chromeButton(systemName: "sidebar.left") {
                        toggleSidebar()
                    }
                }

                Spacer(minLength: 0)
            }
            .padding(.leading, isSidebarHidden ? chromeMetrics.leadingClearance : 12)
            .padding(.trailing, 12)
        }
    }

    private func topInsetStrip<StripContent: View>(
        material: NSVisualEffectView.Material,
        @ViewBuilder content: () -> StripContent
    ) -> some View {
        ZStack {
            VisualEffectBackdrop(material: material, blendingMode: .behindWindow)
            WindowDragRegionView()

            content()
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .padding(.top, max(0, chromeMetrics.trafficLightCenterYFromTop - (titlebarControlSize / 2)))
        }
        .frame(height: chromeMetrics.rowHeight)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(Color(nsColor: .separatorColor))
                .frame(height: 1)
        }
    }

    private func chromeButton(systemName: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 13, weight: .semibold))
                .frame(width: titlebarControlSize, height: titlebarControlSize)
        }
        .buttonStyle(.plain)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(Color(nsColor: .controlBackgroundColor))
        )
    }

    private func toggleSidebar() {
        isSidebarHidden.toggle()
        if isSidebarHidden {
            if workspaceStore.visibleWorkspace != nil {
                workspaceStore.focusVisibleWorkspace()
            }
        } else {
            workspaceStore.activateSidebarNavigation()
            DispatchQueue.main.async {
                SidebarFocusBridge.shared.focus()
            }
        }
    }

    private var diagnosticsSheet: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Diagnostics")
                    .font(.system(size: 14, weight: .semibold))
                Spacer()
                Button("Done") {
                    isShowingDiagnostics = false
                }
                .keyboardShortcut(.cancelAction)
                .buttonStyle(.bordered)
                Button("Copy") {
                    copyStartupDiagnosticsToClipboard()
                }
                .buttonStyle(.borderless)
            }

            Text("Socket: \(daemonClient.debugSocketPath)")
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(.secondary)

            ScrollView {
                LazyVStack(alignment: .leading, spacing: 6) {
                    ForEach(Array(debugLogStore.lines.enumerated()), id: \.offset) { _, line in
                        Text(line)
                            .font(.system(size: 11, design: .monospaced))
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .padding(10)
            }
            .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
        .padding(16)
        .frame(minWidth: 720, minHeight: 520)
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
            HStack {
                Text("Startup Diagnostics")
                    .font(.system(size: 12, weight: .semibold))
                Spacer()
                Button("Copy") {
                    copyStartupDiagnosticsToClipboard()
                }
                .buttonStyle(.borderless)
                .font(.system(size: 11, weight: .semibold))
                .help("Copy startup diagnostics to clipboard")
            }

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

    private func copyStartupDiagnosticsToClipboard() {
        let lines = debugLogStore.lines.suffix(12)
        var payload = "Socket: \(daemonClient.debugSocketPath)\n"
        if lines.isEmpty == false {
            payload += "\nRecent logs:\n" + lines.joined(separator: "\n")
        }
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString(payload, forType: .string)
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

        // Unmodified keys in sidebar mode — mode-based, not focus-based.
        if modifiers.isEmpty, workspaceStore.keyboardNavigationArea == .sidebar {
            switch event.keyCode {
            case 125:
                workspaceStore.navigateSidebarSelection(offset: 1)
                return true
            case 126:
                workspaceStore.navigateSidebarSelection(offset: -1)
                return true
            case 36, 76: // Return / numpad Enter
                if workspaceStore.visibleWorkspace != nil {
                    focusVisibleWorkspace()
                    return true
                }
            default:
                break
            }
        }

        if modifiers.contains(.command) {
            switch event.keyCode {
            case 13: // Cmd+W
                return closeFocusedTabOrWindow()
            case 12: // Cmd+Q
                NSApp.terminate(nil)
                return true
            case 123: // Cmd+Left
                activateSidebarNavigation()
                return true
            case 124: // Cmd+Right
                if workspaceStore.keyboardNavigationArea == .sidebar {
                    focusVisibleWorkspace()
                    return true
                }
                return false
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

        if modifiers.contains(.command), (event.keyCode == 33 || event.charactersIgnoringModifiers == "[") {
            return cycleFocusedTab(forward: false)
        }

        if modifiers.contains(.command), (event.keyCode == 30 || event.charactersIgnoringModifiers == "]") {
            return cycleFocusedTab(forward: true)
        }

        guard modifiers.isEmpty, shouldHandleUnmodifiedNavigation else {
            return false
        }

        return false
    }

    private func cycleFocusedTab(forward: Bool) -> Bool {
        guard workspaceStore.visibleWorkspace != nil,
              workspaceStore.keyboardNavigationArea == .workspace || NSApp.keyWindow?.firstResponder is GhosttyNSView else {
            return false
        }
        guard let sessionID = workspaceController.selectAdjacentTab(forward: forward) else {
            return true
        }
        _ = surfaceRegistry.focus(sessionID: sessionID, notifyFocusChange: false)
        return true
    }

    private func navigatePane(_ direction: NavigationDirection) -> Bool {
        guard workspaceStore.keyboardNavigationArea == .workspace || isTerminalFocused,
              workspaceController.focusDirection(direction),
              let sessionID = workspaceStore.actualFocusedSession?.id else {
            return false
        }
        return surfaceRegistry.focus(sessionID: sessionID, notifyFocusChange: false)
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

    private var isTerminalFocused: Bool {
        NSApp.keyWindow?.firstResponder is GhosttyNSView
    }

    private func focusVisibleWorkspace() {
        workspaceStore.focusVisibleWorkspace()
        if let sessionID = workspaceStore.focusedSession?.id {
            _ = surfaceRegistry.focus(sessionID: sessionID, notifyFocusChange: false)
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

    @discardableResult
    private func closeFocusedTab() -> Bool {
        guard workspaceStore.visibleWorkspace != nil else { return false }
        return workspaceController.closeFocusedTab()
    }

    @discardableResult
    private func closeFocusedTabOrWindow() -> Bool {
        if closeFocusedTab() {
            return true
        }
        NSApp.keyWindow?.performClose(nil)
        return true
    }
}
