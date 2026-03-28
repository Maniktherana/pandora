import SwiftUI

struct ProjectsSidebarView: View {
    @ObservedObject var store: ProjectsStore
    @ObservedObject var chromeMetrics: WindowChromeMetrics
    let onToggleSidebar: () -> Void
    let onShowDiagnostics: () -> Void
    private let titlebarControlSize: CGFloat = 24

    var body: some View {
        VStack(spacing: 0) {
            titlebarStrip
            Divider()
            sectionHeader
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 10) {
                    ForEach(store.projects) { project in
                        ProjectRowView(project: project, store: store)
                    }
                }
                .padding(.horizontal, 14)
                .padding(.top, 12)
                .padding(.bottom, 18)
            }

            Divider()

            GhostSidebarFooterButton(
                title: "Diagnostics",
                systemName: "doc.text.magnifyingglass",
                action: onShowDiagnostics
            )
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
        }
        .background(VisualEffectBackdrop(material: .sidebar, blendingMode: .behindWindow))
    }

    private var titlebarStrip: some View {
        ZStack {
            VisualEffectBackdrop(material: .sidebar, blendingMode: .behindWindow)
            WindowDragRegionView()

            HStack(spacing: 8) {
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

                Spacer(minLength: 0)
            }
            .padding(.leading, chromeMetrics.leadingClearance)
            .padding(.trailing, 12)
            .padding(.top, max(0, chromeMetrics.trafficLightCenterYFromTop - (titlebarControlSize / 2)))
        }
        .frame(height: chromeMetrics.rowHeight)
    }

    private var sectionHeader: some View {
        HStack(spacing: 8) {
            Text("Workspaces")
                .font(.system(size: 18, weight: .semibold))

            Spacer(minLength: 0)

            GhostIconButton(systemName: "line.3.horizontal.decrease", action: {})
                .accessibilityHidden(true)

            GhostIconButton(systemName: "doc.badge.plus", action: store.presentAddProjectPanel)
                .accessibilityLabel("Add Project")
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 14)
    }
}

private struct GhostIconButton: View {
    let systemName: String
    let action: () -> Void
    var isEnabled: Bool = true
    @State private var isHovered = false
    @State private var isPressed = false

    var body: some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 13, weight: .semibold))
                .frame(width: 28, height: 28)
                .background(background)
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled)
        .onHover { hovered in
            isHovered = hovered
        }
        .simultaneousGesture(
            DragGesture(minimumDistance: 0)
                .onChanged { _ in isPressed = true }
                .onEnded { _ in isPressed = false }
        )
    }

    private var background: some View {
        RoundedRectangle(cornerRadius: 8, style: .continuous)
            .fill((isPressed ? Color.primary.opacity(0.14) : (isHovered ? Color.primary.opacity(0.08) : Color.clear)))
    }
}

private struct GhostSidebarFooterButton: View {
    let title: String
    let systemName: String
    let action: () -> Void
    @State private var isHovered = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: systemName)
                    .font(.system(size: 13, weight: .semibold))
                    .frame(width: 18)
                Text(title)
                    .font(.system(size: 13, weight: .medium))
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(isHovered ? Color.primary.opacity(0.06) : Color.clear)
            )
        }
        .buttonStyle(.plain)
        .onHover { hovered in
            isHovered = hovered
        }
    }
}
