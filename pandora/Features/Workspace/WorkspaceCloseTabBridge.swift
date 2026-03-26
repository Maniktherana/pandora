import Foundation

@MainActor
final class WorkspaceCloseTabBridge {
    static let shared = WorkspaceCloseTabBridge()

    var onCloseFocusedTab: (() -> Bool)?

    private init() {}

    @discardableResult
    func closeFocusedTab() -> Bool {
        onCloseFocusedTab?() ?? false
    }
}
