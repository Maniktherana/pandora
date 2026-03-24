//
//  WorkspaceDragBridge.swift
//  pandora
//
//  Created by Codex on 25/03/26.
//

import Combine

@MainActor
final class WorkspaceDragBridge: ObservableObject {
    static let shared = WorkspaceDragBridge()

    @Published private(set) var draggedWorkspaceID: String?

    func beginDragging(workspaceID: String) {
        draggedWorkspaceID = workspaceID
    }

    func endDragging() {
        draggedWorkspaceID = nil
    }
}
