//
//  WindowDragRegionView.swift
//  pandora
//
//  Created by Codex on 28/03/26.
//

import AppKit
import SwiftUI

private final class WindowDragRegionNSView: NSView {
    override var mouseDownCanMoveWindow: Bool { true }
}

struct WindowDragRegionView: NSViewRepresentable {
    func makeNSView(context: Context) -> NSView {
        WindowDragRegionNSView()
    }

    func updateNSView(_ nsView: NSView, context: Context) {}
}
