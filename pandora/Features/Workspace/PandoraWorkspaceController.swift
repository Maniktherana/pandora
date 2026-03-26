//
//  PandoraWorkspaceController.swift
//  pandora
//
//  Created by Manik Rana on 25/03/26.
//

import Combine
import SwiftUI

@MainActor
final class PandoraWorkspaceController: NSObject, ObservableObject {
    @Published private(set) var bonsplitController: SplitPaneController

    weak var store: WorkspaceStore?
    weak var surfaceRegistry: SurfaceRegistry?

    private var renderedWorkspace: WorkspaceEntry?
    private var workspacePaneIDByBonsplitPaneID: [String: UUID] = [:]
    private var bonsplitPaneIDByWorkspacePaneID: [UUID: PaneID] = [:]
    private var slotIDByBonsplitTabID: [String: String] = [:]
    private var bonsplitTabIDBySlotID: [String: TabID] = [:]
    private var isApplyingSnapshot = false
    private var isSynchronizingSelection = false

    override init() {
        let controller = PandoraWorkspaceController.makeController()
        self.bonsplitController = controller
        super.init()
        controller.delegate = self
        clearWelcomeTab(in: controller)
    }

    func bind(store: WorkspaceStore, surfaceRegistry: SurfaceRegistry) {
        self.store = store
        self.surfaceRegistry = surfaceRegistry
    }

    func render(workspace: WorkspaceEntry?, slotsByID: [String: SlotState]) {
        guard let workspace else {
            renderedWorkspace = nil
            return
        }

        // Only rebuild the SplitPaneController when the structural layout changes:
        // which panes exist, how they're split, and which slots are in each pane.
        // Focus changes (focusedPaneID) and tab selection changes (selectedIndex) must
        // NOT trigger a rebuild — doing so resets every split's dividerPosition back to
        // 1.0→0.5 and tears down terminal NSViews mid-mouseDown (causing stuck clicks).
        let structurallyChanged = renderedWorkspace?.id != workspace.id
            || renderedWorkspace.map { !structurallyEqual($0.root, workspace.root) } ?? true
        guard structurallyChanged else {
            renderedWorkspace = workspace
            syncVisibleSelection(to: workspace)
            return
        }

        isApplyingSnapshot = true

        // Preserve the current container frame so the new controller has valid geometry
        // immediately. SplitTreeView.onAppear only fires once (when the view first
        // appears) and won't re-fire when the controller object is swapped out. Without
        // this, layoutSnapshot() returns zero-sized pane frames on the second drag.
        let pr = bonsplitController.layoutSnapshot().containerFrame
        let preservedFrame = CGRect(x: pr.x, y: pr.y, width: pr.width, height: pr.height)

        let controller = PandoraWorkspaceController.makeController()
        controller.delegate = self
        clearWelcomeTab(in: controller)

        workspacePaneIDByBonsplitPaneID = [:]
        bonsplitPaneIDByWorkspacePaneID = [:]
        slotIDByBonsplitTabID = [:]
        bonsplitTabIDBySlotID = [:]

        if let rootPane = controller.allPaneIds.first {
            materialize(node: workspace.root, in: rootPane, controller: controller, slotsByID: slotsByID)
        }

        if preservedFrame.width > 0 && preservedFrame.height > 0 {
            controller.setContainerFrame(preservedFrame)
        }

        bonsplitController = controller
        renderedWorkspace = workspace
        syncVisibleSelection(to: workspace)
        isApplyingSnapshot = false
    }

    @discardableResult
    func focusDirection(_ direction: NavigationDirection) -> Bool {
        guard bonsplitController.focusedPaneId != nil else { return false }
        bonsplitController.navigateFocus(direction: direction)
        return true
    }

