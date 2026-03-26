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
    @ObservedObject private var dragBridge = WorkspaceDragBridge.shared
    let surfaceRegistry: SurfaceRegistry
    @State private var activeDropTarget: WorkspaceDropTarget?

    private let dropPreviewAnimation = Animation.spring(duration: 0.25, bounce: 0.15)

    var body: some View {
        if let workspace = store.visibleWorkspace {
            SplitPaneView(controller: workspaceController.bonsplitController) { tab, _ in
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
                GeometryReader { _ in
                    DynamicWorkspaceDropPreview(
                        previewFrame: dragBridge.isWorkspaceRowDrag ? activeDropTarget?.previewFrame : nil
                    )
                    .onDrop(
                        of: [UTType.text],
                        delegate: WorkspaceSurfaceDropDelegate(
                            resolveTarget: { location in
                                workspaceController.dropTarget(at: location)
                            },
                            currentTarget: { activeDropTarget },
                            setActiveTarget: { target in
                                withAnimation(dropPreviewAnimation) {
                                    activeDropTarget = target
                                }
                            },
                            onPerformDrop: { providers, target in
                                handleExternalDrop(providers: providers, into: workspace.id, target: target)
                            }
                        )
                    )
                }
            }
            .onChange(of: dragBridge.dragKind) { _, newValue in
                if newValue == nil {
                    withAnimation(dropPreviewAnimation) {
                        activeDropTarget = nil
                    }
                }
            }
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
                  sourceID.isEmpty == false,
                  store.workspaceEntries.contains(where: { $0.id == sourceID }) else {
                return
            }

            DispatchQueue.main.async {
                withAnimation(dropPreviewAnimation) {
                    activeDropTarget = nil
                }
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
        info.hasItemsConforming(to: [UTType.text])
    }

    func dropUpdated(info: DropInfo) -> DropProposal? {
        DropProposal(operation: .move)
    }

    func performDrop(info: DropInfo) -> Bool {
        guard let provider = info.itemProviders(for: [UTType.text]).first else {
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

private struct DynamicWorkspaceDropPreview: View {
    let previewFrame: CGRect?
    @State private var renderedFrame: CGRect = .zero
    @State private var isVisible = false

    var body: some View {
        RoundedRectangle(cornerRadius: 8, style: .continuous)
            .fill(Color.accentColor.opacity(0.25))
            .overlay {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(Color.accentColor, lineWidth: 2)
            }
            .frame(width: renderedFrame.width, height: renderedFrame.height)
            .position(x: renderedFrame.midX, y: renderedFrame.midY)
            .opacity(isVisible ? 1 : 0)
        .allowsHitTesting(false)
        .onAppear {
            if let previewFrame {
                renderedFrame = previewFrame
                isVisible = true
            }
        }
        .onChange(of: previewFrame) { oldValue, newValue in
            switch (oldValue, newValue) {
            case (.none, .some(let frame)):
                renderedFrame = frame
                withAnimation(.easeInOut(duration: 0.15)) {
                    isVisible = true
                }
            case (.some, .some(let frame)):
                withAnimation(.spring(duration: 0.25, bounce: 0.15)) {
                    renderedFrame = frame
                }
            case (.some, .none):
                withAnimation(.easeInOut(duration: 0.15)) {
                    isVisible = false
                }
            case (.none, .none):
                break
            }
        }
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
            WorkspaceDragBridge.shared.markEnteredMainWorkspace()
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
            WorkspaceDragBridge.shared.markEnteredMainWorkspace()
            setActiveTarget(resolveTarget(info.location))
        }
        return DropProposal(operation: .move)
    }

    func validateDrop(info: DropInfo) -> Bool {
        info.hasItemsConforming(to: [UTType.text])
    }
}
