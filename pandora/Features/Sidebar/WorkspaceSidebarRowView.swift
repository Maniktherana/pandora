//
//  SlotRowView.swift
//  pandora
//
//  Created by Manik Rana on 24/03/26.
//

import SwiftUI

struct WorkspaceSidebarRowView: View {
    @ObservedObject var store: WorkspaceStore
    let workspace: WorkspaceEntry
    let isSelected: Bool

    private var removalTitle: String {
        "Remove from Sidebar"
    }

    private var memberSlots: [SlotState] {
        store.slots(for: workspace)
    }

    private var aggregateStatus: AggregateStatus {
        let statuses = memberSlots.map(\.aggregateStatus)
        if statuses.contains(.crashed) { return .crashed }
        if statuses.contains(.restarting) { return .restarting }
        if statuses.contains(.running) { return .running }
        return .stopped
    }

    private var workspaceTitle: String {
        store.sidebarDisplayTitle(for: workspace)
    }

    var body: some View {
        Button(action: openSlot) {
            HStack(alignment: .center, spacing: 12) {
                statusDot

                VStack(alignment: .leading, spacing: 4) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(workspaceTitle)
                            .font(.system(size: 13, weight: .semibold, design: .rounded))
                            .lineLimit(1)

                        Text(memberSlots.count > 1 ? "WORKSPACE" : "PROCESS")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 7)
                            .padding(.vertical, 3)
                            .background(
                                Capsule(style: .continuous)
                                    .fill(Color.primary.opacity(0.06))
                            )
                    }

                    Text(detailText)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                Spacer(minLength: 10)

                VStack(alignment: .trailing, spacing: 6) {
                    pill(text: memberSlots.count > 1 ? "\(memberSlots.count) panes" : "single", tint: .secondary)

                    if let session = store.focusedSession, workspace.memberSlotIDs.contains(session.slotID) {
                        pill(text: session.status.label, tint: session.status.color)
                    }
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 11)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(rowBackground)
            .overlay(rowBorder)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .draggable(workspace.id)
        .dropDestination(for: String.self) { items, _ in
            guard let sourceID = items.first else { return false }
            store.mergeWorkspaces(sourceID: sourceID, into: workspace.id)
            return true
        }
        .contextMenu {
            Button("Show Workspace") {
                openSlot()
            }

            if workspace.memberSlotIDs.count > 1 {
                Divider()
                Button("Split Back Out") {
                    store.splitWorkspaceIntoStandaloneEntries(workspace)
                }
            }

            Divider()

            Button(removalTitle, role: .destructive) {
                removeFromSidebar()
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityLabel)
    }

    private var statusDot: some View {
        Circle()
            .fill(aggregateStatus.color)
            .frame(width: 9, height: 9)
            .shadow(color: aggregateStatus.color.opacity(0.25), radius: 1.5, x: 0, y: 0)
    }

    private var rowBackground: some View {
        RoundedRectangle(cornerRadius: 12, style: .continuous)
            .fill(isSelected ? Color.accentColor.opacity(0.16) : backgroundTint)
    }

    private var rowBorder: some View {
        RoundedRectangle(cornerRadius: 12, style: .continuous)
            .strokeBorder(borderTint, lineWidth: 1)
    }

    private var backgroundTint: Color {
        switch aggregateStatus {
        case .crashed:
            return Color.red.opacity(0.08)
        case .restarting:
            return Color.yellow.opacity(0.05)
        case .running:
            return Color.clear
        case .stopped:
            return Color.clear
        }
    }

    private var borderTint: Color {
        if isSelected {
            return Color.accentColor.opacity(0.55)
        }

        switch aggregateStatus {
        case .crashed:
            return Color.red.opacity(0.16)
        case .restarting:
            return Color.yellow.opacity(0.12)
        case .running, .stopped:
            return Color.primary.opacity(0.06)
        }
    }

    private var detailText: String {
        let kinds = Set(memberSlots.map(\.kind.displayName))
        let kindSummary = kinds.sorted().joined(separator: ", ")
        return [kindSummary, "\(workspace.memberSlotIDs.count) item\(workspace.memberSlotIDs.count == 1 ? "" : "s")", aggregateStatus.displayName]
            .joined(separator: " · ")
    }

    @ViewBuilder
    private func pill(text: String, tint: Color) -> some View {
        Text(text)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(tint)
            .lineLimit(1)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(
                Capsule(style: .continuous)
                    .fill(tint.opacity(0.12))
            )
    }

    private var accessibilityLabel: String {
        let sessionCount = workspace.memberSlotIDs.count == 1 ? "1 item" : "\(workspace.memberSlotIDs.count) items"
        return "\(workspaceTitle), \(aggregateStatus.displayName), \(sessionCount)"
    }

    private func openSlot() {
        store.selectSidebarWorkspace(id: workspace.id)
    }

    private func removeFromSidebar() {
        store.remove(workspace)
    }
}

private extension AggregateStatus {
    var displayName: String {
        rawValue.capitalized
    }
}
