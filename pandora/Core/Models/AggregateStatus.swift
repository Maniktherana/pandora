//
//  AggregateStatus.swift
//  pandora
//
//  Created by Manik Rana on 24/03/26.
//

import SwiftUI

enum AggregateStatus: String, Codable {
    case stopped
    case running
    case crashed
    case restarting

    var color: Color {
        switch self {
        case .running:
            return Color(nsColor: .systemGreen)
        case .crashed:
            return Color(nsColor: .systemRed)
        case .restarting:
            return Color(nsColor: .systemYellow)
        case .stopped:
            return Color(nsColor: .systemGray)
        }
    }
}
