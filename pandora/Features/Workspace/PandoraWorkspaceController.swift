import Combine
import SwiftUI

@MainActor
final class PandoraWorkspaceController: NSObject, ObservableObject {
    @Published private(set) var bonsplitController: SplitPaneController

    weak var store: WorkspaceRuntimeStore?
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

    func bind(store: WorkspaceRuntimeStore, surfaceRegistry: SurfaceRegistry) {
        self.store = store
        self.surfaceRegistry = surfaceRegistry
    }

    func render(workspace: WorkspaceEntry?, slotsByID: [String: SlotState]) {
        guard let workspace else {
            renderedWorkspace = nil
            return
        }

        let structurallyChanged = renderedWorkspace?.id != workspace.id
            || renderedWorkspace.map { !structurallyEqual($0.root, workspace.root) } ?? true
        guard structurallyChanged else {
            renderedWorkspace = workspace
            syncTabMetadata(using: slotsByID)
            syncVisibleSelection(to: workspace)
            return
        }

        isApplyingSnapshot = true

        let previous = bonsplitController.layoutSnapshot().containerFrame
        let preservedFrame = CGRect(x: previous.x, y: previous.y, width: previous.width, height: previous.height)

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
        syncTabMetadata(using: slotsByID)
        syncVisibleSelection(to: workspace)
        isApplyingSnapshot = false
    }

    func slotID(for tabID: TabID) -> String? {
        guard let bonsplitTabID = tabIDString(for: tabID) else { return nil }
        return slotIDByBonsplitTabID[bonsplitTabID]
    }

    func slotID(forDragTabIdentifier identifier: String) -> String? {
        slotIDByBonsplitTabID[identifier.lowercased()]
    }

    func workspacePaneID(for paneID: PaneID) -> UUID? {
        guard let paneIDString = paneIDString(for: paneID) else { return nil }
        return workspacePaneIDByBonsplitPaneID[paneIDString]
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
            slotIDs = rawSlotIDs.enumerated().filter { $0.offset != selectedIndex }.map(\.element) + [selectedSlotID]
        } else {
            slotIDs = content.slotIDs
        }
        guard slotIDs.isEmpty == false else { return }

        for slotID in slotIDs {
            let title = slotsByID[slotID]?.name ?? "Workspace"
            if let tabID = controller.createTab(title: title, icon: "terminal", inPane: paneID) {
                remember(tabID: tabID, slotID: slotID)
            }
        }
    }

    private func syncVisibleSelection(to workspace: WorkspaceEntry) {
        renderedWorkspace = workspace
        if let target = workspace.activeFocusTarget ?? workspace.defaultFocusTarget,
           let paneID = bonsplitPaneIDByWorkspacePaneID[target.paneID] {
            isSynchronizingSelection = true
            defer { isSynchronizingSelection = false }
            bonsplitController.focusPane(paneID)
            if let tabID = bonsplitTabIDBySlotID[target.slotID] {
                bonsplitController.selectTab(tabID)
            }
        }
        store?.focusCurrentSession()
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
        renderedWorkspace = store.visibleWorkspace
    }

    private func rebuildNode(from node: ExternalTreeNode) -> WorkspaceLayoutNode? {
        switch node {
        case .pane(let pane):
            let slotIDs = pane.tabs.compactMap { slotIDByBonsplitTabID[$0.id.lowercased()] }
            guard slotIDs.isEmpty == false else { return nil }

            let workspacePaneID = workspacePaneIDByBonsplitPaneID[pane.id.lowercased()] ?? UUID()
            let selectedSlotID = pane.selectedTabId.flatMap { slotIDByBonsplitTabID[$0.lowercased()] } ?? slotIDs.first

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

    private func syncTabMetadata(using slotsByID: [String: SlotState]) {
        for (slotID, tabID) in bonsplitTabIDBySlotID {
            let title = slotsByID[slotID]?.name ?? "Terminal"
            bonsplitController.updateTab(tabID, title: title, icon: .some("terminal"))
        }
    }

    private func clearWelcomeTab(in controller: SplitPaneController) {
        for tabID in controller.allTabIds {
            _ = controller.closeTab(tabID)
        }
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
    func splitTabBar(_ controller: SplitPaneController, didCloseTab tabId: TabID, fromPane pane: PaneID) {
        rebuildWorkspaceFromShell()
    }

    func splitTabBar(_ controller: SplitPaneController, didSelectTab tab: Tab, inPane pane: PaneID) {
        guard isApplyingSnapshot == false,
              isSynchronizingSelection == false,
              let store,
              let paneIDString = paneIDString(for: pane),
              let workspacePaneID = workspacePaneIDByBonsplitPaneID[paneIDString],
              let slotID = slotIDByBonsplitTabID[tabIDString(for: tab.id) ?? ""] else {
            return
        }

        store.handleVisibleWorkspaceInteraction(paneID: workspacePaneID, slotID: slotID)
        renderedWorkspace = store.visibleWorkspace
        store.focusCurrentSession()
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

        store.handleVisibleWorkspaceInteraction(paneID: workspacePaneID, slotID: slotID)
        renderedWorkspace = store.visibleWorkspace
        store.focusCurrentSession()
    }

    func splitTabBar(_ controller: SplitPaneController, shouldSplitPane pane: PaneID, orientation: SplitOrientation) -> Bool {
        true
    }
}

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
