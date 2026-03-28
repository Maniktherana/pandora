//
//  SidebarShellView.swift
//  pandora
//
//  Created by Manik Rana on 24/03/26.
//

import SwiftUI
import UniformTypeIdentifiers

struct SidebarShellView: View {
    @ObservedObject var store: WorkspaceStore
    @ObservedObject var workspaceController: PandoraWorkspaceController
    @State private var isSidebarDropTargeted = false

    var body: some View {
        VStack(spacing: 0) {
            SearchFieldView(text: $store.searchText, placeholder: "Filter workspaces...")
                .padding(.horizontal, 12)
                .padding(.top, 12)
                .padding(.bottom, 12)

            SidebarKeyboardHost(
                onMoveSelection: { offset in
                    store.navigateSidebarSelection(offset: offset)
                },
                onActivateSelection: {
                    store.focusVisibleWorkspace()
                },
                content: WorkspaceSidebarListView(store: store, workspaceController: workspaceController)
            )
        }
        .frame(minWidth: 280, idealWidth: 320, maxWidth: 420, maxHeight: .infinity, alignment: .top)
        .background(sidebarBackground)
        .overlay {
            if isSidebarDropTargeted {
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(Color.accentColor, style: StrokeStyle(lineWidth: 3, dash: [10, 6]))
                    .padding(10)
                    .overlay {
                        VStack(spacing: 8) {
                            Image(systemName: "tray.and.arrow.down")
                                .font(.system(size: 20, weight: .semibold))
                            Text("Drop Here To Split Out")
                                .font(.system(size: 12, weight: .semibold))
                        }
                        .foregroundStyle(Color.accentColor)
                    }
                    .allowsHitTesting(false)
            }
        }
        .onDrop(of: [.json], delegate: SidebarShellDropDelegate(
            store: store,
            workspaceController: workspaceController,
            isTargeted: $isSidebarDropTargeted
        ))
    }

    private var sidebarBackground: some View {
        VisualEffectBackdrop(material: .sidebar, blendingMode: .behindWindow)
    }
}

// MARK: - Shell Drop Delegate

/// Handles tab-to-sidebar drops (detach slot from workspace back to sidebar).
/// Only activates for Bonsplit tab drags — workspace row drags are filtered out
/// by checking draggedWorkspaceID directly in AppKit's synchronous call stack.
struct SidebarShellDropDelegate: DropDelegate {
    let store: WorkspaceStore
    let workspaceController: PandoraWorkspaceController
    @Binding var isTargeted: Bool

    func validateDrop(info: DropInfo) -> Bool {
        WorkspaceDragBridge.shared.isContentTabDrag &&
        info.hasItemsConforming(to: [.json])
    }

    func dropEntered(info: DropInfo) {
        guard validateDrop(info: info) else { return }
        isTargeted = true
    }

    func dropExited(info: DropInfo) {
        isTargeted = false
    }

    func dropUpdated(info: DropInfo) -> DropProposal? {
        guard validateDrop(info: info) else {
            isTargeted = false
            return nil
        }
        return DropProposal(operation: .move)
    }

    func performDrop(info: DropInfo) -> Bool {
        isTargeted = false
        guard WorkspaceDragBridge.shared.isContentTabDrag,
              let provider = info.itemProviders(for: [.json]).first else {
            WorkspaceDragBridge.shared.endDragging()
            return false
        }

        provider.loadDataRepresentation(forTypeIdentifier: UTType.json.identifier) { data, _ in
            guard let data,
                  let transfer = ExternalTabTransfer.decodeFromTabTransfer(data) else { return }

            DispatchQueue.main.async {
                WorkspaceDragBridge.shared.endDragging()
                if let slotID = workspaceController.slotID(forDragTabIdentifier: transfer.tab.id) {
                    store.detachSlotToSidebar(slotID: slotID)
                }
            }
        }
        return true
    }
}

// MARK: - External Tab Transfer

struct ExternalTabTransfer: Decodable {
    struct TabPayload: Decodable {
        let id: String
    }

    let tab: TabPayload

    static func decodeFromTabTransfer(_ data: Data) -> ExternalTabTransfer? {
        try? JSONDecoder().decode(ExternalTabTransfer.self, from: data)
    }
}
