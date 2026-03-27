import SwiftUI
import UniformTypeIdentifiers
import Foundation

// MARK: - External Drop Handler (injected via environment)

struct ExternalPaneDropHandler {
    let supportedTypes: [UTType]
    let onDragUpdated: () -> Void
    let onDrop: (PaneID, DropZone, [NSItemProvider]) -> Bool
}

private struct ExternalPaneDropHandlerKey: EnvironmentKey {
    static let defaultValue: ExternalPaneDropHandler? = nil
}

extension EnvironmentValues {
    var externalPaneDropHandler: ExternalPaneDropHandler? {
        get { self[ExternalPaneDropHandlerKey.self] }
        set { self[ExternalPaneDropHandlerKey.self] = newValue }
    }
}

/// Drop zone positions for creating splits
enum DropZone: Equatable {
    case center
    case left
    case right
    case top
    case bottom

    var orientation: SplitOrientation? {
        switch self {
        case .left, .right: return .horizontal
        case .top, .bottom: return .vertical
        case .center: return nil
        }
    }

    var insertsFirst: Bool {
        switch self {
        case .left, .top: return true
        default: return false
        }
    }
}

/// Container for a single pane with its tab bar and content area
struct PaneContainerView<Content: View, EmptyContent: View>: View {
    @Bindable var pane: PaneState
    let controller: SplitViewController
    let contentBuilder: (TabItem, PaneID) -> Content
    let emptyPaneBuilder: (PaneID) -> EmptyContent
    var showSplitButtons: Bool = true
    var contentViewLifecycle: ContentViewLifecycle = .recreateOnSwitch

    @Environment(\.externalPaneDropHandler) private var externalDropHandler
    @State private var activeDropZone: DropZone?

    private var isFocused: Bool {
        controller.focusedPaneId == pane.id
    }

    var body: some View {
        VStack(spacing: 0) {
            // Tab bar
            TabBarView(
                pane: pane,
                isFocused: isFocused,
                showSplitButtons: showSplitButtons
            )

            // Content area with drop zones
            contentAreaWithDropZones
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(nsColor: .textBackgroundColor))
        .onChange(of: controller.draggingTab?.id) { _, newValue in
            if newValue == nil {
                activeDropZone = nil
            }
        }
    }

    // MARK: - Content Area with Drop Zones

    @ViewBuilder
    private var contentAreaWithDropZones: some View {
        GeometryReader { geometry in
            let size = geometry.size

            ZStack {
                // Main content
                contentArea

                // Drop zones layer (above content, receives drops and taps)
                dropZonesLayer(size: size)

                // Visual placeholder (non-interactive)
                dropPlaceholder(for: activeDropZone, in: size)
                    .allowsHitTesting(false)
            }
            .frame(width: size.width, height: size.height)
        }
        .clipped()
    }

    // MARK: - Content Area

    @ViewBuilder
    private var contentArea: some View {
        if pane.tabs.isEmpty {
            emptyPaneView
        } else {
            switch contentViewLifecycle {
            case .recreateOnSwitch:
                // Original behavior: only render selected tab
                if let selectedTab = pane.selectedTab {
                    contentBuilder(selectedTab, pane.id)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }

            case .keepAllAlive:
                // macOS-like behavior: keep all tab views in hierarchy
                ZStack {
                    ForEach(pane.tabs) { tab in
                        contentBuilder(tab, pane.id)
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                            .opacity(tab.id == pane.selectedTabId ? 1 : 0)
                            .allowsHitTesting(tab.id == pane.selectedTabId)
                    }
                }
            }
        }
    }

    // MARK: - Drop Zones Layer

    @ViewBuilder
    private func dropZonesLayer(size: CGSize) -> some View {
        // Single unified drop zone that determines zone based on position.
        // Accepts JSON tab payloads plus any external types injected via the
        // environment (e.g. workspace row merges).
        let dropTypes: [UTType] = {
            var types: [UTType] = [.json]
            if let handler = externalDropHandler {
                types.append(contentsOf: handler.supportedTypes)
            }
            return types
        }()

        Color.clear
            .onTapGesture {
                controller.focusPane(pane.id)
            }
            .onDrop(of: dropTypes, delegate: UnifiedPaneDropDelegate(
                size: size,
                pane: pane,
                controller: controller,
                activeDropZone: $activeDropZone,
                externalDropHandler: externalDropHandler
            ))
    }

    // MARK: - Drop Placeholder

