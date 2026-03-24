//
//  PandoraWorkspaceView.swift
//  pandora
//
//  Created by Codex on 25/03/26.
//

import Bonsplit
import SwiftUI

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
            .dropDestination(for: String.self, isTargeted: $isWorkspaceDropTargeted) { items, _ in
                guard let sourceID = items.first else { return false }
                store.mergeWorkspaces(sourceID: sourceID, into: workspace.id, mode: .tabs)
                return true
            }
            .onAppear {
                workspaceController.bind(store: store, surfaceRegistry: surfaceRegistry)
                workspaceController.render(workspace: workspace, slotsByID: store.slotsByID)
            }
            .onChange(of: workspace) { _, newWorkspace in
                workspaceController.render(workspace: newWorkspace, slotsByID: store.slotsByID)
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

    @ViewBuilder
    private func workspaceTabContent(for tab: Tab) -> some View {
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
