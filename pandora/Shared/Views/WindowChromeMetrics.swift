//
//  WindowChromeMetrics.swift
//  pandora
//
//  Created by Codex on 28/03/26.
//

import Combine
import Foundation

@MainActor
final class WindowChromeMetrics: ObservableObject {
    @Published var rowHeight: CGFloat = 32
    @Published var trafficLightCenterYFromTop: CGFloat = 16
    @Published var leadingClearance: CGFloat = 76
}
