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
    @ObservedObject private var dragBridge = WorkspaceDragBridge.shared
    let surfaceRegistry: SurfaceRegistry
    @State private var activeDropIntent: WorkspaceDropIntent?

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
                    GeometryReader { geometry in
                        DynamicWorkspaceDropPreview(
                            size: geometry.size,
                            activeIntent: activeDropIntent
                        )
                        .onDrop(
                            of: [UTType.text],
                            delegate: WorkspaceSurfaceDropDelegate(
                                size: geometry.size,
                                activeIntent: $activeDropIntent,
                                onPerformDrop: { providers, intent in
                                    handleExternalDrop(providers: providers, into: workspace.id, intent: intent)
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
        intent: WorkspaceDropIntent
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
                activeDropIntent = nil
                dragBridge.endDragging()
                store.mergeWorkspaces(sourceID: sourceID, into: workspaceID, intent: intent)
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
    let size: CGSize
    let activeIntent: WorkspaceDropIntent?

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(Color.white.opacity(0.18), style: StrokeStyle(lineWidth: 1.5, dash: [10, 6]))
                .padding(12)

            if let frame = previewFrame(for: activeIntent) {
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

    private func previewFrame(for intent: WorkspaceDropIntent?) -> CGRect? {
        guard let intent else { return nil }

        switch intent {
        case .tabs:
            return CGRect(
                x: max(72, size.width * 0.18),
                y: max(52, size.height * 0.12),
                width: max(220, size.width * 0.64),
                height: max(140, size.height * 0.68)
            )
        case .splitLeft:
            return CGRect(x: 12, y: 12, width: max(180, size.width * 0.5) - 18, height: size.height - 24)
        case .splitRight:
            return CGRect(x: size.width * 0.5 + 6, y: 12, width: max(180, size.width * 0.5) - 18, height: size.height - 24)
        case .splitUp:
            return CGRect(x: 12, y: 12, width: size.width - 24, height: max(120, size.height * 0.5) - 18)
        case .splitDown:
            return CGRect(x: 12, y: size.height * 0.5 + 6, width: size.width - 24, height: max(120, size.height * 0.5) - 18)
        }
    }
}

private struct WorkspaceSurfaceDropDelegate: DropDelegate {
    let size: CGSize
    @Binding var activeIntent: WorkspaceDropIntent?
    let onPerformDrop: ([NSItemProvider], WorkspaceDropIntent) -> Bool

    func performDrop(info: DropInfo) -> Bool {
        let intent = intent(for: info.location)
        defer { activeIntent = nil }
        return onPerformDrop(info.itemProviders(for: [UTType.text]), intent)
    }

    func dropEntered(info: DropInfo) {
        activeIntent = intent(for: info.location)
    }

    func dropExited(info: DropInfo) {
        activeIntent = nil
    }

    func dropUpdated(info: DropInfo) -> DropProposal? {
        activeIntent = intent(for: info.location)
        return DropProposal(operation: .move)
    }

    func validateDrop(info: DropInfo) -> Bool {
        info.hasItemsConforming(to: [UTType.text])
    }

    private func intent(for location: CGPoint) -> WorkspaceDropIntent {
        let horizontalEdge = max(90, size.width * 0.18)
        let verticalEdge = max(80, size.height * 0.18)

        if location.x < horizontalEdge {
            return .splitLeft
        }
        if location.x > size.width - horizontalEdge {
            return .splitRight
        }
        if location.y < verticalEdge {
            return .splitUp
        }
        if location.y > size.height - verticalEdge {
            return .splitDown
        }
        return .tabs
    }
}
