//
//  SlotKind.swift
//  pandora
//
//  Created by Manik Rana on 24/03/26.
//

import Foundation

enum SlotKind: String, Codable, CaseIterable {
    case processSlot = "process_slot"
    case agentSlot = "agent_slot"
    case terminalSlot = "terminal_slot"

    var sectionTitle: String {
        switch self {
        case .agentSlot:
            return "AGENTS"
        case .terminalSlot:
            return "TERMINALS"
        case .processSlot:
            return "PROCESSES"
        }
    }

    var section: SlotSection {
        switch self {
        case .agentSlot:
            return .agents
        case .terminalSlot:
            return .terminals
        case .processSlot:
            return .processes
        }
    }

    var displayName: String {
        switch self {
        case .agentSlot:
            return "Agent"
        case .terminalSlot:
            return "Terminal"
        case .processSlot:
            return "Process"
        }
    }
}
