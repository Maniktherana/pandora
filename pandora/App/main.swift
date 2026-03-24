//
//  main.swift
//  pandora
//
//  Created by Manik Rana on 24/03/26.
//

import AppKit

MainActor.assumeIsolated {
    let app = NSApplication.shared
    let delegate = AppDelegate()
    app.delegate = delegate
    app.run()
}
