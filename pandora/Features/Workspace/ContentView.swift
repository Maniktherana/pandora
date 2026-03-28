import SwiftUI

struct ContentView: View {
    private let sidebarWidth: CGFloat = 320

    @ObservedObject var chromeMetrics: WindowChromeMetrics
    @StateObject private var projectsStore = ProjectsStore()
    @State private var isSidebarHidden = false
    @State private var isDiagnosticsPresented = false

    init(chromeMetrics: WindowChromeMetrics) {
        self.chromeMetrics = chromeMetrics
    }

    var body: some View {
        HStack(spacing: 0) {
            if isSidebarHidden == false {
                ProjectsSidebarView(
                    store: projectsStore,
                    chromeMetrics: chromeMetrics,
                    onToggleSidebar: toggleSidebar,
                    onShowDiagnostics: { isDiagnosticsPresented = true }
                )
                .frame(width: sidebarWidth)

                Divider()
            }

            WorkspaceDetailPane(
                store: projectsStore,
                chromeMetrics: chromeMetrics,
                isSidebarHidden: isSidebarHidden,
                onToggleSidebar: toggleSidebar
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(nsColor: .windowBackgroundColor))
        .task {
            if projectsStore.projects.isEmpty {
                projectsStore.presentAddProjectPanel()
            }
        }
        .overlay(alignment: .bottom) {
            if let lastErrorMessage = projectsStore.lastErrorMessage {
                Text(lastErrorMessage)
                    .font(.system(size: 12, weight: .medium))
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(.ultraThinMaterial, in: Capsule(style: .continuous))
                    .padding(.bottom, 16)
                    .onTapGesture {
                        projectsStore.clearError()
                }
            }
        }
        .sheet(isPresented: $isDiagnosticsPresented) {
            DiagnosticsSheetView()
        }
    }

    private func toggleSidebar() {
        isSidebarHidden.toggle()
    }
}

private struct DiagnosticsSheetView: View {
    @ObservedObject private var debugLogStore = DebugLogStore.shared

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Diagnostics")
                    .font(.system(size: 16, weight: .semibold))
                Spacer()
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)

            Divider()

            ScrollView {
                LazyVStack(alignment: .leading, spacing: 8) {
                    ForEach(Array(debugLogStore.lines.enumerated()), id: \.offset) { _, line in
                        Text(line)
                            .font(.system(size: 11, design: .monospaced))
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .textSelection(.enabled)
                    }
                }
                .padding(16)
            }
        }
        .frame(minWidth: 720, minHeight: 420)
        .background(Color(nsColor: .windowBackgroundColor))
    }
}

private struct WorkspaceDetailPane: View {
    @ObservedObject var store: ProjectsStore
    @ObservedObject var chromeMetrics: WindowChromeMetrics
    let isSidebarHidden: Bool
    let onToggleSidebar: () -> Void
    private let titlebarControlSize: CGFloat = 24

    var body: some View {
        VStack(spacing: 0) {
            topStrip
            detailContent
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var topStrip: some View {
        ZStack {
            VisualEffectBackdrop(material: .titlebar, blendingMode: .behindWindow)
            WindowDragRegionView()
            HStack {
                if isSidebarHidden {
                    Button(action: onToggleSidebar) {
                        Image(systemName: "sidebar.left")
                            .font(.system(size: 13, weight: .semibold))
                            .frame(width: titlebarControlSize, height: titlebarControlSize)
                            .background(
                                RoundedRectangle(cornerRadius: 8, style: .continuous)
                                    .fill(Color(nsColor: .controlBackgroundColor))
                            )
                    }
                    .buttonStyle(.plain)
                    .padding(.leading, chromeMetrics.leadingClearance)
                }

                Spacer()
            }
            .padding(.top, max(0, chromeMetrics.trafficLightCenterYFromTop - (titlebarControlSize / 2)))
            .padding(.trailing, 12)
        }
        .frame(height: chromeMetrics.rowHeight)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(Color(nsColor: .separatorColor))
                .frame(height: 1)
        }
    }

    @ViewBuilder
    private var detailContent: some View {
        if store.projects.isEmpty {
            WorkspaceEmptyState(
                title: "Add your first project",
                detail: "Use the file-plus button in the sidebar to choose a folder inside a Git repository."
            )
        } else if let selectedWorkspace = store.selectedWorkspace {
            switch selectedWorkspace.status {
            case .creating:
                WorkspaceEmptyState(
                    title: selectedWorkspace.name,
                    detail: "Setting up workspace…"
                )
            case .failed:
                WorkspaceEmptyState(
                    title: selectedWorkspace.name,
                    detail: selectedWorkspace.failureMessage ?? "Workspace creation failed."
                )
            case .deleting:
                WorkspaceEmptyState(
                    title: selectedWorkspace.name,
                    detail: "Removing workspace…"
                )
            case .ready:
                let context = store.runtimeContext(for: selectedWorkspace)
                WorkspaceRuntimeCanvas(
                    runtimeStore: context.runtimeStore,
                    workspaceController: context.workspaceController,
                    surfaceRegistry: context.surfaceRegistry
                )
            }
        } else if let selectedProjectID = store.selectedProjectID,
                  let project = store.projects.first(where: { $0.id == selectedProjectID }) {
            WorkspaceEmptyState(
                title: project.displayName,
                detail: "Hover the project row and press plus to create a workspace."
            )
        } else {
            WorkspaceEmptyState(
                title: "Select a project",
                detail: "Choose a project from the sidebar or add a new one."
            )
        }
    }
}

private struct WorkspaceRuntimeCanvas: View {
    @ObservedObject var runtimeStore: WorkspaceRuntimeStore
    @ObservedObject var workspaceController: PandoraWorkspaceController
    let surfaceRegistry: SurfaceRegistry

    var body: some View {
        PandoraWorkspaceView(
            store: runtimeStore,
            workspaceController: workspaceController,
            surfaceRegistry: surfaceRegistry
        )
        .onAppear {
            runtimeStore.markOpened()
            workspaceController.render(
                workspace: runtimeStore.visibleWorkspace,
                slotsByID: runtimeStore.slotsByID
            )
            runtimeStore.focusCurrentSession()
        }
        .onChange(of: runtimeStore.visibleWorkspace) { _, workspace in
            workspaceController.render(
                workspace: workspace,
                slotsByID: runtimeStore.slotsByID
            )
            runtimeStore.focusCurrentSession()
        }
        .onChange(of: runtimeStore.actualFocusedSession?.id) { _, _ in
            runtimeStore.focusCurrentSession()
        }
    }
}

private struct WorkspaceEmptyState: View {
    let title: String
    let detail: String

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: "square.stack.3d.up")
                .font(.system(size: 28, weight: .medium))
                .foregroundStyle(.secondary)
            Text(title)
                .font(.system(size: 20, weight: .semibold))
            Text(detail)
                .font(.system(size: 13))
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(nsColor: .windowBackgroundColor))
    }
}