    @discardableResult
    func selectAdjacentTab(forward: Bool) -> String? {
        let paneIDs = bonsplitController.allPaneIds
        guard paneIDs.isEmpty == false else { return nil }

        let focusedPaneID = bonsplitController.focusedPaneId ?? paneIDs[0]
        guard let paneIndex = paneIDs.firstIndex(of: focusedPaneID) else { return nil }

        let tabs = bonsplitController.tabs(inPane: focusedPaneID)
        let selectedTabID = bonsplitController.selectedTab(inPane: focusedPaneID)?.id
        let selectedIndex = selectedTabID.flatMap { id in
            tabs.firstIndex(where: { $0.id == id })
        } ?? 0

        if forward, tabs.indices.contains(selectedIndex + 1) {
            let tabID = tabs[selectedIndex + 1].id
            bonsplitController.selectTab(tabID)
            return sessionID(for: tabID)
        }

        if !forward {
            let previousIndex = selectedIndex - 1
            if tabs.indices.contains(previousIndex) {
                let tabID = tabs[previousIndex].id
                bonsplitController.selectTab(tabID)
                return sessionID(for: tabID)
            }
        }

        let paneStep = forward ? 1 : -1
        let paneCount = paneIDs.count
        for offset in 1...paneCount {
            let nextPaneIndex = (paneIndex + (offset * paneStep) + paneCount) % paneCount
            let nextPaneID = paneIDs[nextPaneIndex]
            let nextPaneTabs = bonsplitController.tabs(inPane: nextPaneID)
            guard nextPaneTabs.isEmpty == false else { continue }
            let targetTab = forward ? nextPaneTabs[0] : nextPaneTabs[nextPaneTabs.count - 1]
            bonsplitController.focusPane(nextPaneID)
            bonsplitController.selectTab(targetTab.id)
            return sessionID(for: targetTab.id)
        }

        return nil
    }

    func synchronizeTerminalFocus() {
        guard let store, let surfaceRegistry else { return }

        if store.keyboardNavigationArea == .workspace,
           let sessionID = store.actualFocusedSession?.id {
            DispatchQueue.main.async {
                _ = surfaceRegistry.focus(sessionID: sessionID, notifyFocusChange: false)
            }
        } else {
            DispatchQueue.main.async {
                surfaceRegistry.clearFocus()
            }
        }
    }

    func slotID(for tabID: TabID) -> String? {
        guard let bonsplitTabID = tabIDString(for: tabID) else { return nil }
        return slotIDByBonsplitTabID[bonsplitTabID]
    }

    func sessionID(for tabID: TabID) -> String? {
        guard let slotID = slotID(for: tabID),
              let store,
              let slot = store.slotsByID[slotID] else {
            return nil
        }
        return slot.primarySession(using: store.sessionsByID)?.id
    }

    func slotID(forDragTabIdentifier identifier: String) -> String? {
        slotIDByBonsplitTabID[identifier.lowercased()]
    }

    func dropTarget(at location: CGPoint) -> WorkspaceDropTarget? {
        let snapshot = bonsplitController.layoutSnapshot()
        let panes = snapshot.panes.compactMap { pane -> (workspacePaneID: UUID, frame: CGRect)? in
            guard let workspacePaneID = workspacePaneIDByBonsplitPaneID[pane.paneId.lowercased()] else {
                return nil
            }

            let localFrame = CGRect(
                x: pane.frame.x - snapshot.containerFrame.x,
                y: pane.frame.y - snapshot.containerFrame.y,
                width: pane.frame.width,
                height: pane.frame.height
            )
            return (workspacePaneID, localFrame)
        }

        let hoveredPane = panes.first(where: { $0.frame.contains(location) })
            ?? panes.min(by: { distance(from: location, to: $0.frame) < distance(from: location, to: $1.frame) })
        guard let hoveredPane else {
            return nil
        }

        let intent = dropIntent(for: location, within: hoveredPane.frame)
        return WorkspaceDropTarget(
            paneID: hoveredPane.workspacePaneID,
            intent: intent,
            previewFrame: previewFrame(for: intent, within: hoveredPane.frame)
        )
    }

