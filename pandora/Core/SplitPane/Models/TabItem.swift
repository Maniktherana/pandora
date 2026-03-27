import Foundation

/// Represents a single tab in a pane's tab bar (internal representation)
struct TabItem: Identifiable, Hashable, Sendable {
    let id: UUID
    var title: String
    var icon: String?
    var isDirty: Bool

    init(
        id: UUID = UUID(),
        title: String,
        icon: String? = "doc.text",
        isDirty: Bool = false
    ) {
        self.id = id
        self.title = title
        self.icon = icon
        self.isDirty = isDirty
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }

    static func == (lhs: TabItem, rhs: TabItem) -> Bool {
        lhs.id == rhs.id
    }

    private enum CodingKeys: String, CodingKey {
        case id, title, icon, isDirty
    }
}

// Explicit nonisolated Codable conformance to avoid @MainActor isolation
// (SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor would otherwise isolate synthesized methods)
extension TabItem: Codable {
    nonisolated init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(UUID.self, forKey: .id)
        title = try c.decode(String.self, forKey: .title)
        icon = try c.decodeIfPresent(String.self, forKey: .icon)
        isDirty = try c.decode(Bool.self, forKey: .isDirty)
    }

    nonisolated func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(title, forKey: .title)
        try c.encodeIfPresent(icon, forKey: .icon)
        try c.encode(isDirty, forKey: .isDirty)
    }
}

/// Transfer data that includes source pane information for cross-pane moves
struct TabTransferData: Sendable {
    let tab: TabItem
    let sourcePaneId: UUID

    private enum CodingKeys: String, CodingKey {
        case tab, sourcePaneId
    }
}

extension TabTransferData: Codable {
    nonisolated init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        tab = try c.decode(TabItem.self, forKey: .tab)
        sourcePaneId = try c.decode(UUID.self, forKey: .sourcePaneId)
    }

    nonisolated func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(tab, forKey: .tab)
        try c.encode(sourcePaneId, forKey: .sourcePaneId)
    }
}
