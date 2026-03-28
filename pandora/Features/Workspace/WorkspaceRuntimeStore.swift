import Combine
import Foundation

@MainActor
final class WorkspaceRuntimeStore: ObservableObject {
    @Published private(set) var workspace: WorkspaceRecord
    @Published private(set) var runtimeEntry: WorkspaceEntry?
    @Published private(set) var slots: [SlotState] = []
    @Published private(set) var sessions: [SessionState] = []
    @Published private(set) var connectionState: ConnectionState = .disconnected
    @Published private(set) var lastErrorMessage: String?
    @Published var focusedTerminalTarget: WorkspaceLeafTarget?

    let daemonClient: DaemonClient
    let surfaceRegistry: SurfaceRegistry

    private let appDatabase: AppDatabase
    private let defaultCwd: String
    private var cancellables: Set<AnyCancellable> = []
    private var hasSeededFallbackTerminal = false

    init(
        workspace: WorkspaceRecord,
        daemonClient: DaemonClient,
        surfaceRegistry: SurfaceRegistry,
        appDatabase: AppDatabase,
        defaultCwd: String
    ) {
        self.workspace = workspace
        self.daemonClient = daemonClient
        self.surfaceRegistry = surfaceRegistry
        self.appDatabase = appDatabase
        self.defaultCwd = defaultCwd

        surfaceRegistry.configure(daemonClient: daemonClient)
        bootstrapRuntimeEntry()
        bindDaemon()
    }

    var slotsByID: [String: SlotState] {
        Dictionary(uniqueKeysWithValues: slots.map { ($0.id, $0) })
    }

    var sessionsByID: [String: SessionState] {
        Dictionary(uniqueKeysWithValues: sessions.map { ($0.id, $0) })
    }

    var visibleWorkspace: WorkspaceEntry? {
        runtimeEntry
    }

    var actualFocusedSession: SessionState? {
        guard let target = focusedTerminalTarget, let slot = slotsByID[target.slotID] else { return nil }
        return slot.primarySession(using: sessionsByID)
    }

    func connect() {
        daemonClient.connect()
    }

    func updateWorkspace(_ workspace: WorkspaceRecord) {
        self.workspace = workspace
    }

    func markOpened() {
        var updated = workspace
        updated.lastOpenedAt = Date()
        updated.updatedAt = Date()
        workspace = updated
        appDatabase.upsert(workspace: updated)
    }

    func handleVisibleWorkspaceInteraction(paneID: UUID, slotID: String) {
        guard var runtimeEntry else { return }
        runtimeEntry.focusedPaneID = paneID
        runtimeEntry.root = runtimeEntry.root.selecting(slotID: slotID)
        self.runtimeEntry = runtimeEntry
        focusedTerminalTarget = WorkspaceLeafTarget(paneID: paneID, slotID: slotID)
        persistLayout()
    }

    func replaceVisibleWorkspaceLayout(root: WorkspaceLayoutNode, focusedPaneID: UUID?) {
        guard var runtimeEntry else { return }
        runtimeEntry.root = root
        runtimeEntry.focusedPaneID = focusedPaneID ?? root.defaultLeafTarget?.paneID
        self.runtimeEntry = runtimeEntry
        if let focusedTerminalTarget,
           let target = root.leafTarget(forSlotID: focusedTerminalTarget.slotID) {
            self.focusedTerminalTarget = target
        } else {
            self.focusedTerminalTarget = runtimeEntry.activeFocusTarget ?? runtimeEntry.defaultFocusTarget
        }
        persistLayout()
    }

    func focusCurrentSession() {
        if let sessionID = actualFocusedSession?.id {
            _ = surfaceRegistry.focus(sessionID: sessionID, notifyFocusChange: false)
        } else {
            surfaceRegistry.clearFocus()
        }
    }

    func createTerminal(in paneID: UUID? = nil) {
        let slotID = UUID().uuidString.lowercased()
        let sessionID = UUID().uuidString.lowercased()
        let terminalIndex = max(slots.count, runtimeEntry?.memberSlotIDs.count ?? 0) + 1
        let title = terminalIndex == 1 ? "Local Terminal" : "Terminal \(terminalIndex)"
        let nextSortOrder = (slots.map(\.sortOrder).max() ?? -1) + 1

        let slot = SlotDefinition(
            id: slotID,
            kind: .terminalSlot,
            name: title,
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
            name: title,
            command: "exec ${SHELL:-/bin/zsh} -i",
            cwd: defaultCwd,
            port: nil,
            envOverrides: [:],
            restartPolicy: .manual,
            pauseSupported: true,
            resumeSupported: true
        )

        if var runtimeEntry {
            let targetPaneID = paneID ?? focusedTerminalTarget?.paneID ?? runtimeEntry.activeFocusTarget?.paneID ?? runtimeEntry.defaultFocusTarget?.paneID
            if let targetPaneID {
                runtimeEntry.root = runtimeEntry.root.addingTab(slotID: slotID, toPaneID: targetPaneID)
                runtimeEntry.focusedPaneID = targetPaneID
                self.runtimeEntry = runtimeEntry
                focusedTerminalTarget = WorkspaceLeafTarget(paneID: targetPaneID, slotID: slotID)
                persistLayout()
            }
        }

        daemonClient.createSlot(slot)
        daemonClient.createSessionDefinition(session)
        daemonClient.startSlot(id: slotID)
    }

