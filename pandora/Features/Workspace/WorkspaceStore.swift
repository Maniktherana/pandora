//
//  SlotStore.swift
//  pandora
//
//  Created by Manik Rana on 24/03/26.
//

import Combine
import Bonsplit
import Foundation

@MainActor
final class WorkspaceStore: ObservableObject {
    @Published var searchText: String = ""
    @Published var selectedSidebarWorkspaceID: String?
    @Published var visibleWorkspaceID: String?
    @Published var focusedTerminalTarget: WorkspaceLeafTarget?
    @Published var keyboardNavigationArea: WorkspaceNavigationArea = .sidebar
    @Published private(set) var workspaceEntries: [WorkspaceEntry] = []
    @Published private(set) var slots: [SlotState] = []
    @Published private(set) var sessions: [SessionState] = []
    @Published private(set) var connectionState: ConnectionState = .disconnected
    @Published private(set) var lastErrorMessage: String?

    let daemonClient: DaemonClient?

    private var cancellables: Set<AnyCancellable> = []
    private var pendingStandaloneSelectionSlotID: String?

    init(daemonClient: DaemonClient? = nil) {
        self.daemonClient = daemonClient

        guard let daemonClient else {
            return
        }

        daemonClient.$slots
            .combineLatest(daemonClient.$sessions, daemonClient.$connectionState, daemonClient.$lastErrorMessage)
            .sink { [weak self] slots, sessions, connectionState, lastErrorMessage in
                self?.apply(slots: slots, sessions: sessions)
                self?.connectionState = connectionState
                self?.lastErrorMessage = lastErrorMessage
            }
            .store(in: &cancellables)
    }

    var slotsByID: [String: SlotState] {
        Dictionary(uniqueKeysWithValues: slots.map { ($0.id, $0) })
    }

    var sessionsByID: [String: SessionState] {
        Dictionary(uniqueKeysWithValues: sessions.map { ($0.id, $0) })
    }

    var filteredWorkspaces: [WorkspaceEntry] {
        workspaceEntries.filter { $0.matches(searchText: searchText, slotsByID: slotsByID, sessionsByID: sessionsByID) }
    }

    var selectedWorkspace: WorkspaceEntry? {
        guard let selectedSidebarWorkspaceID else { return nil }
        return workspaceEntries.first(where: { $0.id == selectedSidebarWorkspaceID })
    }

    var visibleWorkspace: WorkspaceEntry? {
        guard let visibleWorkspaceID else { return nil }
        return workspaceEntries.first(where: { $0.id == visibleWorkspaceID })
    }

    var visibleWorkspaceTitle: String {
        visibleWorkspace?.title(using: slotsByID) ?? "Workspace"
    }

    var actualFocusedSession: SessionState? {
        targetSession(for: focusedTerminalTarget)
    }

    var actionSession: SessionState? {
        if keyboardNavigationArea == .workspace {
            return actualFocusedSession
        }
        return defaultSessionForCurrentContext()
    }

    var focusedSession: SessionState? {
        targetSession(for: focusedTerminalTarget) ?? defaultSessionForCurrentContext()
    }

    func sidebarDisplayTitle(for workspace: WorkspaceEntry) -> String {
        workspace.title(using: slotsByID)
    }

    func slots(for workspace: WorkspaceEntry) -> [SlotState] {
        workspace.memberSlotIDs.compactMap { slotsByID[$0] }
    }

    func selectSidebarWorkspace(id: String) {
        guard filteredWorkspaces.contains(where: { $0.id == id }) else { return }
        selectedSidebarWorkspaceID = id
        visibleWorkspaceID = id
        keyboardNavigationArea = .sidebar
        focusedTerminalTarget = nil
    }

    func selectSidebarWorkspace(workspace: WorkspaceEntry) {
        selectSidebarWorkspace(id: workspace.id)
    }

    func focusVisibleWorkspace() {
        guard let visibleWorkspace else { return }
        let target = visibleWorkspace.activeFocusTarget ?? visibleWorkspace.defaultFocusTarget
        guard let target else { return }
        keyboardNavigationArea = .workspace
        focusedTerminalTarget = target
        updateWorkspaceFocus(workspaceID: visibleWorkspace.id, paneID: target.paneID, slotID: target.slotID)
    }