    private func materialize(
        node: WorkspaceLayoutNode,
        in paneID: PaneID,
        controller: SplitPaneController,
        slotsByID: [String: SlotState]
    ) {
        switch node {
        case .leaf(let workspacePaneID, let content):
            register(paneID: paneID, workspacePaneID: workspacePaneID)
            populate(content: content, in: paneID, controller: controller, slotsByID: slotsByID)

        case .split(_, let axis, let children, _):
            guard let first = children.first else { return }
            materialize(node: first, in: paneID, controller: controller, slotsByID: slotsByID)

            var splitBasePaneID = paneID
            for child in children.dropFirst() {
                // animated: false avoids the 1.0→0.5 divider animation during a programmatic
                // rebuild. Without this, updateNSView's syncPosition(1.0) moves the outer
                // split to full width, making all newly added panes invisible (totalSize = 0
                // in the deferred makeNSView block, the guard fails, pane stays hidden).
                guard let newPaneID = controller.splitPane(splitBasePaneID, orientation: axis.bonsplitOrientation, animated: false) else {
                    continue
                }
                materialize(node: child, in: newPaneID, controller: controller, slotsByID: slotsByID)
                splitBasePaneID = newPaneID
            }
        }
    }

    private func populate(
        content: WorkspaceLeafContent,
        in paneID: PaneID,
        controller: SplitPaneController,
        slotsByID: [String: SlotState]
    ) {
        let slotIDs: [String]
        if case .tabs(let rawSlotIDs, let selectedIndex) = content,
           rawSlotIDs.indices.contains(selectedIndex) {
            let selectedSlotID = rawSlotIDs[selectedIndex]
            slotIDs = rawSlotIDs.enumerated()
                .filter { $0.offset != selectedIndex }
                .map(\.element) + [selectedSlotID]
        } else {
            slotIDs = content.slotIDs
        }
        guard slotIDs.isEmpty == false else { return }

        for slotID in slotIDs {
            let title = slotsByID[slotID]?.name ?? "Terminal"
            if let tabID = controller.createTab(title: title, icon: "terminal", inPane: paneID) {
                remember(tabID: tabID, slotID: slotID)
            }
        }
    }

    private func syncVisibleSelection(to workspace: WorkspaceEntry) {
        renderedWorkspace = workspace

        if store?.keyboardNavigationArea == .workspace,
           let target = workspace.activeFocusTarget ?? workspace.defaultFocusTarget,
           let paneID = bonsplitPaneIDByWorkspacePaneID[target.paneID] {
            isSynchronizingSelection = true
            defer { isSynchronizingSelection = false }
            bonsplitController.focusPane(paneID)
            if let tabID = bonsplitTabIDBySlotID[target.slotID] {
                bonsplitController.selectTab(tabID)
            }
        }

        synchronizeTerminalFocus()
    }

    private func rebuildWorkspaceFromShell() {
        guard isApplyingSnapshot == false,
              let store,
              let rebuiltRoot = rebuildNode(from: bonsplitController.treeSnapshot()) else {
            return
        }

        let focusedWorkspacePaneID = bonsplitController.focusedPaneId
            .flatMap { paneIDString(for: $0) }
            .flatMap { workspacePaneIDByBonsplitPaneID[$0] }

        store.replaceVisibleWorkspaceLayout(root: rebuiltRoot, focusedPaneID: focusedWorkspacePaneID)
        self.renderedWorkspace = store.visibleWorkspace
    }

