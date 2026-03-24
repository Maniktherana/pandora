//
//  SidebarFocusBridge.swift
//  pandora
//
//  Created by Codex on 25/03/26.
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

private final class SidebarFocusView: NSView {
    override var acceptsFirstResponder: Bool { true }
}

struct SidebarFocusSink: NSViewRepresentable {
    func makeNSView(context: Context) -> NSView {
        let view = SidebarFocusView(frame: .zero)
        SidebarFocusBridge.shared.focusView = view
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        SidebarFocusBridge.shared.focusView = nsView
    }
}
