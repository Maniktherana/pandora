import SwiftUI

struct ProjectRowView: View {
    let project: ProjectRecord
    @ObservedObject var store: ProjectsStore

    @State private var isHovered = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 12) {
                monogram

                Text(project.displayName)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Color.primary)
                    .frame(maxWidth: .infinity, alignment: .leading)

                GhostRowButton(systemName: "plus") {
                    store.createWorkspace(project: project)
                }
                .opacity(isHovered ? 1 : 0)
            }
            .padding(.horizontal, 4)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
            .onTapGesture {
                store.toggleProject(project)
            }
            .onHover { hovered in
                isHovered = hovered
            }

            if project.isExpanded {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(store.workspaces(for: project)) { workspace in
                        WorkspaceRowView(workspace: workspace, isSelected: store.selectedWorkspaceID == workspace.id) {
                            store.selectWorkspace(workspace)
                        } onRetry: {
                            store.retryWorkspace(workspace)
                        } onRemove: {
                            store.removeWorkspace(workspace)
                        }
                    }
                }
                .padding(.leading, 26)
            }
        }
    }

    private var monogram: some View {
        RoundedRectangle(cornerRadius: 8, style: .continuous)
            .fill(Color.primary.opacity(0.08))
            .frame(width: 28, height: 28)
            .overlay {
                Text(project.monogram)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.secondary)
            }
    }
}

private struct GhostRowButton: View {
    let systemName: String
    let action: () -> Void
    @State private var isHovered = false

    var body: some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.secondary)
                .frame(width: 24, height: 24)
                .background(
                    RoundedRectangle(cornerRadius: 7, style: .continuous)
                        .fill(isHovered ? Color.primary.opacity(0.08) : Color.clear)
                )
        }
        .buttonStyle(.plain)
        .onHover { hovered in
            isHovered = hovered
        }
    }
}
