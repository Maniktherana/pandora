//
//  PandoraWorkspaceView.swift
//  pandora
//
//  Created by Manik Rana on 25/03/26.
//

import Bonsplit
import SwiftUI
import UniformTypeIdentifiers

struct PandoraWorkspaceView: View {
    @ObservedObject var store: WorkspaceStore
    @ObservedObject var workspaceController: PandoraWorkspaceController
    @ObservedObject private var dragBridge = WorkspaceDragBridge.shared
    let surfaceRegistry: SurfaceRegistry
    @State private var activeDropTarget: WorkspaceDropTarget?

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
                if dragBridge.draggedWorkspaceID != nil {
                    GeometryReader { _ in
                        DynamicWorkspaceDropPreview(
                            previewFrame: activeDropTarget?.previewFrame
                        )
                        .onDrop(
                            of: [UTType.text],
                            delegate: WorkspaceSurfaceDropDelegate(
                                resolveTarget: { location in
                                    workspaceController.dropTarget(at: location)
                                },
                                currentTarget: { activeDropTarget },
                                setActiveTarget: { target in
                                    activeDropTarget = target
                                },
                                onPerformDrop: { providers, target in
                                    handleExternalDrop(providers: providers, into: workspace.id, target: target)
                                }
                            )
                        )
                    }
                }
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
            .onChange(of: dragBridge.draggedWorkspaceID) { _, newValue in
                if newValue == nil {
                    activeDropTarget = nil
                }
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
            Text("Drop a sidebar process here to open it as a tab or split")
                .font(.system(size: 13, weight: .medium))
            Text("Use the center to tab, or the edges to split the workspace.")
                .font(.system(size: 12))
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(nsColor: .windowBackgroundColor))
    }

    private func handleExternalDrop(
        providers: [NSItemProvider],
        into workspaceID: String,
        target: WorkspaceDropTarget
    ) -> Bool {
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
                activeDropTarget = nil
                dragBridge.endDragging()
                store.mergeWorkspace(
                    sourceID: sourceID,
                    into: workspaceID,
                    targetPaneID: target.paneID,
                    intent: target.intent
                )
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

private struct DynamicWorkspaceDropPreview: View {
    let previewFrame: CGRect?

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(Color.white.opacity(0.18), style: StrokeStyle(lineWidth: 1.5, dash: [10, 6]))
                .padding(12)

            if let frame = previewFrame {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(Color.accentColor.opacity(0.22))
                    .overlay {
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .stroke(Color.accentColor, lineWidth: 3)
                    }
                    .frame(width: frame.width, height: frame.height)
                    .position(x: frame.midX, y: frame.midY)
            }
        }
        .allowsHitTesting(false)
    }
}

private struct WorkspaceSurfaceDropDelegate: DropDelegate {
    let resolveTarget: (CGPoint) -> WorkspaceDropTarget?
    let currentTarget: () -> WorkspaceDropTarget?
    let setActiveTarget: (WorkspaceDropTarget?) -> Void
    let onPerformDrop: ([NSItemProvider], WorkspaceDropTarget) -> Bool

    func performDrop(info: DropInfo) -> Bool {
        let target = resolveTarget(info.location) ?? currentTarget()
        guard let target else {
            // Drop rejected — clean up here since handleExternalDrop won't run.
            DispatchQueue.main.async {
                setActiveTarget(nil)
                WorkspaceDragBridge.shared.endDragging()
            }
            return false
        }
        // Drop accepted — handleExternalDrop owns cleanup (endDragging + mergeWorkspace).
        return onPerformDrop(info.itemProviders(for: [UTType.text]), target)
    }

    func dropEntered(info: DropInfo) {
        DispatchQueue.main.async {
            setActiveTarget(resolveTarget(info.location))
        }
    }

    func dropExited(info: DropInfo) {
        DispatchQueue.main.async {
            setActiveTarget(nil)
        }
    }

    func dropUpdated(info: DropInfo) -> DropProposal? {
        DispatchQueue.main.async {
            setActiveTarget(resolveTarget(info.location))
        }
        return DropProposal(operation: .move)
    }

    func validateDrop(info: DropInfo) -> Bool {
        info.hasItemsConforming(to: [UTType.text])
    }
}
