//
//  WorkspaceModels.swift
//  pandora
//
//  Created by Manik Rana on 24/03/26.
//

import CoreGraphics
import Foundation

enum WorkspaceNavigationArea {
    case sidebar
    case workspace
}

enum WorkspaceLayoutAxis: Equatable {
    case horizontal
    case vertical
}

enum WorkspaceLeafContent: Equatable {
    case single(slotID: String)
    case tabs(slotIDs: [String], selectedIndex: Int)

    var slotIDs: [String] {
        switch self {
        case .single(let slotID):
            return [slotID]
        case .tabs(let slotIDs, _):
            return slotIDs
        }
    }

    var selectedSlotID: String? {
        switch self {
        case .single(let slotID):
            return slotID
        case .tabs(let slotIDs, let selectedIndex):
            guard slotIDs.indices.contains(selectedIndex) else { return slotIDs.first }
            return slotIDs[selectedIndex]
        }
    }

    func removing(slotID: String) -> WorkspaceLeafContent? {
        switch self {
        case .single(let currentSlotID):
            return currentSlotID == slotID ? nil : self
        case .tabs(let slotIDs, let selectedIndex):
            let filtered = slotIDs.filter { $0 != slotID }
            guard filtered.isEmpty == false else { return nil }
            if filtered.count == 1, let only = filtered.first {
                return .single(slotID: only)
            }
            let clampedIndex = min(selectedIndex, filtered.count - 1)
            return .tabs(slotIDs: filtered, selectedIndex: max(clampedIndex, 0))
        }
    }
}

indirect enum WorkspaceLayoutNode: Equatable {
    case leaf(id: UUID, content: WorkspaceLeafContent)
    case split(id: UUID, axis: WorkspaceLayoutAxis, children: [WorkspaceLayoutNode], ratios: [CGFloat])

    var nodeID: UUID {
        switch self {
        case .leaf(let id, _), .split(let id, _, _, _):
            return id
        }
    }

    var memberSlotIDs: [String] {
        switch self {
        case .leaf(_, let content):
            return content.slotIDs
        case .split(_, _, let children, _):
            return children.flatMap(\.memberSlotIDs)
        }
    }

    var defaultLeafTarget: WorkspaceLeafTarget? {
        switch self {
        case .leaf(let id, let content):
            guard let slotID = content.selectedSlotID else { return nil }
            return WorkspaceLeafTarget(paneID: id, slotID: slotID)
        case .split(_, _, let children, _):
            return children.first?.defaultLeafTarget
        }
    }

    var orderedLeafTargets: [WorkspaceLeafTarget] {
        switch self {
        case .leaf(let id, let content):
            guard let slotID = content.selectedSlotID else { return [] }
            return [WorkspaceLeafTarget(paneID: id, slotID: slotID)]
        case .split(_, _, let children, _):
            return children.flatMap(\.orderedLeafTargets)
        }
    }

    func leafTarget(for paneID: UUID) -> WorkspaceLeafTarget? {
        switch self {
        case .leaf(let id, let content):
            guard id == paneID, let slotID = content.selectedSlotID else { return nil }
            return WorkspaceLeafTarget(paneID: id, slotID: slotID)
        case .split(_, _, let children, _):
            for child in children {
                if let target = child.leafTarget(for: paneID) {
                    return target
                }
            }
            return nil
        }
    }

    func leafTarget(forSlotID slotID: String) -> WorkspaceLeafTarget? {
        switch self {
        case .leaf(let id, let content):
            guard content.slotIDs.contains(slotID) else { return nil }
            return WorkspaceLeafTarget(paneID: id, slotID: slotID)
        case .split(_, _, let children, _):
            for child in children {
                if let target = child.leafTarget(forSlotID: slotID) {
                    return target
                }
            }
            return nil
        }
    }

    func removing(slotID: String) -> WorkspaceLayoutNode? {
        switch self {
        case .leaf(let id, let content):
            guard let updated = content.removing(slotID: slotID) else { return nil }
            return .leaf(id: id, content: updated)
        case .split(let id, let axis, let children, let ratios):
            let updatedChildren = children.compactMap { $0.removing(slotID: slotID) }
            guard updatedChildren.isEmpty == false else { return nil }
            if updatedChildren.count == 1 {
                return updatedChildren[0]
            }
            let normalizedRatios = updatedChildren.count == ratios.count
                ? ratios
                : Array(repeating: 1 / CGFloat(updatedChildren.count), count: updatedChildren.count)
            return .split(id: id, axis: axis, children: updatedChildren, ratios: normalizedRatios)
        }
    }

    func selecting(slotID: String) -> WorkspaceLayoutNode {
        switch self {
        case .leaf(let id, let content):
            switch content {
            case .single:
                return self
            case .tabs(let slotIDs, _):
                guard let index = slotIDs.firstIndex(of: slotID) else { return self }
                return .leaf(id: id, content: .tabs(slotIDs: slotIDs, selectedIndex: index))
            }
        case .split(let id, let axis, let children, let ratios):
            return .split(id: id, axis: axis, children: children.map { $0.selecting(slotID: slotID) }, ratios: ratios)
        }
    }

    func replacingLeaf(paneID targetPaneID: UUID, with replacement: WorkspaceLayoutNode) -> WorkspaceLayoutNode {
        switch self {
        case .leaf(let id, _):
            return id == targetPaneID ? replacement : self
        case .split(let id, let axis, let children, let ratios):
            return .split(
                id: id,
                axis: axis,
                children: children.map { $0.replacingLeaf(paneID: targetPaneID, with: replacement) },
                ratios: ratios
            )
        }
    }

    func splitAppending(_ node: WorkspaceLayoutNode, axis: WorkspaceLayoutAxis) -> WorkspaceLayoutNode {
        .split(
            id: UUID(),
            axis: axis,
            children: [self, node],
            ratios: [0.5, 0.5]
        )
    }

    func addingTab(slotID: String) -> WorkspaceLayoutNode {
        switch self {
        case .leaf(let id, let content):
            switch content {
            case .single(let existingSlotID):
                guard existingSlotID != slotID else { return self }
                return .leaf(id: id, content: .tabs(slotIDs: [existingSlotID, slotID], selectedIndex: 1))
            case .tabs(let slotIDs, _):
                if let existingIndex = slotIDs.firstIndex(of: slotID) {
                    return .leaf(id: id, content: .tabs(slotIDs: slotIDs, selectedIndex: existingIndex))
                }
                return .leaf(id: id, content: .tabs(slotIDs: slotIDs + [slotID], selectedIndex: slotIDs.count))
            }
        case .split:
            return self
        }
    }

    func addingTab(slotID: String, toPaneID targetPaneID: UUID) -> WorkspaceLayoutNode {
        switch self {
        case .leaf(let id, _):
            guard id == targetPaneID else { return self }
            return addingTab(slotID: slotID)
        case .split(let id, let axis, let children, let ratios):
            return .split(
                id: id,
                axis: axis,
                children: children.map { $0.addingTab(slotID: slotID, toPaneID: targetPaneID) },
                ratios: ratios
            )
        }
    }
}

