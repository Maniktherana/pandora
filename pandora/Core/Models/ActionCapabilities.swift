//
//  ActionCapabilities.swift
//  pandora
//
//  Created by Manik Rana on 24/03/26.
//

import Foundation

struct ActionCapabilities: Codable, Equatable {
    let canFocus: Bool
    let canPause: Bool
    let canResume: Bool
    let canClear: Bool
    let canStop: Bool
    let canRestart: Bool

    static let disabled = ActionCapabilities(
        canFocus: false,
        canPause: false,
        canResume: false,
        canClear: false,
        canStop: false,
        canRestart: false
    )
}
