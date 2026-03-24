//
//  TerminalSurfaceView.swift
//  pandora
//
//  Created by Manik Rana on 24/03/26.
//
//  NSViewRepresentable bridge — embeds GhosttyNSView (libghostty Metal surface)
//  into the SwiftUI layout hierarchy. This is the connection point between
//  SwiftUI's layout engine and libghostty's AppKit NSView.
//
//  Pattern: NSViewRepresentable wraps AppKit views for SwiftUI consumption.
//  Pitfall 2 mitigation: drawableSize is set once the view is in a window.
//

import SwiftUI

struct TerminalSurfaceView: NSViewRepresentable {

    let sessionID: String?
    let presentationMode: SlotPresentationMode
    let surfaceRegistry: SurfaceRegistry

    func makeNSView(context: Context) -> GhosttyNSView {
        surfaceRegistry.view(
            for: sessionID,
            presentationMode: presentationMode,
            surfaceRegistry: surfaceRegistry
        )
    }

    func updateNSView(_ nsView: GhosttyNSView, context: Context) {
        nsView.configure(
            sessionID: sessionID,
            presentationMode: presentationMode,
            surfaceRegistry: surfaceRegistry
        )
        surfaceRegistry.synchronizeFocus(for: nsView)
    }
}
