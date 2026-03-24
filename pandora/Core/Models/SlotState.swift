//
//  SlotState.swift
//  pandora
//
//  Created by Manik Rana on 24/03/26.
//

import Foundation

struct SlotState: Identifiable, Codable, Equatable {
    let id: String
    let kind: SlotKind
    var name: String
    var autostart: Bool
    var presentationMode: SlotPresentationMode
    var primarySessionDefID: String?
    var sessionDefIDs: [String]
    var persisted: Bool
    var sortOrder: Int
    var aggregateStatus: AggregateStatus
    var sessionIDs: [String]
    var capabilities: ActionCapabilities

    var metadataText: String? {
        if sessionIDs.count > 1 {
            return "\(sessionIDs.count) sessions"
        }
        return nil
    }

    var childCount: Int {
        max(sessionIDs.count, sessionDefIDs.count, 1)
    }

    var section: SlotSection {
        kind.section
    }

    func matches(searchText: String, sessionsByID: [String: SessionState]) -> Bool {
        let trimmed = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return true }

        let needle = trimmed.localizedLowercase
        if name.localizedLowercase.contains(needle) {
            return true
        }

        if sessionIDs.contains(where: { sessionsByID[$0]?.name.localizedLowercase.contains(needle) == true }) {
            return true
        }

        return metadataText?.localizedLowercase.contains(needle) == true
    }

    func primarySession(using sessionsByID: [String: SessionState]) -> SessionState? {
        if let explicitPrimary = primarySessionDefID,
           let session = sessionsByID.values.first(where: { $0.sessionDefID == explicitPrimary && $0.slotID == id }) {
            return session
        }

        if let firstSessionID = sessionIDs.first {
            return sessionsByID[firstSessionID]
        }

        return sessionsByID.values.first(where: { $0.slotID == id })
    }
}
