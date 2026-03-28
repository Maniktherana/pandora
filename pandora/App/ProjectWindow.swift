//
//  ProjectWindow.swift
//  pandora
//
//  Created by Manik Rana on 24/03/26.
//

import AppKit
import SwiftUI

final class TitlebarHostingView<Content: View>: NSHostingView<Content> {
    override var safeAreaInsets: NSEdgeInsets {
        NSEdgeInsetsZero
    }
}

class ProjectWindow: NSWindowController {
    private let chromeMetrics = WindowChromeMetrics()
    private var chromeObservers: [NSObjectProtocol] = []

    convenience init(projectPath: String) {
        let initialFrame = Self.initialFrame()
        let window = NSWindow(
            contentRect: initialFrame,
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.tabbingMode = .disallowed
        window.title = "Pandora"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.titlebarSeparatorStyle = .line
        window.isMovableByWindowBackground = false
        window.minSize = NSSize(width: 1200, height: 800)
        window.setFrame(initialFrame, display: false)

        self.init(window: window)

        // bridge into SwiftUI for the actual UI
        let contentView = ContentView(projectPath: projectPath, chromeMetrics: chromeMetrics)
        window.contentView = TitlebarHostingView(rootView: contentView)
        installChromeMetrics(for: window)
    }

    deinit {
        for observer in chromeObservers {
            NotificationCenter.default.removeObserver(observer)
        }
    }

    private func installChromeMetrics(for window: NSWindow) {
        let center = NotificationCenter.default
        let names: [Notification.Name] = [
            NSWindow.didResizeNotification,
            NSWindow.didEndLiveResizeNotification,
            NSWindow.didEnterFullScreenNotification,
            NSWindow.didExitFullScreenNotification,
            NSWindow.didBecomeKeyNotification
        ]

        chromeObservers = names.map { name in
            center.addObserver(forName: name, object: window, queue: .main) { [weak self, weak window] _ in
                guard let self, let window else { return }
                self.updateChromeMetrics(for: window)
            }
        }

        DispatchQueue.main.async { [weak self, weak window] in
            guard let self, let window else { return }
            self.updateChromeMetrics(for: window)
        }
    }

    private func updateChromeMetrics(for window: NSWindow) {
        guard let closeButton = window.standardWindowButton(.closeButton),
              let zoomButton = window.standardWindowButton(.zoomButton),
              let buttonContainer = closeButton.superview else {
            return
        }

        let closeFrame = closeButton.frame
        let zoomFrame = zoomButton.frame
        let centerYFromTop = buttonContainer.bounds.height - closeFrame.midY
        let leadingClearance = zoomFrame.maxX + 14
        let rowHeight = max(32, ceil(centerYFromTop * 2))

        chromeMetrics.trafficLightCenterYFromTop = centerYFromTop
        chromeMetrics.leadingClearance = leadingClearance
        chromeMetrics.rowHeight = rowHeight
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