    private func bindDaemon() {
        daemonClient.onOutputChunk = { [weak self] sessionID, data in
            Task { @MainActor [weak self] in
                self?.surfaceRegistry.feedOutput(sessionID: sessionID, data: data)
            }
        }

        daemonClient.$slots
            .combineLatest(daemonClient.$sessions, daemonClient.$connectionState, daemonClient.$lastErrorMessage)
            .combineLatest(daemonClient.$hasReceivedInitialSnapshot)
            .sink { [weak self] payload, hasReceivedInitialSnapshot in
                guard let self else { return }
                let (slots, sessions, connectionState, lastErrorMessage) = payload
                self.slots = slots.sorted(by: SlotState.sortComparator)
                self.sessions = sessions
                self.connectionState = connectionState
                self.lastErrorMessage = lastErrorMessage
                if connectionState != .connected {
                    self.hasSeededFallbackTerminal = false
                } else if hasReceivedInitialSnapshot, slots.isEmpty, self.hasSeededFallbackTerminal == false {
                    self.hasSeededFallbackTerminal = true
                    self.createTerminal()
                    return
                }
                self.reconcileRuntimeEntry()
            }
            .store(in: &cancellables)

        surfaceRegistry.onFocusSession = { [weak self] sessionID in
            Task { @MainActor [weak self] in
                self?.focusSessionFromSurface(sessionID: sessionID)
            }
        }
    }

    private func focusSessionFromSurface(sessionID: String) {
        guard let session = sessionsByID[sessionID],
              let runtimeEntry,
              let target = runtimeEntry.root.leafTarget(forSlotID: session.slotID) else {
            return
        }
        focusedTerminalTarget = target
        handleVisibleWorkspaceInteraction(paneID: target.paneID, slotID: target.slotID)
    }

    private func reconcileRuntimeEntry() {
        let slotIDs = slots.map(\.id)
        guard slotIDs.isEmpty == false else {
            runtimeEntry = runtimeEntry ?? emptyRuntimeEntry()
            focusedTerminalTarget = runtimeEntry?.activeFocusTarget ?? runtimeEntry?.defaultFocusTarget
            return
        }

        let loaded = appDatabase.loadLayout(workspaceID: workspace.id)
        let available = Set(slotIDs)
        let candidateRoot = (runtimeEntry?.root ?? loaded?.root)?.removingMissingSlots(available: available)
        let root = {
            guard let candidateRoot else { return defaultRoot(for: slotIDs) }
            return candidateRoot.memberSlotIDs.isEmpty ? defaultRoot(for: slotIDs) : candidateRoot
        }()
        let resolvedRoot = root.resolvingTabSelections(using: sessionsByID, slotsByID: slotsByID)
        let focusedPane = runtimeEntry?.focusedPaneID ?? loaded?.focusedPaneID ?? resolvedRoot.defaultLeafTarget?.paneID

        runtimeEntry = WorkspaceEntry(
            id: workspace.id,
            root: resolvedRoot,
            focusedPaneID: focusedPane,
            sortOrder: 0,
            titleOverride: workspace.name
        )

        if let focusedTerminalTarget,
           let target = resolvedRoot.leafTarget(forSlotID: focusedTerminalTarget.slotID) {
            self.focusedTerminalTarget = target
        } else {
            self.focusedTerminalTarget = runtimeEntry?.activeFocusTarget ?? runtimeEntry?.defaultFocusTarget
        }

        persistLayout()
    }

    private func defaultRoot(for slotIDs: [String]) -> WorkspaceLayoutNode {
        let paneID = UUID()
        if slotIDs.count == 1, let slotID = slotIDs.first {
            return .leaf(id: paneID, content: .single(slotID: slotID))
        }
        return .leaf(id: paneID, content: .tabs(slotIDs: slotIDs, selectedIndex: max(slotIDs.count - 1, 0)))
    }

    private func bootstrapRuntimeEntry() {
        if let loaded = appDatabase.loadLayout(workspaceID: workspace.id) {
            runtimeEntry = WorkspaceEntry(
                id: workspace.id,
                root: loaded.root,
                focusedPaneID: loaded.focusedPaneID ?? loaded.root.defaultLeafTarget?.paneID,
                sortOrder: 0,
                titleOverride: workspace.name
            )
        } else {
            runtimeEntry = emptyRuntimeEntry()
        }
    }

    private func emptyRuntimeEntry() -> WorkspaceEntry {
        let paneID = UUID()
        let root = WorkspaceLayoutNode.leaf(id: paneID, content: .tabs(slotIDs: [], selectedIndex: 0))
        return WorkspaceEntry(
            id: workspace.id,
            root: root,
            focusedPaneID: paneID,
            sortOrder: 0,
            titleOverride: workspace.name
        )
    }

    private func persistLayout() {
        guard let runtimeEntry else { return }
        appDatabase.saveLayout(workspaceID: workspace.id, root: runtimeEntry.root, focusedPaneID: runtimeEntry.focusedPaneID)
    }
}

private extension WorkspaceLayoutNode {
    func removingMissingSlots(available: Set<String>) -> WorkspaceLayoutNode? {
        let missing = Set(memberSlotIDs).subtracting(available)
        return missing.reduce(Optional(self)) { partial, slotID in
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

extension WorkspaceLayoutAxis {
    var bonsplitOrientation: SplitOrientation {
        switch self {
        case .horizontal:
            return .horizontal
        case .vertical:
            return .vertical
        }
    }
}
