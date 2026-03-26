//
//  WorkspaceSidebarListView.swift
//  pandora
//

import SwiftUI
import Combine
import UniformTypeIdentifiers

// MARK: - Reorder State

@MainActor
final class SidebarReorderState: ObservableObject {
    /// ID of the workspace to insert BEFORE. nil = append at end (only valid when appendAtEnd == true).
    @Published var insertBeforeID: String? = nil
    /// True when hovering over the bottom half of the last row.
    @Published var appendAtEnd: Bool = false

    var isActive: Bool { insertBeforeID != nil || appendAtEnd }

    func clear() {
        insertBeforeID = nil
        appendAtEnd = false
    }
}

// MARK: - List View

struct WorkspaceSidebarListView: View {
    @ObservedObject var store: WorkspaceStore
    @ObservedObject var workspaceController: PandoraWorkspaceController
    @StateObject private var reorderState = SidebarReorderState()
    @ObservedObject private var dragBridge = WorkspaceDragBridge.shared

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                if !store.filteredWorkspaces.isEmpty {
                    VStack(alignment: .leading, spacing: 0) {
                        sectionHeader
                            .padding(.bottom, 10)

                        let allWorkspaces = store.filteredWorkspaces
                        let draggedID = dragBridge.draggedWorkspaceID
                        // Remove dragged item from the list while dragging so its
                        // space closes immediately and the slot shows the true target.
                        let workspaces = dragBridge.isWorkspaceRowDrag
                            ? allWorkspaces.filter { $0.id != draggedID }
                            : allWorkspaces

                        ForEach(Array(workspaces.enumerated()), id: \.element.id) { index, workspace in
                            // Insertion slot BEFORE this row
                            if reorderState.insertBeforeID == workspace.id {
                                RowInsertionPlaceholder()
                                    .onDrop(
                                        of: [UTType.text],
                                        delegate: SidebarSlotDropDelegate(
                                            insertBeforeID: workspace.id,
                                            appendAtEnd: false,
                                            store: store,
                                            reorderState: reorderState
                                        )
                                    )
                            }

                            WorkspaceSidebarRowView(
                                store: store,
                                workspaceController: workspaceController,
                                workspace: workspace,
                                isSelected: store.selectedSidebarWorkspaceID == workspace.id
                            )
                            .onDrop(
                                of: [UTType.text],
                                delegate: SidebarRowDropDelegate(
                                    targetWorkspaceID: workspace.id,
                                    nextWorkspaceID: index + 1 < workspaces.count ? workspaces[index + 1].id : nil,
                                    isLast: index == workspaces.count - 1,
                                    store: store,
                                    reorderState: reorderState
                                )
                            )
                        }

                        // Insertion slot after all rows
                        if reorderState.appendAtEnd {
                            RowInsertionPlaceholder()
                                .onDrop(
                                    of: [UTType.text],
                                    delegate: SidebarSlotDropDelegate(
                                        insertBeforeID: nil,
                                        appendAtEnd: true,
                                        store: store,
                                        reorderState: reorderState
                                    )
                                )
                        }
                    }
                    .padding(.bottom, 2)
                    .animation(.spring(duration: 0.22, bounce: 0.1), value: reorderState.insertBeforeID)
                    .animation(.spring(duration: 0.22, bounce: 0.1), value: reorderState.appendAtEnd)
                    .animation(.spring(duration: 0.22, bounce: 0.1), value: dragBridge.isWorkspaceRowDrag)
                }
            }
            .padding(.horizontal, 12)
            .padding(.top, 6)
            .padding(.bottom, 14)
        }
        .onChange(of: dragBridge.dragKind) { _, newValue in
            if newValue == nil { reorderState.clear() }
        }
    }

    private var sectionHeader: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "square.split.2x1")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.secondary)
                Text("WORKSPACES")
                    .font(.system(size: 11, weight: .bold))
                    .tracking(1.1)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Text("\(store.filteredWorkspaces.count)")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
                .padding(.horizontal, 7)
                .padding(.vertical, 3)
                .background(Capsule(style: .continuous).fill(Color.primary.opacity(0.06)))
        }
        .padding(.horizontal, 4)
    }
}

