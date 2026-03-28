//
//  PandoraWorkspaceView.swift
//  pandora
//
//  Created by Manik Rana on 25/03/26.
//

import SwiftUI
import UniformTypeIdentifiers

struct PandoraWorkspaceView: View {
    @ObservedObject var store: WorkspaceStore
    @ObservedObject var workspaceController: PandoraWorkspaceController
    let surfaceRegistry: SurfaceRegistry

    var body: some View {
        if let workspace = store.visibleWorkspace {
            SplitPaneView(controller: workspaceController.bonsplitController) { tab, _ in
                workspaceTabContent(for: tab)
            } emptyPane: { _ in
                emptyPane
            }
            .environment(\.externalPaneDropHandler, ExternalPaneDropHandler(
                supportedTypes: [.text],
                onDragUpdated: {
                    WorkspaceDragBridge.shared.markEnteredMainWorkspace()
                },
                onDrop: { paneID, zone, providers in
                    guard let workspacePaneID = workspaceController.workspacePaneID(for: paneID) else {
                        WorkspaceDragBridge.shared.endDragging()
                        return false
                    }
                    return handleWorkspaceDrop(
                        providers: providers,
                        into: workspace.id,
                        paneID: workspacePaneID,
                        zone: zone
                    )
                }
            ))
            .overlay(alignment: .top) {
                Rectangle()
                    .fill(store.keyboardNavigationArea == .workspace ? Color.accentColor : Color.clear)
                    .frame(height: 2)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color(nsColor: .windowBackgroundColor))
        } else {
            emptyPane
                .onDrop(
                    of: [UTType.text],
                    delegate: EmptyWorkspaceDropDelegate(
                        isValidWorkspaceID: { id in
                            store.workspaceEntries.contains(where: { $0.id == id })
                        },
                        onActivateWorkspace: { sourceID in
                            store.selectSidebarWorkspace(id: sourceID)
                        }
                    )
                )
        }
    }

    private var emptyPane: some View {
        VStack(spacing: 8) {
            Image(systemName: "rectangle.split.3x1")
                .font(.system(size: 22))
                .foregroundStyle(.secondary)
            Text("Drop a sidebar process here to open it as a tab or split")
                .font(.system(size: 13, weight: .medium))
            Text("Use the center to tab, or the edges to split the workspace.")
                .font(.system(size: 12))
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(nsColor: .windowBackgroundColor))
    }

    private func handleWorkspaceDrop(
        providers: [NSItemProvider],
        into workspaceID: String,
        paneID: UUID,
        zone: DropZone
    ) -> Bool {
        guard let provider = providers.first else { return false }
        let validWorkspaceIDs = Set(store.workspaceEntries.map(\.id))
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
                  sourceID.isEmpty == false,
                  validWorkspaceIDs.contains(sourceID) else {
                DispatchQueue.main.async {
                    WorkspaceDragBridge.shared.endDragging()
                }
                return
            }

            let intent: WorkspaceDropIntent = {
                switch zone {
                case .center: return .tabs
                case .left: return .splitLeft
                case .right: return .splitRight
                case .top: return .splitUp
                case .bottom: return .splitDown
                }
            }()

            DispatchQueue.main.async {
                WorkspaceDragBridge.shared.endDragging()
                store.mergeWorkspace(
                    sourceID: sourceID,
                    into: workspaceID,
                    targetPaneID: paneID,
                    intent: intent
                )
            }
        }
        return true
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
                        .fill(Color.black.opacity(isSessionActive(sessionID) ? 0.0 : 0.22))
                        .allowsHitTesting(false)
                }
            }
            .contentShape(Rectangle())
            .onTapGesture {
                if store.keyboardNavigationArea == .workspace,
                   let sessionID = session?.id {
                    _ = surfaceRegistry.focus(sessionID: sessionID)
                }
            }
        } else {
            emptyPane
        }
    }

    private func isSessionActive(_ sessionID: String) -> Bool {
        guard store.keyboardNavigationArea == .workspace else { return false }
        return store.actualFocusedSession?.id == sessionID
    }
}

private struct EmptyWorkspaceDropDelegate: DropDelegate {
    let isValidWorkspaceID: (String) -> Bool
    let onActivateWorkspace: (String) -> Void

    func validateDrop(info: DropInfo) -> Bool {
        WorkspaceDragBridge.shared.isWorkspaceRowDrag &&
        info.hasItemsConforming(to: [UTType.text])
    }

    func dropUpdated(info: DropInfo) -> DropProposal? {
        guard validateDrop(info: info) else { return nil }
        return DropProposal(operation: .move)
    }

    func performDrop(info: DropInfo) -> Bool {
        guard WorkspaceDragBridge.shared.isWorkspaceRowDrag,
              let provider = info.itemProviders(for: [UTType.text]).first else {
            WorkspaceDragBridge.shared.endDragging()
            return false
        }

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
                  sourceID.isEmpty == false,
                  isValidWorkspaceID(sourceID) else {
                DispatchQueue.main.async {
                    WorkspaceDragBridge.shared.endDragging()
                }
                return
            }

            DispatchQueue.main.async {
                onActivateWorkspace(sourceID)
                WorkspaceDragBridge.shared.endDragging()
            }
        }

        return true
    }
}
