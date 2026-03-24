//
//  SlotListView.swift
//  pandora
//
//  Created by Manik Rana on 24/03/26.
//

import SwiftUI

struct WorkspaceSidebarListView: View {
    @ObservedObject var store: WorkspaceStore

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 18) {
                if !store.filteredWorkspaces.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        sectionHeader

                        ForEach(store.filteredWorkspaces) { workspace in
                            WorkspaceSidebarRowView(
                                store: store,
                                workspace: workspace,
                                isSelected: store.selectedSidebarWorkspaceID == workspace.id
                            )
                        }
                    }
                    .padding(.bottom, 2)
                }
            }
            .padding(.horizontal, 12)
            .padding(.top, 6)
            .padding(.bottom, 14)
        }
    }

    private var sectionHeader: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "square.split.2x1")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.secondary)

                Text("WORKSPACES")
                    .font(.system(size: 11, weight: .bold))
                    .tracking(1.1)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            Text("\(store.filteredWorkspaces.count)")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
                .padding(.horizontal, 7)
                .padding(.vertical, 3)
                .background(
                    Capsule(style: .continuous)
                        .fill(Color.primary.opacity(0.06))
                )
        }
        .padding(.horizontal, 4)
    }
}
