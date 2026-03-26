import SwiftUI
import AppKit

/// SwiftUI wrapper around NSSplitView for native split behavior
struct SplitContainerView<Content: View, EmptyContent: View>: NSViewRepresentable {
    @Bindable var splitState: SplitState
    let controller: SplitViewController
    let contentBuilder: (TabItem, PaneID) -> Content
    let emptyPaneBuilder: (PaneID) -> EmptyContent
    var showSplitButtons: Bool = true
    var contentViewLifecycle: ContentViewLifecycle = .recreateOnSwitch
    /// Callback when geometry changes. Bool indicates if change is during active divider drag.
    var onGeometryChange: ((_ isDragging: Bool) -> Void)?

    func makeCoordinator() -> Coordinator {
        Coordinator(splitState: splitState, onGeometryChange: onGeometryChange)
    }

    func makeNSView(context: Context) -> NSSplitView {
        let splitView = NSSplitView()
        splitView.isVertical = splitState.orientation == .horizontal
        splitView.dividerStyle = .thin
        splitView.delegate = context.coordinator

        // First child
        let firstHosting = makeHostingView(for: splitState.first)
        splitView.addArrangedSubview(firstHosting)

        // Second child
        let secondHosting = makeHostingView(for: splitState.second)
        splitView.addArrangedSubview(secondHosting)

        context.coordinator.splitView = splitView

        // Wait for view to be added to window
        DispatchQueue.main.async {
            let totalSize = splitState.orientation == .horizontal
                ? splitView.bounds.width
                : splitView.bounds.height

            guard totalSize > 0 else { return }

            // No split-entry animation: always apply divider position directly.
            let position = totalSize * splitState.dividerPosition
            splitView.setPosition(position, ofDividerAt: 0)
        }

        return splitView
    }

    func updateNSView(_ splitView: NSSplitView, context: Context) {
        // Update orientation if changed
        splitView.isVertical = splitState.orientation == .horizontal

        // Update children
        let subviews = splitView.arrangedSubviews
        if subviews.count >= 2 {
            updateHostingView(subviews[0], for: splitState.first)
            updateHostingView(subviews[1], for: splitState.second)
        }

        // Access dividerPosition to ensure SwiftUI tracks this dependency
        // Then sync if the position changed externally
        let currentPosition = splitState.dividerPosition
        context.coordinator.syncPosition(currentPosition, in: splitView)
    }

    // MARK: - Helpers

    private func makeHostingView(for node: SplitNode) -> NSView {
        let hostingController = NSHostingController(rootView: AnyView(makeView(for: node)))
        hostingController.view.translatesAutoresizingMaskIntoConstraints = false
        return hostingController.view
    }

    private func updateHostingView(_ view: NSView, for node: SplitNode) {
        // Find the hosting controller's view and update it
        if let hostingView = view as? NSHostingView<AnyView> {
            hostingView.rootView = AnyView(makeView(for: node))
        }
    }

    @ViewBuilder
    private func makeView(for node: SplitNode) -> some View {
        switch node {
        case .pane(let paneState):
            PaneContainerView(
                pane: paneState,
                controller: controller,
                contentBuilder: contentBuilder,
                emptyPaneBuilder: emptyPaneBuilder,
                showSplitButtons: showSplitButtons,
                contentViewLifecycle: contentViewLifecycle
            )
        case .split(let nestedSplitState):
            SplitContainerView(
                splitState: nestedSplitState,
                controller: controller,
                contentBuilder: contentBuilder,
                emptyPaneBuilder: emptyPaneBuilder,
                showSplitButtons: showSplitButtons,
                contentViewLifecycle: contentViewLifecycle,
                onGeometryChange: onGeometryChange
            )
        }
    }

    // MARK: - Coordinator

    class Coordinator: NSObject, NSSplitViewDelegate {
        let splitState: SplitState
        weak var splitView: NSSplitView?
        var onGeometryChange: ((_ isDragging: Bool) -> Void)?
        /// Track last applied position to detect external changes
        var lastAppliedPosition: CGFloat = 0.5
        /// Track if user is actively dragging the divider
        var isDragging = false

        init(splitState: SplitState, onGeometryChange: ((_ isDragging: Bool) -> Void)?) {
            self.splitState = splitState
            self.onGeometryChange = onGeometryChange
            self.lastAppliedPosition = splitState.dividerPosition
        }

        /// Apply external position changes to the NSSplitView
        func syncPosition(_ statePosition: CGFloat, in splitView: NSSplitView) {
            // Check if position changed externally (not from user drag)
            if abs(statePosition - lastAppliedPosition) > 0.01 {
                let totalSize = splitState.orientation == .horizontal
                    ? splitView.bounds.width
                    : splitView.bounds.height

                guard totalSize > 0 else { return }

                let pixelPosition = totalSize * statePosition
                splitView.setPosition(pixelPosition, ofDividerAt: 0)
                splitView.layoutSubtreeIfNeeded()
                lastAppliedPosition = statePosition
            }
        }

        func splitViewWillResizeSubviews(_ notification: Notification) {
            // Detect if this is a user drag by checking mouse state
            if let event = NSApp.currentEvent, event.type == .leftMouseDragged {
                isDragging = true
            }
        }

        func splitViewDidResizeSubviews(_ notification: Notification) {
            guard let splitView = notification.object as? NSSplitView else { return }

            let totalSize = splitState.orientation == .horizontal
                ? splitView.bounds.width
                : splitView.bounds.height

            guard totalSize > 0 else { return }

            if let firstSubview = splitView.arrangedSubviews.first {
                let dividerPosition = splitState.orientation == .horizontal
                    ? firstSubview.frame.width
                    : firstSubview.frame.height

                let normalizedPosition = dividerPosition / totalSize

                // Check if drag ended (mouse up)
                let wasDragging = isDragging
                if let event = NSApp.currentEvent, event.type == .leftMouseUp {
                    isDragging = false
                }

                Task { @MainActor in
                    self.splitState.dividerPosition = normalizedPosition
                    self.lastAppliedPosition = normalizedPosition
                    // Notify geometry change with drag state
                    self.onGeometryChange?(wasDragging)
                }
            }
        }

        func splitView(_ splitView: NSSplitView, constrainMinCoordinate proposedMinimumPosition: CGFloat, ofSubviewAt dividerIndex: Int) -> CGFloat {
            return max(proposedMinimumPosition, TabBarMetrics.minimumPaneWidth)
        }

        func splitView(_ splitView: NSSplitView, constrainMaxCoordinate proposedMaximumPosition: CGFloat, ofSubviewAt dividerIndex: Int) -> CGFloat {
            let totalSize = splitState.orientation == .horizontal
                ? splitView.bounds.width
                : splitView.bounds.height
            return min(proposedMaximumPosition, totalSize - TabBarMetrics.minimumPaneWidth)
        }
    }
}
