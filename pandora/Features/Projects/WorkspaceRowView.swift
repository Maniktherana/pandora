import SwiftUI

struct WorkspaceRowView: View {
    let workspace: WorkspaceRecord
    let isSelected: Bool
    let onSelect: () -> Void
    let onRetry: () -> Void
    let onRemove: () -> Void

    @State private var isHovered = false

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: iconName)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(iconTint)
                .frame(width: 18)

            VStack(alignment: .leading, spacing: 2) {
                Text(workspace.name)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(Color.primary)
                    .lineLimit(1)

                if workspace.status == .creating {
                    Text("Setting up workspace…")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(.secondary)
                } else if workspace.status == .failed, let failureMessage = workspace.failureMessage {
                    Text(failureMessage)
                        .font(.system(size: 11))
                        .foregroundStyle(.red.opacity(0.85))
                        .lineLimit(1)
                }
            }

            Spacer(minLength: 10)

            if workspace.status == .failed {
                HStack(spacing: 4) {
                    GhostInlineButton(systemName: "arrow.clockwise", action: onRetry)
                    GhostInlineButton(systemName: "trash", action: onRemove)
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(background)
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(borderTint, lineWidth: 1)
        )
        .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .onTapGesture(perform: onSelect)
        .onHover { hovered in
            isHovered = hovered
        }
    }

    private var iconName: String {
        switch workspace.status {
        case .creating:
            return "ellipsis.rectangle"
        case .ready:
            return "rectangle.stack"
        case .failed:
            return "exclamationmark.triangle"
        case .deleting:
            return "trash"
        }
    }

    private var iconTint: Color {
        switch workspace.status {
        case .creating:
            return .secondary
        case .ready:
            return .primary.opacity(0.7)
        case .failed:
            return .red.opacity(0.9)
        case .deleting:
            return .secondary
        }
    }

    private var background: some View {
        RoundedRectangle(cornerRadius: 14, style: .continuous)
            .fill(
                isSelected
                ? Color.primary.opacity(0.09)
                : (isHovered ? Color.primary.opacity(0.04) : Color.clear)
            )
    }

    private var borderTint: Color {
        if isSelected {
            return Color.primary.opacity(0.12)
        }
        return Color.clear
    }
}

private struct GhostInlineButton: View {
    let systemName: String
    let action: () -> Void
    @State private var isHovered = false

    var body: some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 11, weight: .semibold))
                .frame(width: 22, height: 22)
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
