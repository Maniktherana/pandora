//
//  SlotState+Sorting.swift
//  pandora
//
//  Created by Manik Rana on 24/03/26.
//

import Foundation

extension SlotState {
    static func sortComparator(lhs: SlotState, rhs: SlotState) -> Bool {
        if lhs.section.sortOrder != rhs.section.sortOrder {
            return lhs.section.sortOrder < rhs.section.sortOrder
        }
        if lhs.sortOrder != rhs.sortOrder {
            return lhs.sortOrder < rhs.sortOrder
        }
        return lhs.name.localizedCaseInsensitiveCompare(rhs.name) == .orderedAscending
    }
}
