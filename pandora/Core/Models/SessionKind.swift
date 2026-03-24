//
//  SessionKind.swift
//  pandora
//
//  Created by Manik Rana on 24/03/26.
//

import Foundation

enum SessionKind: String, Codable, CaseIterable, Identifiable {
    case process
    case agent
    case terminal

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .process:
            return "Process"
        case .agent:
            return "Agent"
        case .terminal:
            return "Terminal"
        }
    }

    var symbolName: String {
        switch self {
        case .process:
            return "gearshape"
        case .agent:
            return "sparkles"
        case .terminal:
            return "terminal"
        }
    }
}
