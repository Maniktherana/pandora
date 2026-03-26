//
//  SlotStore.swift
//  pandora
//
//  Created by Manik Rana on 24/03/26.
//

import Combine
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
    private var userDefinedOrder: [String] = []
    private let appStateCache = AppStateCache.shared
    private let cacheNamespace: String
    private var desiredSlotsByID: [String: SlotDefinition] = [:]
    private var desiredSessionsByID: [String: SessionDefinition] = [:]
    private var bootstrappedFromCache = false
    private var hasReconciledRuntimeForCurrentConnection = false

    init(daemonClient: DaemonClient? = nil) {
        self.daemonClient = daemonClient
        self.cacheNamespace = daemonClient?.debugSocketPath ?? "default"

        guard let daemonClient else {
            return
        }

        if let cached = appStateCache.load(namespace: cacheNamespace) {
            apply(slots: cached.slots, sessions: cached.sessions)
            bootstrappedFromCache = true
        }
        if let cachedDefinitions = appStateCache.loadDefinitions(namespace: cacheNamespace) {
            desiredSlotsByID = Dictionary(uniqueKeysWithValues: cachedDefinitions.slots.map { ($0.id, $0) })
            desiredSessionsByID = Dictionary(uniqueKeysWithValues: cachedDefinitions.sessions.map { ($0.id, $0) })
        }

        daemonClient.$slots
            .combineLatest(daemonClient.$sessions, daemonClient.$connectionState, daemonClient.$lastErrorMessage)
            .combineLatest(daemonClient.$hasReceivedInitialSnapshot)
            .sink { [weak self] payload, hasInitialSnapshot in
                guard let self else { return }
                let (slots, sessions, connectionState, lastErrorMessage) = payload
                self.connectionState = connectionState
                self.lastErrorMessage = lastErrorMessage

                if connectionState != .connected {
                    self.hasReconciledRuntimeForCurrentConnection = false
                }

                if self.bootstrappedFromCache, hasInitialSnapshot == false {
                    return
                }

                self.apply(slots: slots, sessions: sessions)
                if connectionState == .connected,
                   hasInitialSnapshot,
                   self.hasReconciledRuntimeForCurrentConnection == false {
                    self.reconcileRuntimeWithDesiredDefinitions()
                    self.hasReconciledRuntimeForCurrentConnection = true
                }
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

    func focusSessionFromSurface(sessionID: String) {
        guard let session = sessionsByID[sessionID] else { return }

        if let visibleWorkspace,
           let target = visibleWorkspace.root.leafTarget(forSlotID: session.slotID) {
            keyboardNavigationArea = .workspace
            focusedTerminalTarget = target
            updateWorkspaceFocus(workspaceID: visibleWorkspace.id, paneID: target.paneID, slotID: session.slotID)
            return
        }

        guard let workspace = workspaceEntries.first(where: { $0.memberSlotIDs.contains(session.slotID) }),
              let target = workspace.root.leafTarget(forSlotID: session.slotID) else {
            return
        }

        selectedSidebarWorkspaceID = workspace.id
        visibleWorkspaceID = workspace.id
        keyboardNavigationArea = .workspace
        focusedTerminalTarget = target
        updateWorkspaceFocus(workspaceID: workspace.id, paneID: target.paneID, slotID: session.slotID)
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
        let intent: WorkspaceDropIntent
        switch mode {
        case .tabs:
            intent = .tabs
        case .single, .split:
            intent = .splitRight
        }
        mergeWorkspaces(sourceID: sourceID, into: targetID, intent: intent)
    }

    func mergeWorkspaces(sourceID: String, into targetID: String, intent: WorkspaceDropIntent) {
        guard sourceID != targetID else { return }
        DebugLogStore.shared.append("[PANDORA] ACTION mergeWorkspaces source=\(sourceID.prefix(8)) into=\(targetID.prefix(8)) intent=\(intent)", source: "workspace")
        guard let sourceIndex = workspaceEntries.firstIndex(where: { $0.id == sourceID }),
              let targetIndex = workspaceEntries.firstIndex(where: { $0.id == targetID }) else {
            return
        }

        let source = workspaceEntries[sourceIndex]
        let target = workspaceEntries[targetIndex]

        let mergedRoot: WorkspaceLayoutNode
        switch intent {
        case .tabs:
            let sourceSlotIDs = source.memberSlotIDs
            let targetPaneID = target.activeFocusTarget?.paneID ?? target.defaultFocusTarget?.paneID
            guard sourceSlotIDs.isEmpty == false, let targetPaneID else { return }
            mergedRoot = sourceSlotIDs.reduce(target.root) { partial, slotID in
                partial.addingTab(slotID: slotID, toPaneID: targetPaneID)
            }
        case .splitLeft:
            mergedRoot = target.root.splitPrepending(source.root, axis: .horizontal)
        case .splitRight:
            mergedRoot = target.root.splitAppending(source.root, axis: .horizontal)
        case .splitUp:
            mergedRoot = target.root.splitPrepending(source.root, axis: .vertical)
        case .splitDown:
            mergedRoot = target.root.splitAppending(source.root, axis: .vertical)
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

    func mergeWorkspace(
        sourceID: String,
        into targetID: String,
        targetPaneID: UUID,
        intent: WorkspaceDropIntent
    ) {
        guard sourceID != targetID else { return }
        DebugLogStore.shared.append("[PANDORA] ACTION mergeWorkspace source=\(sourceID.prefix(8)) into=\(targetID.prefix(8)) pane=\(targetPaneID.uuidString.lowercased().prefix(8)) intent=\(intent)", source: "workspace")
        guard let source = workspaceEntries.first(where: { $0.id == sourceID }),
              let targetIndex = workspaceEntries.firstIndex(where: { $0.id == targetID }) else {
            return
        }

        var target = workspaceEntries[targetIndex]
        guard target.root.leafTarget(for: targetPaneID) != nil else { return }

        let sourceSlotIDs = source.memberSlotIDs
        guard sourceSlotIDs.isEmpty == false else { return }

        switch intent {
        case .tabs:
            let preferredSlotID = source.activeFocusTarget?.slotID ?? source.defaultFocusTarget?.slotID ?? sourceSlotIDs[0]
            let mergedRoot = sourceSlotIDs.reduce(target.root) { partial, slotID in
                partial.addingTab(slotID: slotID, toPaneID: targetPaneID)
            }
            target.root = mergedRoot.selecting(slotID: preferredSlotID)
            target.focusedPaneID = targetPaneID
            focusedTerminalTarget = WorkspaceLeafTarget(paneID: targetPaneID, slotID: preferredSlotID)

        case .splitLeft, .splitRight, .splitUp, .splitDown:
            let targetLeaf = target.root.replacingLeafSubtree(for: targetPaneID)
            guard let targetLeaf else { return }

            let replacement: WorkspaceLayoutNode
            switch intent {
            case .splitLeft:
                replacement = targetLeaf.splitPrepending(source.root, axis: .horizontal)
            case .splitRight:
                replacement = targetLeaf.splitAppending(source.root, axis: .horizontal)
            case .splitUp:
                replacement = targetLeaf.splitPrepending(source.root, axis: .vertical)
            case .splitDown:
                replacement = targetLeaf.splitAppending(source.root, axis: .vertical)
            case .tabs:
                replacement = targetLeaf
            }

            target.root = target.root.replacingLeaf(paneID: targetPaneID, with: replacement)
            let preferredTarget = source.activeFocusTarget ?? source.defaultFocusTarget ?? target.root.defaultLeafTarget
            target.focusedPaneID = preferredTarget?.paneID
            focusedTerminalTarget = preferredTarget
        }

        workspaceEntries.removeAll { $0.id == sourceID }
        if let updatedTargetIndex = workspaceEntries.firstIndex(where: { $0.id == targetID }) {
            workspaceEntries[updatedTargetIndex] = target
        } else {
            workspaceEntries.append(target)
        }

        sortWorkspaceEntries()
        selectedSidebarWorkspaceID = targetID
        visibleWorkspaceID = targetID
        keyboardNavigationArea = .workspace
    }

    func moveSlotToWorkspace(slotID: String, targetWorkspaceID: String) {
        guard let targetIndex = workspaceEntries.firstIndex(where: { $0.id == targetWorkspaceID }) else {
            return
        }

        var targetWorkspace = workspaceEntries[targetIndex]
        guard targetWorkspace.memberSlotIDs.contains(slotID) == false else {
            if let target = targetWorkspace.root.leafTarget(forSlotID: slotID) {
                targetWorkspace.focusedPaneID = target.paneID
                workspaceEntries[targetIndex] = targetWorkspace
                selectedSidebarWorkspaceID = targetWorkspaceID
                visibleWorkspaceID = targetWorkspaceID
                focusedTerminalTarget = target
                keyboardNavigationArea = .workspace
            }
            return
        }

        guard let targetPaneID = targetWorkspace.activeFocusTarget?.paneID ?? targetWorkspace.defaultFocusTarget?.paneID else {
            return
        }

        if let sourceIndex = workspaceEntries.firstIndex(where: { $0.memberSlotIDs.contains(slotID) }) {
            let sourceWorkspace = workspaceEntries[sourceIndex]
            if sourceWorkspace.memberSlotIDs.count == 1 {
                workspaceEntries.removeAll { $0.id == sourceWorkspace.id }
            } else if let updatedRoot = sourceWorkspace.root.removing(slotID: slotID) {
                workspaceEntries[sourceIndex].root = updatedRoot
                if updatedRoot.leafTarget(for: workspaceEntries[sourceIndex].focusedPaneID ?? UUID()) == nil {
                    workspaceEntries[sourceIndex].focusedPaneID = updatedRoot.defaultLeafTarget?.paneID
                }
            }
        }

        targetWorkspace.root = targetWorkspace.root.addingTab(slotID: slotID, toPaneID: targetPaneID).selecting(slotID: slotID)
        targetWorkspace.focusedPaneID = targetPaneID

        if let refreshedTargetIndex = workspaceEntries.firstIndex(where: { $0.id == targetWorkspaceID }) {
            workspaceEntries[refreshedTargetIndex] = targetWorkspace
        } else {
            workspaceEntries.append(targetWorkspace)
        }

        sortWorkspaceEntries()
        selectedSidebarWorkspaceID = targetWorkspaceID
        visibleWorkspaceID = targetWorkspaceID
        focusedTerminalTarget = WorkspaceLeafTarget(paneID: targetPaneID, slotID: slotID)
        keyboardNavigationArea = .workspace
    }

    func splitWorkspaceIntoStandaloneEntries(_ workspace: WorkspaceEntry) {
        guard workspace.memberSlotIDs.count > 1 else { return }

        workspaceEntries.removeAll { $0.id == workspace.id }
        let standalone = workspace.memberSlotIDs.compactMap { slotsByID[$0] }.map(WorkspaceEntry.standalone(for:))
        workspaceEntries.append(contentsOf: standalone)
        sortWorkspaceEntries()

        if let first = standalone.first {
            selectedSidebarWorkspaceID = first.id
            visibleWorkspaceID = first.id
        }
        focusedTerminalTarget = nil
        keyboardNavigationArea = .sidebar
    }

    func detachSlotToSidebar(slotID: String) {
        guard let workspaceIndex = workspaceEntries.firstIndex(where: { $0.memberSlotIDs.contains(slotID) }) else { return }

        let workspace = workspaceEntries[workspaceIndex]
        guard workspace.memberSlotIDs.count > 1,
              let updatedRoot = workspace.root.removing(slotID: slotID),
              let slot = slotsByID[slotID] else {
            return
        }

        workspaceEntries[workspaceIndex].root = updatedRoot
        if updatedRoot.leafTarget(for: workspaceEntries[workspaceIndex].focusedPaneID ?? UUID()) == nil {
            workspaceEntries[workspaceIndex].focusedPaneID = updatedRoot.defaultLeafTarget?.paneID
        }

        // re-key the workspace to the first remaining slot so the IDs stay consistent.
        var activeWorkspaceID = workspaceEntries[workspaceIndex].id
        if workspaceEntries[workspaceIndex].id == slotID,
           let remainingSlotID = updatedRoot.memberSlotIDs.first,
           let remainingSlot = slotsByID[remainingSlotID] {
            let reKeyedEntry = WorkspaceEntry(
                id: remainingSlotID,
                root: updatedRoot,
                focusedPaneID: workspaceEntries[workspaceIndex].focusedPaneID,
                sortOrder: remainingSlot.sortOrder,
                titleOverride: workspaceEntries[workspaceIndex].titleOverride
            )
            workspaceEntries.remove(at: workspaceIndex)
            workspaceEntries.append(reKeyedEntry)
            activeWorkspaceID = reKeyedEntry.id
        }

        if workspaceEntries.contains(where: { $0.id == slotID }) == false {
            workspaceEntries.append(.standalone(for: slot))
        }

        sortWorkspaceEntries()

        // Keep the source workspace active/focused when there are remaining tabs.
        // The detached slot should appear in the sidebar, but should not steal focus.
        selectedSidebarWorkspaceID = activeWorkspaceID
        visibleWorkspaceID = activeWorkspaceID
        if let activeWorkspace = workspaceEntries.first(where: { $0.id == activeWorkspaceID }) {
            let nextTarget = activeWorkspace.activeFocusTarget ?? activeWorkspace.defaultFocusTarget
            focusedTerminalTarget = nextTarget
            keyboardNavigationArea = nextTarget == nil ? .sidebar : .workspace
        } else {
            focusedTerminalTarget = nil
            keyboardNavigationArea = .sidebar
        }
    }

    /// Close a tab (slot) from the visible workspace and return it to the sidebar.
    ///
    /// - If the slot is part of a merged workspace (memberSlots > 1), this detaches the slot into its own standalone entry.
    /// - If the slot is the only member of its workspace, closing the last tab should "unactivate" the main area
    ///   (visibleWorkspace becomes nil) while keeping the sidebar row available for re-activation.
    func closeSlotToSidebar(slotID: String) {
        guard let workspace = workspaceEntries.first(where: { $0.memberSlotIDs.contains(slotID) }) else { return }

        if workspace.memberSlotIDs.count > 1 {
            detachSlotToSidebar(slotID: slotID)
            return
        }

        // Single-slot workspace: keep the sidebar entry, but clear the visible workspace so
        // the main area is no longer "connected" to any terminal.
        selectedSidebarWorkspaceID = workspace.id
        if visibleWorkspaceID == workspace.id {
            visibleWorkspaceID = nil
        }
        keyboardNavigationArea = .sidebar
        focusedTerminalTarget = nil
    }

    func remove(_ workspace: WorkspaceEntry) {
        let memberSlots = slots(for: workspace)
        for slot in memberSlots {
            if slot.capabilities.canStop {
                daemonClient?.stopSlot(id: slot.id)
            }
            daemonClient?.removeSlot(id: slot.id)
            removeDesiredSlot(slotID: slot.id)
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
        desiredSlotsByID[slotID] = slot
        desiredSessionsByID[sessionID] = session
        persistDesiredDefinitions()
        daemonClient?.createSlot(slot)
        daemonClient?.createSessionDefinition(session)
        daemonClient?.startSlot(id: slotID)
    }

    private func apply(slots: [SlotState], sessions: [SessionState]) {
        self.slots = slots.sorted(by: SlotState.sortComparator)
        self.sessions = sessions

        synthesizeDesiredDefinitionsFromRuntimeStates()
        reconcileWorkspaceEntries()
        reconcileSelectionAfterMutation()
        appStateCache.save(namespace: cacheNamespace, slots: self.slots, sessions: self.sessions)
    }

    private func synthesizeDesiredDefinitionsFromRuntimeStates() {
        for slot in slots where desiredSlotsByID[slot.id] == nil {
            let definition = SlotDefinition(
                id: slot.id,
                kind: slot.kind,
                name: slot.name,
                autostart: slot.autostart,
                presentationMode: slot.presentationMode,
                primarySessionDefinitionID: slot.primarySessionDefID,
                sessionDefinitionIDs: slot.sessionDefIDs,
                persisted: slot.persisted,
                sortOrder: slot.sortOrder
            )
            desiredSlotsByID[slot.id] = definition
        }

        for session in sessions where desiredSessionsByID[session.sessionDefID] == nil {
            let definition = SessionDefinition(
                id: session.sessionDefID,
                slotID: session.slotID,
                kind: session.kind,
                name: session.name,
                command: "exec ${SHELL:-/bin/zsh} -i",
                cwd: nil,
                port: session.port,
                envOverrides: [:],
                restartPolicy: .manual,
                pauseSupported: true,
                resumeSupported: true
            )
            desiredSessionsByID[definition.id] = definition
        }

        persistDesiredDefinitions()
    }

    private func reconcileRuntimeWithDesiredDefinitions() {
        guard let daemonClient else { return }

        let liveSlotIDs = Set(slots.map(\.id))
        let liveSessionDefIDs = Set(slots.flatMap(\.sessionDefIDs))

        for slot in desiredSlotsByID.values.sorted(by: { $0.sortOrder < $1.sortOrder }) where liveSlotIDs.contains(slot.id) == false {
            daemonClient.createSlot(slot)
            for sessionDefID in slot.sessionDefinitionIDs {
                if let definition = desiredSessionsByID[sessionDefID] {
                    daemonClient.createSessionDefinition(definition)
                }
            }
            if slot.autostart {
                daemonClient.startSlot(id: slot.id)
            }
        }

        for definition in desiredSessionsByID.values where liveSessionDefIDs.contains(definition.id) == false {
            guard liveSlotIDs.contains(definition.slotID) else { continue }
            daemonClient.createSessionDefinition(definition)
        }
    }

    private func removeDesiredSlot(slotID: String) {
        desiredSlotsByID.removeValue(forKey: slotID)
        desiredSessionsByID = desiredSessionsByID.filter { $0.value.slotID != slotID }
        persistDesiredDefinitions()
    }

    private func persistDesiredDefinitions() {
        appStateCache.saveDefinitions(
            namespace: cacheNamespace,
            slots: Array(desiredSlotsByID.values),
            sessions: Array(desiredSessionsByID.values)
        )
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
        sortWorkspaceEntries()

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

    private func sortWorkspaceEntries() {
        workspaceEntries.sort { lhs, rhs in
            let lhsIdx = userDefinedOrder.firstIndex(of: lhs.id)
            let rhsIdx = userDefinedOrder.firstIndex(of: rhs.id)
            if let l = lhsIdx, let r = rhsIdx { return l < r }
            if lhsIdx != nil { return true }
            if rhsIdx != nil { return false }
            if lhs.sortOrder == rhs.sortOrder {
                return lhs.title(using: slotsByID).localizedCaseInsensitiveCompare(rhs.title(using: slotsByID)) == .orderedAscending
            }
            return lhs.sortOrder < rhs.sortOrder
        }
    }

    /// Move `movingID` so it appears immediately before `insertBeforeID`.
    /// Pass `insertBeforeID: nil` to append at the end.
    func reorderWorkspace(movingID: String, insertBeforeID: String?) {
        guard workspaceEntries.contains(where: { $0.id == movingID }) else { return }

        var ordered = workspaceEntries.map(\.id)
        ordered.removeAll { $0 == movingID }

        if let beforeID = insertBeforeID, let idx = ordered.firstIndex(of: beforeID) {
            ordered.insert(movingID, at: idx)
        } else {
            ordered.append(movingID)
        }

        userDefinedOrder = ordered
        sortWorkspaceEntries()
    }

    func replaceVisibleWorkspaceLayout(root: WorkspaceLayoutNode, focusedPaneID: UUID?) {
        guard let visibleWorkspaceID,
              let index = workspaceEntries.firstIndex(where: { $0.id == visibleWorkspaceID }) else {
            return
        }

        workspaceEntries[index].root = root
        workspaceEntries[index].focusedPaneID = focusedPaneID ?? root.defaultLeafTarget?.paneID

        if let focusedTerminalTarget {
            if let updatedTarget = root.leafTarget(forSlotID: focusedTerminalTarget.slotID) {
                self.focusedTerminalTarget = updatedTarget
            } else {
                self.focusedTerminalTarget = nil
                keyboardNavigationArea = .sidebar
            }
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
    func replacingLeafSubtree(for paneID: UUID) -> WorkspaceLayoutNode? {
        switch self {
        case .leaf(let id, _):
            return id == paneID ? self : nil
        case .split(_, _, let children, _):
            for child in children {
                if let match = child.replacingLeafSubtree(for: paneID) {
                    return match
                }
            }
            return nil
        }
    }

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