    func unfocusWorkspace() {
        keyboardNavigationArea = .sidebar
        focusedTerminalTarget = nil
        selectedSidebarWorkspaceID = visibleWorkspaceID ?? selectedSidebarWorkspaceID
    }

    func activateSidebarNavigation() {
        keyboardNavigationArea = .sidebar
        focusedTerminalTarget = nil
        if selectedSidebarWorkspaceID == nil {
            selectedSidebarWorkspaceID = visibleWorkspaceID ?? filteredWorkspaces.first?.id
        }
        if visibleWorkspaceID == nil {
            visibleWorkspaceID = selectedSidebarWorkspaceID
        }
    }

    func handleVisibleWorkspaceInteraction(paneID: UUID, slotID: String, focusRequested: Bool) {
        guard let visibleWorkspaceID else { return }
        updateWorkspaceFocus(workspaceID: visibleWorkspaceID, paneID: paneID, slotID: slotID)
        if focusRequested {
            keyboardNavigationArea = .workspace
            focusedTerminalTarget = WorkspaceLeafTarget(paneID: paneID, slotID: slotID)
        }
    }

    func navigateSidebarSelection(offset: Int) {
        let visible = filteredWorkspaces
        guard visible.isEmpty == false else { return }

        let nextIndex: Int
        if let selectedSidebarWorkspaceID,
           let currentIndex = visible.firstIndex(where: { $0.id == selectedSidebarWorkspaceID }) {
            nextIndex = (currentIndex + offset + visible.count) % visible.count
        } else {
            nextIndex = offset < 0 ? visible.count - 1 : 0
        }

        selectSidebarWorkspace(workspace: visible[nextIndex])
    }

    @discardableResult
    func navigateVisibleWorkspace(direction: NavigationDirection) -> WorkspaceLeafTarget? {
        guard let visibleWorkspace else { return nil }
        let orderedTargets = visibleWorkspace.root.orderedLeafTargets
        guard orderedTargets.isEmpty == false else { return nil }

        let currentTarget = focusedTerminalTarget ?? visibleWorkspace.activeFocusTarget ?? visibleWorkspace.defaultFocusTarget
        let currentIndex = currentTarget.flatMap { target in
            orderedTargets.firstIndex(where: { $0.paneID == target.paneID })
        } ?? 0

        let nextIndex: Int
        switch direction {
        case .left, .up:
            nextIndex = max(currentIndex - 1, 0)
        case .right, .down:
            nextIndex = min(currentIndex + 1, orderedTargets.count - 1)
        }

        let target = orderedTargets[nextIndex]
        keyboardNavigationArea = .workspace
        focusedTerminalTarget = target
        updateWorkspaceFocus(workspaceID: visibleWorkspace.id, paneID: target.paneID, slotID: target.slotID)
        return target
    }

    @discardableResult
    func cycleVisibleTabs(forward: Bool) -> WorkspaceLeafTarget? {
        guard let visibleWorkspace else { return nil }
        let target = focusedTerminalTarget ?? visibleWorkspace.activeFocusTarget ?? visibleWorkspace.defaultFocusTarget
        guard let target else { return nil }

        guard let index = workspaceEntries.firstIndex(where: { $0.id == visibleWorkspace.id }) else { return nil }
        guard let currentLeaf = workspaceEntries[index].root.leafTarget(for: target.paneID) else { return nil }

        workspaceEntries[index].root = updateNode(workspaceEntries[index].root, targetPaneID: currentLeaf.paneID) { content in
            guard case .tabs(let slotIDs, let selectedIndex) = content, slotIDs.isEmpty == false else {
                return content
            }
            let nextIndex = forward
                ? (selectedIndex + 1) % slotIDs.count
                : (selectedIndex - 1 + slotIDs.count) % slotIDs.count
            return .tabs(slotIDs: slotIDs, selectedIndex: nextIndex)
        }

        let nextTarget = workspaceEntries[index].root.leafTarget(for: target.paneID)
        workspaceEntries[index].focusedPaneID = target.paneID
        focusedTerminalTarget = nextTarget
        return nextTarget
    }