    private func rebuildNode(from node: ExternalTreeNode) -> WorkspaceLayoutNode? {
        switch node {
        case .pane(let pane):
            let slotIDs = pane.tabs.compactMap { slotIDByBonsplitTabID[$0.id.lowercased()] }
            guard slotIDs.isEmpty == false else { return nil }

            let workspacePaneID = workspacePaneIDByBonsplitPaneID[pane.id.lowercased()] ?? UUID()
            let selectedSlotID = pane.selectedTabId
                .flatMap { slotIDByBonsplitTabID[$0.lowercased()] }
                ?? slotIDs.first

            let content: WorkspaceLeafContent
            if slotIDs.count == 1, let onlySlotID = slotIDs.first {
                content = .single(slotID: onlySlotID)
            } else {
                let selectedIndex = selectedSlotID.flatMap { slotIDs.firstIndex(of: $0) } ?? 0
                content = .tabs(slotIDs: slotIDs, selectedIndex: selectedIndex)
            }

            return .leaf(id: workspacePaneID, content: content)

        case .split(let split):
            guard let first = rebuildNode(from: split.first) else { return rebuildNode(from: split.second) }
            guard let second = rebuildNode(from: split.second) else { return first }
            let divider = CGFloat(split.dividerPosition)
            return .split(
                id: UUID(uuidString: split.id) ?? UUID(),
                axis: split.orientation == "vertical" ? .vertical : .horizontal,
                children: [first, second],
                ratios: [divider, max(0.0, 1.0 - divider)]
            )
        }
    }

    private func register(paneID: PaneID, workspacePaneID: UUID) {
        guard let bonsplitPaneID = paneIDString(for: paneID) else { return }
        workspacePaneIDByBonsplitPaneID[bonsplitPaneID] = workspacePaneID
        bonsplitPaneIDByWorkspacePaneID[workspacePaneID] = paneID
    }

    private func remember(tabID: TabID, slotID: String) {
        guard let bonsplitTabID = tabIDString(for: tabID) else { return }
        slotIDByBonsplitTabID[bonsplitTabID] = slotID
        bonsplitTabIDBySlotID[slotID] = tabID
    }

    private func clearWelcomeTab(in controller: SplitPaneController) {
        for tabID in controller.allTabIds {
            _ = controller.closeTab(tabID)
        }
    }

    private func dropIntent(for location: CGPoint, within frame: CGRect) -> WorkspaceDropIntent {
        let localX = location.x - frame.minX
        let localY = location.y - frame.minY
        let horizontalEdge = max(72, frame.width * 0.18)
        let verticalEdge = max(64, frame.height * 0.18)

        if localX < horizontalEdge {
            return .splitLeft
        }
        if localX > frame.width - horizontalEdge {
            return .splitRight
        }
        if localY < verticalEdge {
            return .splitUp
        }
        if localY > frame.height - verticalEdge {
            return .splitDown
        }
        return .tabs
    }

    private func previewFrame(for intent: WorkspaceDropIntent, within frame: CGRect) -> CGRect {
        switch intent {
        case .tabs:
            return frame
        case .splitLeft:
            return CGRect(x: frame.minX, y: frame.minY, width: frame.width * 0.5, height: frame.height)
        case .splitRight:
            return CGRect(x: frame.midX, y: frame.minY, width: frame.width * 0.5, height: frame.height)
        case .splitUp:
            return CGRect(x: frame.minX, y: frame.minY, width: frame.width, height: frame.height * 0.5)
        case .splitDown:
            return CGRect(x: frame.minX, y: frame.midY, width: frame.width, height: frame.height * 0.5)
        }
    }

    private func distance(from point: CGPoint, to rect: CGRect) -> CGFloat {
        let dx = max(rect.minX - point.x, 0, point.x - rect.maxX)
        let dy = max(rect.minY - point.y, 0, point.y - rect.maxY)
        return sqrt(dx * dx + dy * dy)
    }

    private static func makeController() -> SplitPaneController {
        let configuration = SplitPaneConfig(
            allowSplits: true,
            allowCloseTabs: false,
            allowCloseLastPane: false,
            allowTabReordering: true,
            allowCrossPaneTabMove: true,
            autoCloseEmptyPanes: true,
            contentViewLifecycle: .keepAllAlive,
            newTabPosition: .end,
            appearance: .init(showSplitButtons: false)
        )

        return SplitPaneController(configuration: configuration)
    }

