import SwiftUI

struct PandoraWorkspaceView: View {
    @ObservedObject var store: WorkspaceRuntimeStore
    @ObservedObject var workspaceController: PandoraWorkspaceController
    let surfaceRegistry: SurfaceRegistry

    var body: some View {
        if let workspace = store.visibleWorkspace {
            SplitPaneView(controller: workspaceController.bonsplitController) { tab, _ in
                workspaceTabContent(for: tab)
            } emptyPane: { _ in
                emptyPaneState(store.connectionState == .connecting ? "Starting terminal…" : "Workspace has no active panes.")
            }
            .environment(\.tabBarActionHandler, TabBarActionHandler(onAddTab: { paneID in
                store.createTerminal(in: workspaceController.workspacePaneID(for: paneID))
            }))
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color(nsColor: .windowBackgroundColor))
            .onAppear {
                workspaceController.render(workspace: workspace, slotsByID: store.slotsByID)
            }
        } else {
            emptyPaneState("Preparing workspace…")
        }
    }

    @ViewBuilder
    private func workspaceTabContent(for tab: Tab) -> some View {
        if let slotID = workspaceController.slotID(for: tab.id),
           let slot = store.slotsByID[slotID] {
            let session = slot.primarySession(using: store.sessionsByID)
            TerminalSurfaceView(
                sessionID: session?.id,
                presentationMode: slot.presentationMode,
                surfaceRegistry: surfaceRegistry
            )
            .id(session?.id ?? "pending-\(slot.id)")
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .overlay {
                if let sessionID = session?.id {
                    Rectangle()
                        .fill(Color.black.opacity(isSessionActive(sessionID) ? 0.0 : 0.2))
                        .allowsHitTesting(false)
                }
            }
            .contentShape(Rectangle())
            .onTapGesture {
                if let sessionID = session?.id {
                    _ = surfaceRegistry.focus(sessionID: sessionID)
                }
            }
        } else {
            emptyPaneState("Waiting for session…")
        }
    }

    private func isSessionActive(_ sessionID: String) -> Bool {
        store.actualFocusedSession?.id == sessionID
    }

    private func emptyPaneState(_ message: String) -> some View {
        VStack(spacing: 10) {
            Image(systemName: "terminal")
                .font(.system(size: 24, weight: .medium))
                .foregroundStyle(.secondary)
            Text(message)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(nsColor: .windowBackgroundColor))
    }
}
