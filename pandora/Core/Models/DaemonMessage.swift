//
//  DaemonMessage.swift
//  pandora
//
//  Created by Manik Rana on 24/03/26.
//

import Foundation

enum DaemonMessage: Decodable {
    case slotSnapshot([SlotState])
    case sessionSnapshot([SessionState])
    case slotStateChanged(SlotState)
    case sessionStateChanged(SessionState)
    case slotAdded(SlotState)
    case slotRemoved(String)
    case sessionOpened(SessionState)
    case sessionClosed(String)
    case outputChunk(sessionID: String, data: Data)
    case error(String)

    private enum CodingKeys: String, CodingKey {
        case type
        case slots
        case sessions
        case slot
        case session
        case slotID
        case sessionID
        case data
        case message
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(String.self, forKey: .type)

        switch type {
        case "slot_snapshot":
            self = .slotSnapshot(try container.decode([SlotState].self, forKey: .slots))
        case "session_snapshot":
            self = .sessionSnapshot(try container.decode([SessionState].self, forKey: .sessions))
        case "slot_state_changed":
            self = .slotStateChanged(try container.decode(SlotState.self, forKey: .slot))
        case "session_state_changed":
            self = .sessionStateChanged(try container.decode(SessionState.self, forKey: .session))
        case "slot_added":
            self = .slotAdded(try container.decode(SlotState.self, forKey: .slot))
        case "slot_removed":
            self = .slotRemoved(try container.decode(String.self, forKey: .slotID))
        case "session_opened":
            self = .sessionOpened(try container.decode(SessionState.self, forKey: .session))
        case "session_closed":
            self = .sessionClosed(try container.decode(String.self, forKey: .sessionID))
        case "output_chunk":
            let sessionID = try container.decode(String.self, forKey: .sessionID)
            let base64 = try container.decode(String.self, forKey: .data)
            self = .outputChunk(sessionID: sessionID, data: Data(base64Encoded: base64) ?? Data())
        case "error":
            self = .error(try container.decode(String.self, forKey: .message))
        default:
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "Unknown daemon message: \(type)")
        }
    }
}