    private func paneIDString(for paneID: PaneID) -> String? {
        (Mirror(reflecting: paneID).descendant("id") as? UUID)?.uuidString.lowercased()
    }

    private func tabIDString(for tabID: TabID) -> String? {
        (Mirror(reflecting: tabID).descendant("id") as? UUID)?.uuidString.lowercased()
    }
}

extension PandoraWorkspaceController: SplitPaneDelegate {
    func splitTabBar(_ controller: SplitPaneController, didSelectTab tab: Tab, inPane pane: PaneID) {
        guard isApplyingSnapshot == false,
              isSynchronizingSelection == false,
              let store,
              let paneIDString = paneIDString(for: pane),
              let workspacePaneID = workspacePaneIDByBonsplitPaneID[paneIDString],
              let slotID = slotIDByBonsplitTabID[tabIDString(for: tab.id) ?? ""] else {
            return
        }

        store.handleVisibleWorkspaceInteraction(
            paneID: workspacePaneID,
            slotID: slotID,
            focusRequested: store.keyboardNavigationArea == .workspace
        )
        renderedWorkspace = store.visibleWorkspace
        synchronizeTerminalFocus()
    }

    func splitTabBar(_ controller: SplitPaneController, didMoveTab tab: Tab, fromPane source: PaneID, toPane destination: PaneID) {
        rebuildWorkspaceFromShell()
    }

    func splitTabBar(_ controller: SplitPaneController, didSplitPane originalPane: PaneID, newPane: PaneID, orientation: SplitOrientation) {
        rebuildWorkspaceFromShell()
    }

    func splitTabBar(_ controller: SplitPaneController, didClosePane paneId: PaneID) {
        rebuildWorkspaceFromShell()
    }

    func splitTabBar(_ controller: SplitPaneController, didFocusPane pane: PaneID) {
        guard isApplyingSnapshot == false,
              isSynchronizingSelection == false,
              let store,
              let selectedTab = controller.selectedTab(inPane: pane),
              let paneIDString = paneIDString(for: pane),
              let workspacePaneID = workspacePaneIDByBonsplitPaneID[paneIDString],
              let slotID = slotIDByBonsplitTabID[tabIDString(for: selectedTab.id) ?? ""] else {
            return
        }

        store.handleVisibleWorkspaceInteraction(
            paneID: workspacePaneID,
            slotID: slotID,
            focusRequested: store.keyboardNavigationArea == .workspace
        )
        renderedWorkspace = store.visibleWorkspace
        synchronizeTerminalFocus()
    }

    func splitTabBar(_ controller: SplitPaneController, shouldSplitPane pane: PaneID, orientation: SplitOrientation) -> Bool {
        true
    }

    func splitTabBar(_ controller: SplitPaneController, didChangeGeometry snapshot: LayoutSnapshot) {}
}

// Compares two layout nodes structurally: same pane IDs, same slot membership, same
// split shape. Intentionally ignores selectedIndex (tab selection) and ratios (divider
// positions) so that focus/selection changes don't trigger a full controller rebuild.
private func structurallyEqual(_ lhs: WorkspaceLayoutNode, _ rhs: WorkspaceLayoutNode) -> Bool {
    switch (lhs, rhs) {
    case (.leaf(let lID, let lContent), .leaf(let rID, let rContent)):
        return lID == rID && lContent.slotIDs == rContent.slotIDs
    case (.split(let lID, let lAxis, let lChildren, _), .split(let rID, let rAxis, let rChildren, _)):
        guard lID == rID, lAxis == rAxis, lChildren.count == rChildren.count else { return false }
        return zip(lChildren, rChildren).allSatisfy { structurallyEqual($0, $1) }
    default:
        return false
    }
}

private extension WorkspaceLayoutAxis {
    var bonsplitOrientation: SplitOrientation {
        switch self {
        case .horizontal:
            return .horizontal
        case .vertical:
            return .vertical
        }
    }
}
