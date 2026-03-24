//
//  SlotLayoutView.swift
//  pandora
//
//  Created by Manik Rana on 24/03/26.
//

import SwiftUI

struct WorkspaceLayoutView: View {
    let workspace: WorkspaceEntry
    let slotsByID: [String: SlotState]
    let sessionsByID: [String: SessionState]
    @ObservedObject var surfaceRegistry: SurfaceRegistry
    let keyboardNavigationArea: WorkspaceNavigationArea
    let onSelectPane: (UUID, String, Bool) -> Void
    let onMergeWorkspace: (String) -> Void
    @State private var targetedPaneID: UUID?

    var body: some View {
        render(node: workspace.root)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color(nsColor: .windowBackgroundColor))
    }

    private func render(node: WorkspaceLayoutNode) -> AnyView {
        switch node {
        case .leaf(let paneID, let content):
            return AnyView(renderLeaf(paneID: paneID, content: content))
        case .split(_, let axis, let children, _):
            if axis == .horizontal {
                return AnyView(HStack(spacing: 1) {
                    ForEach(Array(children.enumerated()), id: \.offset) { _, child in
                        render(node: child)
                    }
                })
            } else {
                return AnyView(VStack(spacing: 1) {
                    ForEach(Array(children.enumerated()), id: \.offset) { _, child in
                        render(node: child)
                    }
                })
            }
        }
    }

    @ViewBuilder
    private func renderLeaf(paneID: UUID, content: WorkspaceLeafContent) -> some View {
        VStack(spacing: 0) {
            switch content {
            case .single(let slotID):
                terminal(slotID: slotID, paneID: paneID)
            case .tabs(let slotIDs, let selectedIndex):
                let selectedSlotID = slotIDs.indices.contains(selectedIndex) ? slotIDs[selectedIndex] : slotIDs.first
                PaneTabStripView(
                    tabs: slotIDs.map { WorkspaceTab(id: $0, title: slotsByID[$0]?.name ?? "Unknown") },
                    selectedID: selectedSlotID ?? ""
                ) { selectedSlotID in
                    onSelectPane(paneID, selectedSlotID, keyboardNavigationArea == .workspace)
                }
                if let selectedSlotID {
                    terminal(slotID: selectedSlotID, paneID: paneID)
                } else {
                    placeholder
                }
            }
        }
        .background(Color(nsColor: .windowBackgroundColor))
        .overlay {
            RoundedRectangle(cornerRadius: 0, style: .continuous)
                .strokeBorder(borderColor(for: paneID), lineWidth: targetedPaneID == paneID ? 3 : 1)
        }
        .contentShape(Rectangle())
        .onTapGesture {
            if let selectedSlotID = content.selectedSlotID {
                onSelectPane(paneID, selectedSlotID, false)
            }
        }
        .dropDestination(for: String.self, isTargeted: Binding(
            get: { targetedPaneID == paneID },
            set: { isTargeted in
                targetedPaneID = isTargeted ? paneID : (targetedPaneID == paneID ? nil : targetedPaneID)
            }
        )) { items, _ in
            guard let sourceID = items.first else { return false }
            onMergeWorkspace(sourceID)
            return true
        }
    }

    @ViewBuilder
    private func terminal(slotID: String, paneID: UUID) -> some View {
        if let slot = slotsByID[slotID],
           let session = slot.primarySession(using: sessionsByID) {
            TerminalSurfaceView(
                sessionID: session.id,
                presentationMode: slot.presentationMode,
                surfaceRegistry: surfaceRegistry
            )
                .id(session.id)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            placeholder
        }
    }

    private var placeholder: some View {
        VStack(spacing: 8) {
            Image(systemName: "terminal")
                .font(.system(size: 24))
                .foregroundStyle(.secondary)
            Text("No session selected")
                .font(.system(size: 13))
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(nsColor: .windowBackgroundColor))
    }

    private func borderColor(for paneID: UUID) -> Color {
        if targetedPaneID == paneID {
            return Color.accentColor.opacity(0.9)
        }
        if workspace.focusedPaneID == paneID {
            return Color.accentColor.opacity(0.6)
        }
        return Color.clear
    }
}
