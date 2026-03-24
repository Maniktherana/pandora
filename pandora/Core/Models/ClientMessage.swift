//
//  ClientMessage.swift
//  pandora
//
//  Created by Manik Rana on 24/03/26.
//

import Foundation

enum ClientMessage: Codable, Equatable {
    case createSlot(SlotDefinition)
    case updateSlot(SlotDefinition)
    case removeSlot(id: String)
    case createSessionDefinition(SessionDefinition)
    case updateSessionDefinition(SessionDefinition)
    case removeSessionDefinition(id: String)
    case startSlot(id: String)
    case stopSlot(id: String)
    case restartSlot(id: String)
    case pauseSlot(id: String)
    case resumeSlot(id: String)
    case startSession(id: String)
    case stopSession(id: String)
    case restartSession(id: String)
    case pauseSession(id: String)
    case resumeSession(id: String)
    case openSessionInstance(slotID: String, sessionDefinitionID: String)
    case closeSessionInstance(id: String)
    case input(sessionID: String, data: Data)
    case resize(sessionID: String, cols: Int, rows: Int)

    private enum CodingKeys: String, CodingKey {
        case type
        case slot
        case session
        case id
        case slotID
        case sessionDefinitionID
        case sessionID
        case data
        case cols
        case rows
    }

    private enum MessageType: String, Codable {
        case createSlot = "create_slot"
        case updateSlot = "update_slot"
        case removeSlot = "remove_slot"
        case createSessionDefinition = "create_session_def"
        case updateSessionDefinition = "update_session_def"
        case removeSessionDefinition = "remove_session_def"
        case startSlot = "start_slot"
        case stopSlot = "stop_slot"
        case restartSlot = "restart_slot"
        case pauseSlot = "pause_slot"
        case resumeSlot = "resume_slot"
        case startSession = "start_session"
        case stopSession = "stop_session"
        case restartSession = "restart_session"
        case pauseSession = "pause_session"
        case resumeSession = "resume_session"
        case openSessionInstance = "open_session_instance"
        case closeSessionInstance = "close_session_instance"
        case input = "input"
        case resize = "resize"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(MessageType.self, forKey: .type)

        switch type {
        case .createSlot:
            self = .createSlot(try container.decode(SlotDefinition.self, forKey: .slot))
        case .updateSlot:
            self = .updateSlot(try container.decode(SlotDefinition.self, forKey: .slot))
        case .removeSlot:
            self = .removeSlot(id: try container.decode(String.self, forKey: .id))
        case .createSessionDefinition:
            self = .createSessionDefinition(try container.decode(SessionDefinition.self, forKey: .session))
        case .updateSessionDefinition:
            self = .updateSessionDefinition(try container.decode(SessionDefinition.self, forKey: .session))
        case .removeSessionDefinition:
            self = .removeSessionDefinition(id: try container.decode(String.self, forKey: .id))
        case .startSlot:
            self = .startSlot(id: try container.decode(String.self, forKey: .slotID))
        case .stopSlot:
            self = .stopSlot(id: try container.decode(String.self, forKey: .slotID))
        case .restartSlot:
            self = .restartSlot(id: try container.decode(String.self, forKey: .slotID))
        case .pauseSlot:
            self = .pauseSlot(id: try container.decode(String.self, forKey: .slotID))
        case .resumeSlot:
            self = .resumeSlot(id: try container.decode(String.self, forKey: .slotID))
        case .startSession:
            self = .startSession(id: try container.decode(String.self, forKey: .sessionID))
        case .stopSession:
            self = .stopSession(id: try container.decode(String.self, forKey: .sessionID))
        case .restartSession:
            self = .restartSession(id: try container.decode(String.self, forKey: .sessionID))
        case .pauseSession:
            self = .pauseSession(id: try container.decode(String.self, forKey: .sessionID))
        case .resumeSession:
            self = .resumeSession(id: try container.decode(String.self, forKey: .sessionID))
        case .openSessionInstance:
            self = .openSessionInstance(
                slotID: try container.decode(String.self, forKey: .slotID),
                sessionDefinitionID: try container.decode(String.self, forKey: .sessionDefinitionID)
            )
        case .closeSessionInstance:
            self = .closeSessionInstance(id: try container.decode(String.self, forKey: .sessionID))
        case .input:
            self = .input(
                sessionID: try container.decode(String.self, forKey: .sessionID),
                data: try container.decode(Data.self, forKey: .data)
            )
        case .resize:
            self = .resize(
                sessionID: try container.decode(String.self, forKey: .sessionID),
                cols: try container.decode(Int.self, forKey: .cols),
                rows: try container.decode(Int.self, forKey: .rows)
            )
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)

