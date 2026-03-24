//
//  PandoraWorkspaceController.swift
//  pandora
//
//  Created by Codex on 25/03/26.
//

import Bonsplit
import Combine
import SwiftUI

@MainActor
final class PandoraWorkspaceController: NSObject, ObservableObject {
    @Published private(set) var bonsplitController: BonsplitController

    weak var store: WorkspaceStore?
    weak var surfaceRegistry: SurfaceRegistry?

    private var renderedWorkspace: WorkspaceEntry?
    private var workspacePaneIDByBonsplitPaneID: [String: UUID] = [:]
    private var bonsplitPaneIDByWorkspacePaneID: [UUID: PaneID] = [:]
    private var slotIDByBonsplitTabID: [String: String] = [:]
    private var bonsplitTabIDBySlotID: [String: TabID] = [:]
    private var isApplyingSnapshot = false

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

        guard renderedWorkspace != workspace else {
            syncVisibleSelection(to: workspace)
            return
        }

        isApplyingSnapshot = true
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
    func selectAdjacentTab(forward: Bool) -> Bool {
        guard let paneID = bonsplitController.focusedPaneId else { return false }
        let tabs = bonsplitController.tabs(inPane: paneID)
        guard tabs.count > 1 else { return false }
        if forward {
            bonsplitController.selectNextTab()
        } else {
            bonsplitController.selectPreviousTab()
        }
        return true
    }

    func synchronizeTerminalFocus() {
        guard let store, let surfaceRegistry else { return }

        if store.keyboardNavigationArea == .workspace,
           let sessionID = store.actualFocusedSession?.id {
            _ = surfaceRegistry.focus(sessionID: sessionID)
        } else {
            surfaceRegistry.clearFocus()
        }
    }

    func slotID(for tabID: TabID) -> String? {
        guard let bonsplitTabID = tabIDString(for: tabID) else { return nil }
        return slotIDByBonsplitTabID[bonsplitTabID]
    }

    func slotID(forDragTabIdentifier identifier: String) -> String? {
        slotIDByBonsplitTabID[identifier.lowercased()]
    }

    private func materialize(
        node: WorkspaceLayoutNode,
        in paneID: PaneID,
        controller: BonsplitController,
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
                guard let newPaneID = controller.splitPane(splitBasePaneID, orientation: axis.bonsplitOrientation) else {
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
        controller: BonsplitController,
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

    private func clearWelcomeTab(in controller: BonsplitController) {
        for tabID in controller.allTabIds {
            _ = controller.closeTab(tabID)
        }
    }

    private static func makeController() -> BonsplitController {
        let configuration = BonsplitConfiguration(
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

        return BonsplitController(configuration: configuration)
    }

    private func paneIDString(for paneID: PaneID) -> String? {
        (Mirror(reflecting: paneID).descendant("id") as? UUID)?.uuidString.lowercased()
    }

    private func tabIDString(for tabID: TabID) -> String? {
        (Mirror(reflecting: tabID).descendant("id") as? UUID)?.uuidString.lowercased()
    }
}

extension PandoraWorkspaceController: BonsplitDelegate {
    func splitTabBar(_ controller: BonsplitController, didSelectTab tab: Bonsplit.Tab, inPane pane: PaneID) {
        guard isApplyingSnapshot == false,
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

    func splitTabBar(_ controller: BonsplitController, didMoveTab tab: Bonsplit.Tab, fromPane source: PaneID, toPane destination: PaneID) {
        rebuildWorkspaceFromShell()
    }

    func splitTabBar(_ controller: BonsplitController, didFocusPane pane: PaneID) {
        guard isApplyingSnapshot == false,
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

    func splitTabBar(_ controller: BonsplitController, shouldSplitPane pane: PaneID, orientation: SplitOrientation) -> Bool {
        false
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
