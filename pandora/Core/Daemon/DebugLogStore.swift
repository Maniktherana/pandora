//
//  DebugLogStore.swift
//  pandora
//
//  Created by Manik Rana on 24/03/26.
//

import Combine
import Foundation

@MainActor
final class DebugLogStore: ObservableObject {
    static let shared = DebugLogStore()

    @Published private(set) var lines: [String] = []

    private let timestampFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss"
        return formatter
    }()

    func append(_ message: String, source: String) {
        let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.isEmpty == false else { return }

        let timestamp = timestampFormatter.string(from: Date())
        lines.append("[\(timestamp)] \(source): \(trimmed)")

        if lines.count > 200 {
            lines.removeFirst(lines.count - 200)
        }
    }
}
