//
//  DaemonClient.swift
//  pandora
//
//  Created by Manik Rana on 24/03/26.
//

import CryptoKit
import Combine
import Foundation
import Network

@MainActor
final class DaemonClient: ObservableObject {
    private static let initialConnectionTimeoutNanoseconds: UInt64 = 12_000_000_000
    private static let reconnectDelayNanoseconds: UInt64 = 400_000_000

    @Published private(set) var slots: [SlotState] = []
    @Published private(set) var sessions: [SessionState] = []
    @Published private(set) var connectionState: ConnectionState = .disconnected
    @Published private(set) var isConnected = false
    @Published var lastErrorMessage: String?

    var onOutputChunk: ((String, Data) -> Void)?

    private let projectPath: String
    private let socketPath: String
    private var connection: NWConnection?
    private var connectionTimeoutTask: Task<Void, Never>?
    private var reconnectTask: Task<Void, Never>?
    private var shouldMaintainConnection = false
    private var receiveBuffer = Data()
    private let debugLogStore = DebugLogStore.shared

    init(projectPath: String) {
        self.projectPath = (projectPath as NSString).standardizingPath
        let digest = SHA256.hash(data: Data(self.projectPath.utf8))
        let hashPrefix = digest.compactMap { String(format: "%02x", $0) }.joined().prefix(8)
        self.socketPath = "/tmp/pandora-\(hashPrefix).sock"
        debugLogStore.append("Socket path resolved to \(socketPath)", source: "client")
    }

    func connect() {
        guard connection == nil else { return }
        shouldMaintainConnection = true
        connectionState = .connecting
        debugLogStore.append("Connecting to \(socketPath)", source: "client")
        reconnectTask?.cancel()
        beginConnectionAttempt()
        scheduleConnectionTimeout()
    }

    func disconnect() {
        shouldMaintainConnection = false
        connectionTimeoutTask?.cancel()
        connectionTimeoutTask = nil
        reconnectTask?.cancel()
        reconnectTask = nil
        connection?.cancel()
        connection = nil
        isConnected = false
        connectionState = .disconnected
    }

    var groupedSlots: [(String, [SlotState])] {
        let grouped = Dictionary(grouping: slots.sorted { lhs, rhs in
            if lhs.sortOrder == rhs.sortOrder {
                return lhs.name.localizedCaseInsensitiveCompare(rhs.name) == .orderedAscending
            }
            return lhs.sortOrder < rhs.sortOrder
        }, by: { $0.kind.sectionTitle })

        return ["AGENTS", "TERMINALS", "PROCESSES"].compactMap { key in
            guard let values = grouped[key], !values.isEmpty else { return nil }
            return (key, values)
        }
    }

    func session(for id: String?) -> SessionState? {
        guard let id else { return nil }
        return sessions.first(where: { $0.id == id })
    }

    func sessions(for slotID: String) -> [SessionState] {
        sessions.filter { $0.slotID == slotID }
    }

    var debugSocketPath: String {
        socketPath
    }

    func createSlot(_ slot: SlotDefinition) { send(.createSlot(slot)) }
    func updateSlot(_ slot: SlotDefinition) { send(.updateSlot(slot)) }
    func removeSlot(id: String) { send(.removeSlot(id: id)) }

    func createSessionDefinition(_ definition: SessionDefinition) { send(.createSessionDefinition(definition)) }
    func updateSessionDefinition(_ definition: SessionDefinition) { send(.updateSessionDefinition(definition)) }
    func removeSessionDefinition(id: String) { send(.removeSessionDefinition(id: id)) }

    func startSlot(id: String) { send(.startSlot(id: id)) }
    func stopSlot(id: String) { send(.stopSlot(id: id)) }
    func restartSlot(id: String) { send(.restartSlot(id: id)) }
    func pauseSlot(id: String) { send(.pauseSlot(id: id)) }
    func resumeSlot(id: String) { send(.resumeSlot(id: id)) }

    func startSession(id: String) { send(.startSession(id: id)) }
    func stopSession(id: String) { send(.stopSession(id: id)) }
    func restartSession(id: String) { send(.restartSession(id: id)) }
    func pauseSession(id: String) { send(.pauseSession(id: id)) }
    func resumeSession(id: String) { send(.resumeSession(id: id)) }

    func openSessionInstance(slotID: String, sessionDefinitionID: String) {
        send(.openSessionInstance(slotID: slotID, sessionDefinitionID: sessionDefinitionID))
    }

    func closeSessionInstance(id: String) { send(.closeSessionInstance(id: id)) }

    func input(sessionID: String, data: Data) { send(.input(sessionID: sessionID, data: data)) }

    func resize(sessionID: String, cols: Int, rows: Int) {
        send(.resize(sessionID: sessionID, cols: cols, rows: rows))
    }

    private func send(_ message: ClientMessage) {
        guard let connection else { return }
        guard let payload = try? JSONEncoder().encode(message) else { return }

        var framed = Data()
        var length = UInt32(payload.count).bigEndian
        withUnsafeBytes(of: &length) { framed.append(contentsOf: $0) }
        framed.append(payload)

        connection.send(content: framed, completion: .contentProcessed { [weak self] error in
            Task { @MainActor [weak self] in
                guard let self, let error else { return }
                self.connectionState = .failed(error.localizedDescription)
                self.lastErrorMessage = error.localizedDescription
            }
        })
    }