    @ViewBuilder
    private func dropPlaceholder(for zone: DropZone?, in size: CGSize) -> some View {
        let placeholderColor = Color.accentColor.opacity(0.25)
        let borderColor = Color.accentColor
        let padding: CGFloat = 4

        // Calculate frame based on zone
        let frame: CGRect = {
            switch zone {
            case .center, .none:
                return CGRect(x: padding, y: padding, width: size.width - padding * 2, height: size.height - padding * 2)
            case .left:
                return CGRect(x: padding, y: padding, width: size.width / 2 - padding, height: size.height - padding * 2)
            case .right:
                return CGRect(x: size.width / 2, y: padding, width: size.width / 2 - padding, height: size.height - padding * 2)
            case .top:
                return CGRect(x: padding, y: padding, width: size.width - padding * 2, height: size.height / 2 - padding)
            case .bottom:
                return CGRect(x: padding, y: size.height / 2, width: size.width - padding * 2, height: size.height / 2 - padding)
            }
        }()

        RoundedRectangle(cornerRadius: 8)
            .fill(placeholderColor)
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(borderColor, lineWidth: 2)
            )
            .frame(width: frame.width, height: frame.height)
            .position(x: frame.midX, y: frame.midY)
            .opacity(zone != nil ? 1 : 0)
            .animation(.spring(duration: 0.25, bounce: 0.15), value: zone)
    }

    // MARK: - Empty Pane View

    @ViewBuilder
    private var emptyPaneView: some View {
        emptyPaneBuilder(pane.id)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Unified Pane Drop Delegate

struct UnifiedPaneDropDelegate: DropDelegate {
    let size: CGSize
    let pane: PaneState
    let controller: SplitViewController
    @Binding var activeDropZone: DropZone?
    let externalDropHandler: ExternalPaneDropHandler?

    private var acceptsWorkspaceDrop: Bool {
        externalDropHandler != nil && WorkspaceDragBridge.shared.isWorkspaceRowDrag
    }

    private var acceptsTabDrop: Bool {
        WorkspaceDragBridge.shared.isContentTabDrag
    }

    private func zoneForLocation(_ location: CGPoint) -> DropZone {
        let edgeRatio: CGFloat = 0.25
        let horizontalEdge = max(80, size.width * edgeRatio)
        let verticalEdge = max(80, size.height * edgeRatio)

        if location.x < horizontalEdge {
            return .left
        } else if location.x > size.width - horizontalEdge {
            return .right
        } else if location.y < verticalEdge {
            return .top
        } else if location.y > size.height - verticalEdge {
            return .bottom
        } else {
            return .center
        }
    }

    func performDrop(info: DropInfo) -> Bool {
        let zone = zoneForLocation(info.location)

        // 1. Try internal tab transfer first
        if acceptsTabDrop, let provider = info.itemProviders(for: [.json]).first {
            provider.loadDataRepresentation(forTypeIdentifier: UTType.json.identifier) { data, _ in
                DispatchQueue.main.async {
                    activeDropZone = nil
                    controller.draggingTab = nil
                    controller.dragSourcePaneId = nil
                    WorkspaceDragBridge.shared.endDragging()

                    guard let data,
                          let transfer = try? JSONDecoder().decode(TabTransferData.self, from: data) else {
                        return
                    }

                    guard let sourcePaneId = controller.rootNode.allPaneIds.first(where: { $0.id == transfer.sourcePaneId }) else {
                        return
                    }

                    let zoneString: String = {
                        switch zone {
                        case .center: return "center"
                        case .left: return "left"
                        case .right: return "right"
                        case .top: return "top"
                        case .bottom: return "bottom"
                        }
                    }()
                    let orientationString = zone.orientation.map { $0 == .horizontal ? "horizontal" : "vertical" } ?? "none"
                    let message = """
                    [PANDORA] ACTION tab-drop zone=\(zoneString) orientation=\(orientationString) insertFirst=\(zone.insertsFirst)
                      dragged-tab id=\(transfer.tab.id.uuidString.lowercased()) title="\((transfer.tab.title))"
                      source-pane id=\(transfer.sourcePaneId.uuidString.lowercased())
                      target-pane id=\(pane.id.id.uuidString.lowercased())
                      location x=\(String(format: "%.1f", info.location.x)) y=\(String(format: "%.1f", info.location.y)) size w=\(String(format: "%.1f", size.width)) h=\(String(format: "%.1f", size.height))
                    """
                    print(message)
                    Task { @MainActor in
                        DebugLogStore.shared.append(message, source: "workspace")
                    }

                    if zone == .center {
                        withAnimation(.spring(duration: 0.3, bounce: 0.15)) {
                            controller.moveTab(transfer.tab, from: sourcePaneId, to: pane.id, atIndex: nil)
                        }
                    } else if let orientation = zone.orientation {
                        if let sourcePane = controller.rootNode.findPane(sourcePaneId) {
                            sourcePane.removeTab(transfer.tab.id)
                            if sourcePane.tabs.isEmpty && controller.rootNode.allPaneIds.count > 1 {
                                controller.closePane(sourcePaneId)
                            }
                        }
                        controller.splitPaneWithTab(
                            pane.id,
                            orientation: orientation,
                            tab: transfer.tab,
                            insertFirst: zone.insertsFirst
                        )
                    }
                }
            }
            return true
        }

        // 2. Try external drop handler (e.g. workspace row merge)
        if acceptsWorkspaceDrop, let handler = externalDropHandler {
            let providers = info.itemProviders(for: handler.supportedTypes)
            if !providers.isEmpty {
                // Defer clearing to next run loop iteration so it runs after any
                // pending dropUpdated calls that could re-set activeDropZone.
                DispatchQueue.main.async {
                    activeDropZone = nil
                }
                return handler.onDrop(pane.id, zone, providers)
            }
        }

        activeDropZone = nil
        controller.draggingTab = nil
        controller.dragSourcePaneId = nil
        return false
    }

    func dropEntered(info: DropInfo) {
        guard validateDrop(info: info) else {
            activeDropZone = nil
            return
        }
        activeDropZone = zoneForLocation(info.location)
    }

    func dropExited(info: DropInfo) {
        activeDropZone = nil
    }

    func dropUpdated(info: DropInfo) -> DropProposal? {
        guard validateDrop(info: info) else {
            activeDropZone = nil
            return nil
        }
        activeDropZone = zoneForLocation(info.location)
        if acceptsWorkspaceDrop {
            externalDropHandler?.onDragUpdated()
        }
        return DropProposal(operation: .move)
    }

    func validateDrop(info: DropInfo) -> Bool {
        if acceptsTabDrop, info.hasItemsConforming(to: [.json]) { return true }
        if acceptsWorkspaceDrop,
           let handler = externalDropHandler,
           info.hasItemsConforming(to: handler.supportedTypes) { return true }
        return false
    }
}
