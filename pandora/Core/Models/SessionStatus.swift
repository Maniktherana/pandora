//
//  SessionStatus.swift
//  pandora
//
//  Created by Manik Rana on 24/03/26.
//

import SwiftUI

enum SessionStatus: String, Codable {
    case stopped
    case running
    case crashed
    case restarting
    case paused

    var color: Color {
        switch self {
        case .running:
            return Color(nsColor: .systemGreen)
        case .paused:
            return Color(nsColor: .systemOrange)
        case .crashed:
            return Color(nsColor: .systemRed)
        case .restarting:
            return Color(nsColor: .systemYellow)
        case .stopped:
            return Color(nsColor: .systemGray)
        }
    }

    var label: String {
        switch self {
        case .running:
            return "Running"
        case .paused:
            return "Paused"
        case .crashed:
            return "Crashed"
        case .restarting:
            return "Restarting"
        case .stopped:
            return "Stopped"
        }
    }
}