    private func startReceiveLoop() {
        connection?.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, isComplete, error in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.handleReceive(data: data, isComplete: isComplete, error: error)
            }
        }
    }

    private func handleConnectionState(_ state: NWConnection.State) {
        switch state {
        case .ready:
            connectionTimeoutTask?.cancel()
            connectionTimeoutTask = nil
            reconnectTask?.cancel()
            reconnectTask = nil
            isConnected = true
            connectionState = .connected
            lastErrorMessage = nil
            debugLogStore.append("Connected to daemon socket", source: "client")
            startReceiveLoop()
        case .failed(let error):
            isConnected = false
            if shouldMaintainConnection {
                connectionState = .connecting
                lastErrorMessage = nil
            } else {
                connectionState = .failed(error.localizedDescription)
                lastErrorMessage = error.localizedDescription
            }
            connection = nil
            debugLogStore.append("Connection failed: \(error.localizedDescription)", source: "client")
            scheduleReconnectIfNeeded()
        case .cancelled:
            isConnected = false
            connectionState = shouldMaintainConnection ? .connecting : .disconnected
            connection = nil
            debugLogStore.append("Connection cancelled", source: "client")
            scheduleReconnectIfNeeded()
        default:
            break
        }
    }

    private func handleReceive(data: Data?, isComplete: Bool, error: NWError?) {
        if let data, !data.isEmpty {
            receiveBuffer.append(data)
            decodeMessages()
        }
        if let error {
            isConnected = false
            if shouldMaintainConnection {
                connectionState = .connecting
                lastErrorMessage = nil
            } else {
                connectionState = .failed(error.localizedDescription)
                lastErrorMessage = error.localizedDescription
            }
            connection = nil
            debugLogStore.append("Receive failed: \(error.localizedDescription)", source: "client")
            scheduleReconnectIfNeeded()
            return
        }
        if isComplete {
            isConnected = false
            connectionState = shouldMaintainConnection ? .connecting : .disconnected
            connection = nil
            debugLogStore.append("Socket closed by daemon", source: "client")
            scheduleReconnectIfNeeded()
            return
        }
        startReceiveLoop()
    }

    private func scheduleConnectionTimeout() {
        connectionTimeoutTask?.cancel()
        connectionTimeoutTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: Self.initialConnectionTimeoutNanoseconds)
            guard let self, self.connectionState == .connecting else { return }
            // Soft timeout: daemon startup can be slow; keep retrying instead of giving up.
            self.connectionState = .connecting
            self.lastErrorMessage = "Pandorad is still starting. Retrying…"
            self.connection?.cancel()
            self.connection = nil
            self.isConnected = false
            self.debugLogStore.append("Daemon connection still pending; continuing retries", source: "client")
            self.scheduleReconnectIfNeeded()
            self.scheduleConnectionTimeout()
        }
    }

    private func beginConnectionAttempt() {
        guard shouldMaintainConnection, connection == nil else { return }

        let endpoint = NWEndpoint.unix(path: socketPath)
        let connection = NWConnection(to: endpoint, using: .tcp)
        self.connection = connection

        connection.stateUpdateHandler = { [weak self] state in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.handleConnectionState(state)
            }
        }

        connection.start(queue: .global(qos: .userInitiated))
    }

    private func scheduleReconnectIfNeeded() {
        guard shouldMaintainConnection, connection == nil, reconnectTask == nil else { return }

        reconnectTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: Self.reconnectDelayNanoseconds)
            guard let self else { return }
            self.reconnectTask = nil
            guard self.shouldMaintainConnection, self.connection == nil, self.connectionState == .connecting else { return }
            self.debugLogStore.append("Retrying daemon connection", source: "client")
            self.beginConnectionAttempt()
        }
    }

    private func decodeMessages() {
        while receiveBuffer.count >= 4 {
            let header = receiveBuffer.prefix(4)
            let length = header.withUnsafeBytes { $0.load(as: UInt32.self).bigEndian }
            guard receiveBuffer.count >= Int(4 + length) else { return }

            let payloadRange = 4..<Int(4 + length)
            let payload = receiveBuffer.subdata(in: payloadRange)
            receiveBuffer.removeSubrange(0..<Int(4 + length))

            do {
                let message = try JSONDecoder().decode(DaemonMessage.self, from: payload)
                apply(message)
            } catch {
                lastErrorMessage = error.localizedDescription
                debugLogStore.append("Decode failed: \(error.localizedDescription)", source: "client")
            }
        }
    }

    private func apply(_ message: DaemonMessage) {
        switch message {
        case .slotSnapshot(let slots):
            self.slots = slots
            debugLogStore.append("Received slot snapshot (\(slots.count) slots)", source: "client")
        case .sessionSnapshot(let sessions):
            self.sessions = sessions
            debugLogStore.append("Received session snapshot (\(sessions.count) sessions)", source: "client")
        case .slotStateChanged(let slot), .slotAdded(let slot):
            upsert(slot: slot)
        case .sessionStateChanged(let session), .sessionOpened(let session):
            upsert(session: session)
        case .slotRemoved(let slotID):
            slots.removeAll { $0.id == slotID }
            sessions.removeAll { $0.slotID == slotID }
            DebugLogStore.shared.append("Removed slot \(slotID)", source: "client")
        case .sessionClosed(let sessionID):
            sessions.removeAll { $0.id == sessionID }
        case .outputChunk(let sessionID, let data):
            onOutputChunk?(sessionID, data)
        case .error(let message):
            connectionState = .failed(message)
            lastErrorMessage = message
            debugLogStore.append("Daemon error: \(message)", source: "client")
        }
    }

    private func upsert(slot: SlotState) {
        if let index = slots.firstIndex(where: { $0.id == slot.id }) {
            slots[index] = slot
        } else {
            slots.append(slot)
        }
    }

    private func upsert(session: SessionState) {
        if let index = sessions.firstIndex(where: { $0.id == session.id }) {
            sessions[index] = session
        } else {
            sessions.append(session)
        }
    }
}
