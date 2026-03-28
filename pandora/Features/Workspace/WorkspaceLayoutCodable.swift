import CoreGraphics
import Foundation

extension WorkspaceLayoutAxis: Codable {
    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        switch raw {
        case "horizontal":
            self = .horizontal
        case "vertical":
            self = .vertical
        default:
            throw DecodingError.dataCorruptedError(in: try decoder.singleValueContainer(), debugDescription: "Unknown axis \(raw)")
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .horizontal:
            try container.encode("horizontal")
        case .vertical:
            try container.encode("vertical")
        }
    }
}

extension WorkspaceLeafContent: Codable {
    private enum CodingKeys: String, CodingKey {
        case kind
        case slotID
        case slotIDs
        case selectedIndex
    }

    private enum Kind: String, Codable {
        case single
        case tabs
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(Kind.self, forKey: .kind) {
        case .single:
            self = .single(slotID: try container.decode(String.self, forKey: .slotID))
        case .tabs:
            self = .tabs(
                slotIDs: try container.decode([String].self, forKey: .slotIDs),
                selectedIndex: try container.decode(Int.self, forKey: .selectedIndex)
            )
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .single(let slotID):
            try container.encode(Kind.single, forKey: .kind)
            try container.encode(slotID, forKey: .slotID)
        case .tabs(let slotIDs, let selectedIndex):
            try container.encode(Kind.tabs, forKey: .kind)
            try container.encode(slotIDs, forKey: .slotIDs)
            try container.encode(selectedIndex, forKey: .selectedIndex)
        }
    }
}

extension WorkspaceLayoutNode: Codable {
    private enum CodingKeys: String, CodingKey {
        case kind
        case id
        case content
        case axis
        case children
        case ratios
    }

    private enum Kind: String, Codable {
        case leaf
        case split
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let nodeID = try container.decode(UUID.self, forKey: .id)
        switch try container.decode(Kind.self, forKey: .kind) {
        case .leaf:
            self = .leaf(id: nodeID, content: try container.decode(WorkspaceLeafContent.self, forKey: .content))
        case .split:
            self = .split(
                id: nodeID,
                axis: try container.decode(WorkspaceLayoutAxis.self, forKey: .axis),
                children: try container.decode([WorkspaceLayoutNode].self, forKey: .children),
                ratios: try container.decode([CGFloat].self, forKey: .ratios)
            )
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .leaf(let id, let content):
            try container.encode(Kind.leaf, forKey: .kind)
            try container.encode(id, forKey: .id)
            try container.encode(content, forKey: .content)
        case .split(let id, let axis, let children, let ratios):
            try container.encode(Kind.split, forKey: .kind)
            try container.encode(id, forKey: .id)
            try container.encode(axis, forKey: .axis)
            try container.encode(children, forKey: .children)
            try container.encode(ratios, forKey: .ratios)
        }
    }
}