        switch self {
        case .createSlot(let slot):
            try container.encode(MessageType.createSlot, forKey: .type)
            try container.encode(slot, forKey: .slot)
        case .updateSlot(let slot):
            try container.encode(MessageType.updateSlot, forKey: .type)
            try container.encode(slot, forKey: .slot)
        case .removeSlot(let id):
            try container.encode(MessageType.removeSlot, forKey: .type)
            try container.encode(id, forKey: .slotID)
        case .createSessionDefinition(let sessionDefinition):
            try container.encode(MessageType.createSessionDefinition, forKey: .type)
            try container.encode(sessionDefinition, forKey: .session)
        case .updateSessionDefinition(let sessionDefinition):
            try container.encode(MessageType.updateSessionDefinition, forKey: .type)
            try container.encode(sessionDefinition, forKey: .session)
        case .removeSessionDefinition(let id):
            try container.encode(MessageType.removeSessionDefinition, forKey: .type)
            try container.encode(id, forKey: .sessionDefinitionID)
        case .startSlot(let id):
            try container.encode(MessageType.startSlot, forKey: .type)
            try container.encode(id, forKey: .slotID)
        case .stopSlot(let id):
            try container.encode(MessageType.stopSlot, forKey: .type)
            try container.encode(id, forKey: .slotID)
        case .restartSlot(let id):
            try container.encode(MessageType.restartSlot, forKey: .type)
            try container.encode(id, forKey: .slotID)
        case .pauseSlot(let id):
            try container.encode(MessageType.pauseSlot, forKey: .type)
            try container.encode(id, forKey: .slotID)
        case .resumeSlot(let id):
            try container.encode(MessageType.resumeSlot, forKey: .type)
            try container.encode(id, forKey: .slotID)
        case .startSession(let id):
            try container.encode(MessageType.startSession, forKey: .type)
            try container.encode(id, forKey: .sessionID)
        case .stopSession(let id):
            try container.encode(MessageType.stopSession, forKey: .type)
            try container.encode(id, forKey: .sessionID)
        case .restartSession(let id):
            try container.encode(MessageType.restartSession, forKey: .type)
            try container.encode(id, forKey: .sessionID)
        case .pauseSession(let id):
            try container.encode(MessageType.pauseSession, forKey: .type)
            try container.encode(id, forKey: .sessionID)
        case .resumeSession(let id):
            try container.encode(MessageType.resumeSession, forKey: .type)
            try container.encode(id, forKey: .sessionID)
        case .openSessionInstance(let slotID, let sessionDefinitionID):
            try container.encode(MessageType.openSessionInstance, forKey: .type)
            try container.encode(slotID, forKey: .slotID)
            try container.encode(sessionDefinitionID, forKey: .sessionDefinitionID)
        case .closeSessionInstance(let id):
            try container.encode(MessageType.closeSessionInstance, forKey: .type)
            try container.encode(id, forKey: .sessionID)
        case .input(let sessionID, let data):
            try container.encode(MessageType.input, forKey: .type)
            try container.encode(sessionID, forKey: .sessionID)
            try container.encode(data, forKey: .data)
        case .resize(let sessionID, let cols, let rows):
            try container.encode(MessageType.resize, forKey: .type)
            try container.encode(sessionID, forKey: .sessionID)
            try container.encode(cols, forKey: .cols)
            try container.encode(rows, forKey: .rows)
        }
    }
}