    func mergeWorkspaces(sourceID: String, into targetID: String, mode: SlotPresentationMode = .tabs) {
        guard sourceID != targetID else { return }
        guard let sourceIndex = workspaceEntries.firstIndex(where: { $0.id == sourceID }),
              let targetIndex = workspaceEntries.firstIndex(where: { $0.id == targetID }) else {
            return
        }

        let source = workspaceEntries[sourceIndex]
        let target = workspaceEntries[targetIndex]

        let mergedRoot: WorkspaceLayoutNode
        switch mode {
        case .tabs:
            let sourceSlotIDs = source.memberSlotIDs
            let targetPaneID = target.activeFocusTarget?.paneID ?? target.defaultFocusTarget?.paneID
            guard sourceSlotIDs.isEmpty == false, let targetPaneID else { return }
            mergedRoot = sourceSlotIDs.reduce(target.root) { partial, slotID in
                partial.addingTab(slotID: slotID, toPaneID: targetPaneID)
            }
        case .single, .split:
            mergedRoot = target.root.splitAppending(source.root, axis: .horizontal)
        }

        let merged = WorkspaceEntry(
            id: UUID().uuidString.lowercased(),
            root: mergedRoot,
            focusedPaneID: mergedRoot.defaultLeafTarget?.paneID,
            sortOrder: min(source.sortOrder, target.sortOrder),
            titleOverride: nil
        )

        let removedIDs = Set([sourceID, targetID])
        workspaceEntries.removeAll { removedIDs.contains($0.id) }
        workspaceEntries.append(merged)
        workspaceEntries.sort { lhs, rhs in
            if lhs.sortOrder == rhs.sortOrder {
                return lhs.title(using: slotsByID).localizedCaseInsensitiveCompare(rhs.title(using: slotsByID)) == .orderedAscending
            }
            return lhs.sortOrder < rhs.sortOrder
        }

        selectedSidebarWorkspaceID = merged.id
        visibleWorkspaceID = merged.id
        focusedTerminalTarget = nil
        keyboardNavigationArea = .sidebar
    }

    func splitWorkspaceIntoStandaloneEntries(_ workspace: WorkspaceEntry) {
        guard workspace.memberSlotIDs.count > 1 else { return }

        workspaceEntries.removeAll { $0.id == workspace.id }
        let standalone = workspace.memberSlotIDs.compactMap { slotsByID[$0] }.map(WorkspaceEntry.standalone(for:))
        workspaceEntries.append(contentsOf: standalone)
        workspaceEntries.sort { lhs, rhs in
            if lhs.sortOrder == rhs.sortOrder {
                return lhs.title(using: slotsByID).localizedCaseInsensitiveCompare(rhs.title(using: slotsByID)) == .orderedAscending
            }
            return lhs.sortOrder < rhs.sortOrder
        }

        if let first = standalone.first {
            selectedSidebarWorkspaceID = first.id
            visibleWorkspaceID = first.id
        }
        focusedTerminalTarget = nil
        keyboardNavigationArea = .sidebar
    }

    func remove(_ workspace: WorkspaceEntry) {
        let memberSlots = slots(for: workspace)
        for slot in memberSlots {
            if slot.capabilities.canStop {
                daemonClient?.stopSlot(id: slot.id)
            }
            daemonClient?.removeSlot(id: slot.id)
        }
        workspaceEntries.removeAll { $0.id == workspace.id }
        reconcileSelectionAfterMutation()
    }

    func clearFocusedSession() {
        guard let session = actionSession else { return }
        daemonClient?.input(sessionID: session.id, data: Data("clear\n".utf8))
    }

    func pauseFocusedSession() {
        guard let session = actionSession else { return }
        daemonClient?.pauseSession(id: session.id)
    }

    func resumeFocusedSession() {
        guard let session = actionSession else { return }
        daemonClient?.resumeSession(id: session.id)
    }

    func stopFocusedSession() {
        guard let session = actionSession else { return }
        daemonClient?.stopSession(id: session.id)
    }

