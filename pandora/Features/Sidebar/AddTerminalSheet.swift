//
//  AddTerminalSheet.swift
//  pandora
//
//  Created by Manik Rana on 24/03/26.
//

import SwiftUI

struct AddTerminalSheet: View {
    @Environment(\.dismiss) private var dismiss

    @ObservedObject var store: WorkspaceStore

    @State private var name = ""
    @State private var command = "exec ${SHELL:-/bin/zsh} -i"
    @State private var cwd = ""

    private var canSubmit: Bool {
        name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false &&
        command.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Add Terminal")
                .font(.title3.weight(.semibold))

            VStack(alignment: .leading, spacing: 8) {
                Text("Name")
                    .font(.system(size: 12, weight: .medium))
                TextField("Frontend shell", text: $name)
                    .textFieldStyle(.roundedBorder)
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("Command")
                    .font(.system(size: 12, weight: .medium))
                TextField("exec ${SHELL:-/bin/zsh} -i", text: $command)
                    .textFieldStyle(.roundedBorder)
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("Working Directory")
                    .font(.system(size: 12, weight: .medium))
                TextField("Optional", text: $cwd)
                    .textFieldStyle(.roundedBorder)
            }

            HStack {
                Spacer()
                Button("Cancel") {
                    dismiss()
                }
                Button("Create Terminal") {
                    store.createTerminalWorkspace(name: name, command: command, cwd: cwd)
                    dismiss()
                }
                .keyboardShortcut(.defaultAction)
                .disabled(!canSubmit)
            }
        }
        .padding(20)
        .frame(width: 460)
    }
}
