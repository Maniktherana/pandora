//
//  PandoraWorkspaceView.swift
//  pandora
//
//  Created by Codex on 25/03/26.
//

import Bonsplit
import SwiftUI
import UniformTypeIdentifiers

struct PandoraWorkspaceView: View {
    @ObservedObject var store: WorkspaceStore
    @ObservedObject var workspaceController: PandoraWorkspaceController
    let surfaceRegistry: SurfaceRegistry
    @State private var isWorkspaceDropTargeted = false

    var body: some View {
        if let workspace = store.visibleWorkspace {
            BonsplitView(controller: workspaceController.bonsplitController) { tab, _ in
                workspaceTabContent(for: tab)
            } emptyPane: { _ in
                emptyPane
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color(nsColor: .windowBackgroundColor))
            .overlay(alignment: .top) {
                Rectangle()
                    .fill(store.keyboardNavigationArea == .workspace ? Color.accentColor : Color.clear)
                    .frame(height: 2)
            }
            .overlay {
                if isWorkspaceDropTargeted {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(Color.accentColor.opacity(0.95), style: StrokeStyle(lineWidth: 3, dash: [10, 6]))
                        .padding(12)
                        .allowsHitTesting(false)
                }
            }
            .onDrop(of: [UTType.text], isTargeted: $isWorkspaceDropTargeted) { providers in
                handleExternalDrop(providers: providers, into: workspace.id)
            }
            .onAppear {
                workspaceController.bind(store: store, surfaceRegistry: surfaceRegistry)
                workspaceController.render(workspace: workspace, slotsByID: store.slotsByID)
                workspaceController.synchronizeTerminalFocus()
                if store.keyboardNavigationArea == .sidebar {
                    DispatchQueue.main.async {
                        SidebarFocusBridge.shared.focus()
                        workspaceController.synchronizeTerminalFocus()
                    }
                }
            }
            .onChange(of: workspace) { _, newWorkspace in
                workspaceController.render(workspace: newWorkspace, slotsByID: store.slotsByID)
                workspaceController.synchronizeTerminalFocus()
                if store.keyboardNavigationArea == .sidebar {
                    DispatchQueue.main.async {
                        SidebarFocusBridge.shared.focus()
                        workspaceController.synchronizeTerminalFocus()
                    }
                }
            }
            .onChange(of: store.keyboardNavigationArea) { _, _ in
                workspaceController.synchronizeTerminalFocus()
            }
            .onChange(of: store.focusedTerminalTarget) { _, _ in
                workspaceController.synchronizeTerminalFocus()
            }
        } else {
            emptyPane
        }
    }

    private var emptyPane: some View {
        VStack(spacing: 8) {
            Image(systemName: "rectangle.split.3x1")
                .font(.system(size: 22))
                .foregroundStyle(.secondary)
            Text("Drop a sidebar process here to open it as a tab")
                .font(.system(size: 13, weight: .medium))
            Text("Use Focus when you want keyboard input to go to the terminal.")
                .font(.system(size: 12))
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(nsColor: .windowBackgroundColor))
    }

    private func handleExternalDrop(providers: [NSItemProvider], into workspaceID: String) -> Bool {
        guard let provider = providers.first else { return false }
        provider.loadItem(forTypeIdentifier: UTType.text.identifier, options: nil) { item, _ in
            let value: String?
            switch item {
            case let data as Data:
                value = String(data: data, encoding: .utf8)
            case let string as String:
                value = string
            case let nsString as NSString:
                value = nsString as String
            default:
                value = nil
            }

            guard let sourceID = value?.trimmingCharacters(in: .whitespacesAndNewlines),
                  sourceID.isEmpty == false else {
                return
            }

            DispatchQueue.main.async {
                store.mergeWorkspaces(sourceID: sourceID, into: workspaceID, mode: .tabs)
            }
        }
        return true
    }

    @ViewBuilder
    private func workspaceTabContent(for tab: Bonsplit.Tab) -> some View {
        if let slotID = workspaceController.slotID(for: tab.id),
           let slot = store.slotsByID[slotID],
           let session = slot.primarySession(using: store.sessionsByID) {
            TerminalSurfaceView(
                sessionID: session.id,
                presentationMode: slot.presentationMode,
                surfaceRegistry: surfaceRegistry
            )
            .id(session.id)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .contentShape(Rectangle())
            .onTapGesture {
                if store.keyboardNavigationArea == .workspace {
                    _ = surfaceRegistry.focus(sessionID: session.id)
                }
            }
        } else {
            emptyPane
        }
    }
}