    func restartFocusedSession() {
        guard let session = actionSession else { return }
        daemonClient?.restartSession(id: session.id)
    }

    func createTerminalWorkspace(name: String, command: String, cwd: String?) {
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedCommand = command.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmedName.isEmpty == false, trimmedCommand.isEmpty == false else { return }

        let slotID = UUID().uuidString.lowercased()
        let sessionID = UUID().uuidString.lowercased()
        let nextSortOrder = (slots.map(\.sortOrder).max() ?? -1) + 1

        let slot = SlotDefinition(
            id: slotID,
            kind: .terminalSlot,
            name: trimmedName,
            autostart: true,
            presentationMode: .single,
            primarySessionDefinitionID: sessionID,
            sessionDefinitionIDs: [sessionID],
            persisted: true,
            sortOrder: nextSortOrder
        )

        let session = SessionDefinition(
            id: sessionID,
            slotID: slotID,
            kind: .terminal,
            name: trimmedName,
            command: trimmedCommand,
            cwd: cwd?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty,
            port: nil,
            envOverrides: [:],
            restartPolicy: .manual,
            pauseSupported: true,
            resumeSupported: true
        )

        pendingStandaloneSelectionSlotID = slotID
        daemonClient?.createSlot(slot)
        daemonClient?.createSessionDefinition(session)
        daemonClient?.startSlot(id: slotID)
    }

    private func apply(slots: [SlotState], sessions: [SessionState]) {
        self.slots = slots.sorted(by: SlotState.sortComparator)
        self.sessions = sessions

        reconcileWorkspaceEntries()
        reconcileSelectionAfterMutation()
    }

    private func reconcileWorkspaceEntries() {
        let currentSlotsByID = slotsByID
        let currentSessionsByID = sessionsByID

        workspaceEntries = workspaceEntries.compactMap { workspace in
            guard let updatedRoot = workspace.root.removingMissingSlots(available: Set(currentSlotsByID.keys)) else {
                return nil
            }

            var updated = workspace
            updated.root = updatedRoot
            if updated.root.leafTarget(for: updated.focusedPaneID ?? UUID()) == nil {
                updated.focusedPaneID = updated.root.defaultLeafTarget?.paneID
            }
            if updated.memberSlotIDs.isEmpty {
                return nil
            }
            return updated
        }

        let representedSlotIDs = Set(workspaceEntries.flatMap(\.memberSlotIDs))
        let standaloneEntries = slots
            .filter { representedSlotIDs.contains($0.id) == false }
            .map(WorkspaceEntry.standalone(for:))

        workspaceEntries.append(contentsOf: standaloneEntries)
        workspaceEntries.sort { lhs, rhs in
            if lhs.sortOrder == rhs.sortOrder {
                return lhs.title(using: currentSlotsByID).localizedCaseInsensitiveCompare(rhs.title(using: currentSlotsByID)) == .orderedAscending
            }
            return lhs.sortOrder < rhs.sortOrder
        }

        if let pendingStandaloneSelectionSlotID,
           let workspace = workspaceEntries.first(where: { $0.memberSlotIDs.contains(pendingStandaloneSelectionSlotID) }) {
            selectedSidebarWorkspaceID = workspace.id
            visibleWorkspaceID = workspace.id
            self.pendingStandaloneSelectionSlotID = nil
        }

        if let focusedTerminalTarget,
           currentSlotsByID[focusedTerminalTarget.slotID] == nil {
            self.focusedTerminalTarget = nil
            keyboardNavigationArea = .sidebar
        }

        for index in workspaceEntries.indices {
            let workspace = workspaceEntries[index]
            let resolvedRoot = workspace.root.resolvingTabSelections(using: currentSessionsByID, slotsByID: currentSlotsByID)
            workspaceEntries[index].root = resolvedRoot
            if workspaceEntries[index].focusedPaneID == nil {
                workspaceEntries[index].focusedPaneID = resolvedRoot.defaultLeafTarget?.paneID
            }
        }
    }

