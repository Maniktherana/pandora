//
//  SidebarShellView.swift
//  pandora
//
//  Created by Manik Rana on 24/03/26.
//

import SwiftUI
import UniformTypeIdentifiers

struct SidebarShellView: View {
    @ObservedObject var store: WorkspaceStore
    @ObservedObject var workspaceController: PandoraWorkspaceController
    @State private var isPresentingAddTerminal = false
    @State private var isSidebarDropTargeted = false

    var body: some View {
        VStack(spacing: 0) {
            header

            SearchFieldView(text: $store.searchText, placeholder: "Filter workspaces...")
                .padding(.horizontal, 12)
                .padding(.top, 10)
                .padding(.bottom, 12)

            SidebarKeyboardHost(
                onMoveSelection: { offset in
                    store.navigateSidebarSelection(offset: offset)
                },
                onActivateSelection: {
                    store.focusVisibleWorkspace()
                },
                content: WorkspaceSidebarListView(store: store, workspaceController: workspaceController)
            )
        }
        .frame(minWidth: 280, idealWidth: 320, maxWidth: 420, maxHeight: .infinity, alignment: .top)
        .background(sidebarBackground)
        .overlay {
            if isSidebarDropTargeted {
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(Color.accentColor, style: StrokeStyle(lineWidth: 3, dash: [10, 6]))
                    .padding(10)
                    .overlay {
                        VStack(spacing: 8) {
                            Image(systemName: "tray.and.arrow.down")
                                .font(.system(size: 20, weight: .semibold))
                            Text("Drop Here To Split Out")
                                .font(.system(size: 12, weight: .semibold))
                        }
                        .foregroundStyle(Color.accentColor)
                    }
                    .allowsHitTesting(false)
            }
        }
        .onDrop(of: [UTType.text], isTargeted: $isSidebarDropTargeted, perform: handleSidebarDrop)
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

    private func handleSidebarDrop(providers: [NSItemProvider]) -> Bool {
        guard let provider = providers.first else { return false }
        provider.loadItem(forTypeIdentifier: UTType.text.identifier, options: nil) { item, _ in
            let value: String?
            switch item {
            case let data as Data:
                value = String(data: data, encoding: .utf8)
            case let string as String:
                value = string
            case let nsString as NSString:
                value = nsString as String
            default:
                value = nil
            }

            guard let rawValue = value?.trimmingCharacters(in: .whitespacesAndNewlines),
                  rawValue.isEmpty == false else {
                return
            }

            DispatchQueue.main.async {
                WorkspaceDragBridge.shared.endDragging()

                if let transfer = ExternalTabTransfer.decode(from: rawValue),
                   let slotID = workspaceController.slotID(forDragTabIdentifier: transfer.tab.id) {
                    store.detachSlotToSidebar(slotID: slotID)
                }
            }
        }
        return true
    }
}

struct ExternalTabTransfer: Decodable {
    struct TabPayload: Decodable {
        let id: String
    }

    let tab: TabPayload

    static func decode(from value: String) -> ExternalTabTransfer? {
        guard let data = value.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(ExternalTabTransfer.self, from: data)
    }
}
