//
//  SlotSection.swift
//  pandora
//
//  Created by Manik Rana on 24/03/26.
//

import Foundation

enum SlotSection: String, Codable, CaseIterable, Identifiable {
    case agents
    case terminals
    case processes

    var id: String { rawValue }

    var title: String {
        switch self {
        case .agents:
            return "AGENTS"
        case .terminals:
            return "TERMINALS"
        case .processes:
            return "PROCESSES"
        }
    }

    var sortOrder: Int {
        switch self {
        case .agents:
            return 0
        case .terminals:
            return 1
        case .processes:
            return 2
        }
    }

    var symbolName: String {
        switch self {
        case .agents:
            return "sparkles"
        case .terminals:
            return "terminal"
        case .processes:
            return "gearshape.2"
        }
    }
}
