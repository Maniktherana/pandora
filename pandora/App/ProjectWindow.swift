//
//  ProjectWindow.swift
//  pandora
//
//  Created by Manik Rana on 24/03/26.
//

import AppKit
import SwiftUI

class ProjectWindow: NSWindowController {

    convenience init(projectPath: String) {
        let initialFrame = Self.initialFrame()
        let window = NSWindow(
            contentRect: initialFrame,
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Pandora"
        window.minSize = NSSize(width: 1200, height: 800)
        window.setFrame(initialFrame, display: false)

        self.init(window: window)

        // bridge into SwiftUI for the actual UI
        let contentView = ContentView(projectPath: projectPath)
        window.contentView = NSHostingView(rootView: contentView)
    }

    private static func initialFrame() -> NSRect {
        guard let screen = NSScreen.main ?? NSScreen.screens.first else {
            return NSRect(x: 0, y: 0, width: 1600, height: 1000)
        }

        let insetX: CGFloat = 24
        let insetY: CGFloat = 24
        let frame = screen.visibleFrame.insetBy(dx: insetX, dy: insetY)

        guard frame.width >= 1200, frame.height >= 800 else {
            let visibleFrame = screen.visibleFrame
            let width = max(1200, visibleFrame.width)
            let height = max(800, visibleFrame.height)
            let originX = visibleFrame.midX - (width / 2)
            let originY = visibleFrame.midY - (height / 2)
            return NSRect(x: originX, y: originY, width: width, height: height)
        }

        return frame
    }
}