// MARK: - Insertion Placeholder

private struct RowInsertionPlaceholder: View {
    var body: some View {
        RoundedRectangle(cornerRadius: 12, style: .continuous)
            .fill(Color.accentColor.opacity(0.08))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(
                        Color.accentColor.opacity(0.5),
                        style: StrokeStyle(lineWidth: 1.5, dash: [6, 4])
                    )
            )
            .frame(height: 64)
            .transition(.asymmetric(
                insertion: .scale(scale: 0.96, anchor: .center).combined(with: .opacity),
                removal: .opacity.animation(.linear(duration: 0))
            ))
    }
}

// MARK: - Slot Drop Delegate

/// Handles drops directly on the visible insertion placeholder.
struct SidebarSlotDropDelegate: DropDelegate {
    let insertBeforeID: String?
    let appendAtEnd: Bool
    let store: WorkspaceStore
    let reorderState: SidebarReorderState

    func validateDrop(info: DropInfo) -> Bool {
        WorkspaceDragBridge.shared.isWorkspaceRowDrag
    }

    func dropUpdated(info: DropInfo) -> DropProposal? {
        DropProposal(operation: .move)
    }

    func performDrop(info: DropInfo) -> Bool {
        guard let sourceID = WorkspaceDragBridge.shared.draggedWorkspaceID else {
            reorderState.clear()
            WorkspaceDragBridge.shared.endDragging()
            return false
        }
        let insertBefore = appendAtEnd ? nil : insertBeforeID
        var t = Transaction()
        t.disablesAnimations = true
        withTransaction(t) {
            reorderState.clear()
            store.reorderWorkspace(movingID: sourceID, insertBeforeID: insertBefore)
            WorkspaceDragBridge.shared.endDragging()
        }
        return true
    }
}

// MARK: - Row Drop Delegate

struct SidebarRowDropDelegate: DropDelegate {
    let targetWorkspaceID: String
    let nextWorkspaceID: String?
    let isLast: Bool
    let store: WorkspaceStore
    let reorderState: SidebarReorderState

    private let rowHeight: CGFloat = 68

    func validateDrop(info: DropInfo) -> Bool {
        WorkspaceDragBridge.shared.isWorkspaceRowDrag &&
        info.hasItemsConforming(to: [UTType.text])
    }

    func dropEntered(info: DropInfo) {
        updateSlot(y: info.location.y)
    }

    func dropUpdated(info: DropInfo) -> DropProposal? {
        updateSlot(y: info.location.y)
        return DropProposal(operation: .move)
    }

    func dropExited(info: DropInfo) {
        // Intentionally not clearing — the placeholder steals the drop zone causing
        // rapid enter/exit flicker if we clear here. Slot clears on drop or drag end.
    }

    func performDrop(info: DropInfo) -> Bool {
        let capturedInsertBeforeID = reorderState.insertBeforeID
        let capturedAppendAtEnd    = reorderState.appendAtEnd
        guard let sourceID = WorkspaceDragBridge.shared.draggedWorkspaceID else {
            reorderState.clear()
            WorkspaceDragBridge.shared.endDragging()
            return false
        }
        let insertBefore = capturedAppendAtEnd ? nil : capturedInsertBeforeID
        var t = Transaction()
        t.disablesAnimations = true
        withTransaction(t) {
            reorderState.clear()
            store.reorderWorkspace(movingID: sourceID, insertBeforeID: insertBefore)
            WorkspaceDragBridge.shared.endDragging()
        }
        return true
    }

    private func updateSlot(y: CGFloat) {
        if y < rowHeight / 2 {
            reorderState.insertBeforeID = targetWorkspaceID
            reorderState.appendAtEnd    = false
        } else if let next = nextWorkspaceID {
            reorderState.insertBeforeID = next
            reorderState.appendAtEnd    = false
        } else if isLast {
            reorderState.insertBeforeID = nil
            reorderState.appendAtEnd    = true
        }
    }
}
