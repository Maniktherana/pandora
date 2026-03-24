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
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1200, height: 800),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Pandora"
        window.center()

        self.init(window: window)

        // bridge into SwiftUI for the actual UI
        let contentView = ContentView(projectPath: projectPath)
        window.contentView = NSHostingView(rootView: contentView)
    }
}
