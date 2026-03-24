//
//  SlotPresentationMode.swift
//  pandora
//
//  Created by Manik Rana on 24/03/26.
//

import Foundation

enum SlotPresentationMode: String, Codable, CaseIterable, Identifiable {
    case single
    case tabs
    case split

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .single:
            return "Single"
        case .tabs:
            return "Tabs"
        case .split:
            return "Split"
        }
    }
}
