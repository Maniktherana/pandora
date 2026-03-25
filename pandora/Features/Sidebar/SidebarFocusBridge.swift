//
//  SidebarFocusBridge.swift
//  pandora
//
//  Created by Manik Rana on 25/03/26.
//

import AppKit
import SwiftUI

@MainActor
final class SidebarFocusBridge {
    static let shared = SidebarFocusBridge()

    weak var focusView: NSView?

    func focus() {
        guard let focusView else { return }
        focusView.window?.makeFirstResponder(focusView)
    }
}

final class SidebarKeyboardHostView: NSView {
    var onMoveSelection: ((Int) -> Void)?
    var onActivateSelection: (() -> Void)?

    override var acceptsFirstResponder: Bool { true }

    override func hitTest(_ point: NSPoint) -> NSView? {
        nil
    }

    override func keyDown(with event: NSEvent) {
        switch event.keyCode {
        case 125:
            onMoveSelection?(1)
        case 126:
            onMoveSelection?(-1)
        case 36, 76:
            onActivateSelection?()
        default:
            super.keyDown(with: event)
        }
    }
}

struct SidebarKeyboardHost<Content: View>: NSViewRepresentable {
    let onMoveSelection: (Int) -> Void
    let onActivateSelection: () -> Void
    let content: Content

    final class ContainerView: NSView {
        let hostView: NSHostingView<Content>
        let keyboardView = SidebarKeyboardHostView(frame: .zero)

        init(content: Content) {
            self.hostView = NSHostingView(rootView: content)
            super.init(frame: .zero)
            addSubview(hostView)
            addSubview(keyboardView)
        }

        @available(*, unavailable)
        required init?(coder: NSCoder) {
            fatalError("init(coder:) has not been implemented")
        }

        override func layout() {
            super.layout()
            hostView.frame = bounds
            keyboardView.frame = bounds
        }
    }

    func makeNSView(context: Context) -> ContainerView {
        let view = ContainerView(content: content)
        view.keyboardView.onMoveSelection = onMoveSelection
        view.keyboardView.onActivateSelection = onActivateSelection
        SidebarFocusBridge.shared.focusView = view.keyboardView
        return view
    }

    func updateNSView(_ nsView: ContainerView, context: Context) {
        nsView.hostView.rootView = content
        nsView.keyboardView.onMoveSelection = onMoveSelection
        nsView.keyboardView.onActivateSelection = onActivateSelection
        SidebarFocusBridge.shared.focusView = nsView.keyboardView
    }
}