    private func reconcileSelectionAfterMutation() {
        let visibleIDs = Set(filteredWorkspaces.map(\.id))

        if let selectedSidebarWorkspaceID, visibleIDs.contains(selectedSidebarWorkspaceID) == false {
            self.selectedSidebarWorkspaceID = filteredWorkspaces.first?.id
        }

        if let visibleWorkspaceID, workspaceEntries.contains(where: { $0.id == visibleWorkspaceID }) == false {
            self.visibleWorkspaceID = filteredWorkspaces.first?.id
        }

        if self.selectedSidebarWorkspaceID == nil {
            self.selectedSidebarWorkspaceID = filteredWorkspaces.first?.id
        }

        if self.visibleWorkspaceID == nil {
            self.visibleWorkspaceID = self.selectedSidebarWorkspaceID ?? filteredWorkspaces.first?.id
        }
    }

    private func defaultSessionForCurrentContext() -> SessionState? {
        if let visibleWorkspace {
            return targetSession(for: visibleWorkspace.activeFocusTarget ?? visibleWorkspace.defaultFocusTarget)
        }
        return nil
    }

    private func targetSession(for target: WorkspaceLeafTarget?) -> SessionState? {
        guard let target, let slot = slotsByID[target.slotID] else { return nil }
        return slot.primarySession(using: sessionsByID)
    }

    private func updateWorkspaceFocus(workspaceID: String, paneID: UUID, slotID: String) {
        guard let index = workspaceEntries.firstIndex(where: { $0.id == workspaceID }) else { return }
        workspaceEntries[index].focusedPaneID = paneID
        workspaceEntries[index].root = workspaceEntries[index].root.selecting(slotID: slotID)
    }

    func replaceVisibleWorkspaceLayout(root: WorkspaceLayoutNode, focusedPaneID: UUID?) {
        guard let visibleWorkspaceID,
              let index = workspaceEntries.firstIndex(where: { $0.id == visibleWorkspaceID }) else {
            return
        }

        workspaceEntries[index].root = root
        workspaceEntries[index].focusedPaneID = focusedPaneID ?? root.defaultLeafTarget?.paneID

        if let focusedTerminalTarget,
           root.memberSlotIDs.contains(focusedTerminalTarget.slotID) == false {
            self.focusedTerminalTarget = nil
            keyboardNavigationArea = .sidebar
        }
    }

    private func updateNode(
        _ node: WorkspaceLayoutNode,
        targetPaneID: UUID,
        transform: (WorkspaceLeafContent) -> WorkspaceLeafContent
    ) -> WorkspaceLayoutNode {
        switch node {
        case .leaf(let id, let content):
            guard id == targetPaneID else { return node }
            return .leaf(id: id, content: transform(content))
        case .split(let id, let axis, let children, let ratios):
            return .split(
                id: id,
                axis: axis,
                children: children.map { updateNode($0, targetPaneID: targetPaneID, transform: transform) },
                ratios: ratios
            )
        }
    }
}

private extension WorkspaceLayoutNode {
    func removingMissingSlots(available: Set<String>) -> WorkspaceLayoutNode? {
        let missingSlotIDs = Set(memberSlotIDs).subtracting(available)
        return missingSlotIDs.reduce(Optional(self)) { partial, slotID in
            partial?.removing(slotID: slotID)
        }
    }

    func resolvingTabSelections(using sessionsByID: [String: SessionState], slotsByID: [String: SlotState]) -> WorkspaceLayoutNode {
        switch self {
        case .leaf(let id, let content):
            switch content {
            case .single:
                return self
            case .tabs(let slotIDs, let selectedIndex):
                let validSlotIDs = slotIDs.filter { slotsByID[$0] != nil }
                guard validSlotIDs.isEmpty == false else { return self }
                let clampedIndex = min(selectedIndex, validSlotIDs.count - 1)
                return .leaf(id: id, content: .tabs(slotIDs: validSlotIDs, selectedIndex: max(clampedIndex, 0)))
            }
        case .split(let id, let axis, let children, let ratios):
            return .split(
                id: id,
                axis: axis,
                children: children.map { $0.resolvingTabSelections(using: sessionsByID, slotsByID: slotsByID) },
                ratios: ratios
            )
        }
    }
}

private extension String {
    var nilIfEmpty: String? {
        isEmpty ? nil : self
    }
}