struct WorkspaceLeafTarget: Equatable {
    let paneID: UUID
    let slotID: String
}

struct WorkspaceEntry: Identifiable, Equatable {
    let id: String
    var root: WorkspaceLayoutNode
    var focusedPaneID: UUID?
    var sortOrder: Int
    var titleOverride: String?

    var memberSlotIDs: [String] {
        Array(NSOrderedSet(array: root.memberSlotIDs)) as? [String] ?? root.memberSlotIDs
    }

    var defaultFocusTarget: WorkspaceLeafTarget? {
        root.defaultLeafTarget
    }

    var activeFocusTarget: WorkspaceLeafTarget? {
        if let focusedPaneID, let target = root.leafTarget(for: focusedPaneID) {
            return target
        }
        return defaultFocusTarget
    }

    func title(using slotsByID: [String: SlotState]) -> String {
        if let titleOverride, titleOverride.isEmpty == false {
            return titleOverride
        }

        let names = memberSlotIDs.compactMap { slotsByID[$0]?.name }
        return names.isEmpty ? "Workspace" : names.joined(separator: " + ")
    }

    func matches(searchText: String, slotsByID: [String: SlotState], sessionsByID: [String: SessionState]) -> Bool {
        let trimmed = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.isEmpty == false else { return true }

        let needle = trimmed.localizedLowercase
        if title(using: slotsByID).localizedLowercase.contains(needle) {
            return true
        }

        for slotID in memberSlotIDs {
            guard let slot = slotsByID[slotID] else { continue }
            if slot.name.localizedLowercase.contains(needle) || slot.matches(searchText: trimmed, sessionsByID: sessionsByID) {
                return true
            }
        }

        return false
    }
}

extension WorkspaceEntry {
    static func standalone(for slot: SlotState) -> WorkspaceEntry {
        let paneID = UUID()
        return WorkspaceEntry(
            id: slot.id,
            root: .leaf(id: paneID, content: .single(slotID: slot.id)),
            focusedPaneID: paneID,
            sortOrder: slot.sortOrder,
            titleOverride: nil
        )
    }
}
