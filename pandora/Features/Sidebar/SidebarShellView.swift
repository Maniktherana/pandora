//
//  SidebarShellView.swift
//  pandora
//
//  Created by Manik Rana on 24/03/26.
//

import SwiftUI

struct SidebarShellView: View {
    @ObservedObject var store: WorkspaceStore
    @State private var isPresentingAddTerminal = false

    var body: some View {
        VStack(spacing: 0) {
            header

            SearchFieldView(text: $store.searchText, placeholder: "Filter workspaces...")
                .padding(.horizontal, 12)
                .padding(.top, 10)
                .padding(.bottom, 12)

            WorkspaceSidebarListView(store: store)
        }
        .frame(minWidth: 280, idealWidth: 320, maxWidth: 420, maxHeight: .infinity, alignment: .top)
        .background(sidebarBackground)
        .sheet(isPresented: $isPresentingAddTerminal) {
            AddTerminalSheet(store: store)
        }
    }

    private var header: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Pandora")
                    .font(.system(size: 20, weight: .semibold, design: .rounded))
                Text("Project workspace")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            Button {
                isPresentingAddTerminal = true
            } label: {
                Image(systemName: "plus")
                    .font(.system(size: 13, weight: .semibold))
                    .frame(width: 28, height: 28)
            }
            .buttonStyle(.plain)
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(Color(nsColor: .controlBackgroundColor))
            )
            .help("Add terminal")
        }
        .padding(.horizontal, 12)
        .padding(.top, 12)
        .padding(.bottom, 10)
    }

    private var sidebarBackground: some View {
        LinearGradient(
            colors: [
                Color(nsColor: .windowBackgroundColor),
                Color(nsColor: .controlBackgroundColor).opacity(0.94)
            ],
            startPoint: .top,
            endPoint: .bottom
        )
    }
}
