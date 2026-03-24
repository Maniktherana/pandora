//
//  BottomActionBarView.swift
//  pandora
//
//  Created by Manik Rana on 24/03/26.
//

import SwiftUI

struct BottomActionBarView: View {
    @ObservedObject var store: WorkspaceStore
    let onFocusVisible: () -> Void
    let onUnfocus: () -> Void

    var body: some View {
        let session = store.actionSession
        HStack(spacing: 18) {
            HStack(spacing: 8) {
                Circle()
                    .fill(store.keyboardNavigationArea == .workspace ? Color.accentColor : Color.secondary.opacity(0.6))
                    .frame(width: 8, height: 8)
                Text(store.keyboardNavigationArea == .workspace ? "Focused" : "Sidebar")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(store.keyboardNavigationArea == .workspace ? Color.accentColor : .secondary)
            }

            if store.keyboardNavigationArea == .workspace {
                action("Unfocus", "arrow.uturn.backward", true) {
                    onUnfocus()
                }
            } else {
                action("Focus", "return", store.visibleWorkspace != nil) {
                    onFocusVisible()
                }
            }

            action("Pause", "pause.fill", session?.capabilities.canPause ?? false) {
                store.pauseFocusedSession()
            }
            action("Resume", "play.fill", session?.capabilities.canResume ?? false) {
                store.resumeFocusedSession()
            }
            action("Clear", "eraser", session != nil) {
                store.clearFocusedSession()
            }
            action("Stop", "stop.fill", session?.capabilities.canStop ?? false) {
                store.stopFocusedSession()
            }
            action("Restart", "arrow.clockwise", session?.capabilities.canRestart ?? false) {
                store.restartFocusedSession()
            }

            Spacer()

            Text(store.visibleWorkspaceTitle)
                .font(.system(size: 12))
                .foregroundStyle(.secondary)

            if store.keyboardNavigationArea == .sidebar, session != nil {
                Text("Target")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.secondary)
            }

            if let session {
                Text(session.name)
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
                Circle()
                    .fill(session.status.color)
                    .frame(width: 8, height: 8)
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
        .background(Color(nsColor: .windowBackgroundColor))
    }

    private func action(_ title: String, _ systemImage: String, _ enabled: Bool, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: systemImage)
                .labelStyle(.titleAndIcon)
        }
        .buttonStyle(.borderless)
        .disabled(!enabled)
    }
}
