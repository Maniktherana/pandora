//
//  SlotDefinition.swift
//  pandora
//
//  Created by Manik Rana on 24/03/26.
//

import Foundation

struct SlotDefinition: Identifiable, Codable, Equatable, Hashable {
    let id: String
    var kind: SlotKind
    var name: String
    var autostart: Bool
    var presentationMode: SlotPresentationMode
    var primarySessionDefinitionID: String?
    var sessionDefinitionIDs: [String]
    var persisted: Bool
    var sortOrder: Int

    enum CodingKeys: String, CodingKey {
        case id
        case kind
        case name
        case autostart
        case presentationMode
        case primarySessionDefinitionID = "primarySessionDefID"
        case sessionDefinitionIDs = "sessionDefIDs"
        case persisted
        case sortOrder
    }
}
