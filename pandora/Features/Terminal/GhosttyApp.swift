//
//  GhosttyApp.swift
//  pandora
//
//  Created by Manik Rana on 24/03/26.
//
//  Singleton manager for the ghostty_app_t lifecycle.
//  One ghostty_app_t per process — must be created on the main thread.
//  Reads ~/.config/ghostty/config automatically via ghostty_config_load_default_files (TERM-05).
//

import AppKit
import GhosttyKit

// MARK: - Callback Bridge

/// Holds a weak reference to the surface view so C callbacks can dispatch to it.
/// Stored alongside each ghostty_surface_t via userdata pointer.
final class GhosttyCallbackBridge {
    weak var view: GhosttyNSView?
    var sessionID: String?
    weak var surfaceRegistry: SurfaceRegistry?

    init(
        view: GhosttyNSView,
        sessionID: String? = nil,
        surfaceRegistry: SurfaceRegistry? = nil
    ) {
        self.view = view
        self.sessionID = sessionID
        self.surfaceRegistry = surfaceRegistry
    }

    func routeInput(_ data: Data) {
        guard let sessionID else { return }
        DispatchQueue.main.async { [weak self] in
            self?.surfaceRegistry?.sendInput(sessionID: sessionID, data: data)
        }
    }

    func routeResize(cols: UInt32, rows: UInt32) {
        guard let sessionID else { return }
        DispatchQueue.main.async { [weak self] in
            self?.surfaceRegistry?.sendResize(
                sessionID: sessionID,
                cols: Int(cols),
                rows: Int(rows)
            )
        }
    }

    func handleAction(_ action: ghostty_action_s) {
        DispatchQueue.main.async { [weak self] in
            self?.view?.handleAction(action)
        }
    }

    func handleClose(processAlive: Bool) {
        DispatchQueue.main.async { [weak self] in
            self?.view?.handleClose(processAlive: processAlive)
        }
    }
}

// MARK: - GhosttyApp Singleton

/// Manages the ghostty_app_t lifecycle for the entire process.
/// Must be accessed only on the main actor (Pitfall 3: C API must be on main thread).
@MainActor
final class GhosttyApp {

    static let shared = GhosttyApp()

    // nonisolated(unsafe) — the underlying pointer is only ever touched under @MainActor
    nonisolated(unsafe) let app: ghostty_app_t
    nonisolated(unsafe) private var config: ghostty_config_t?

    // Retained bridges — prevent deallocation while surfaces are alive
    private var retainedBridges: [GhosttyCallbackBridge] = []

    private init() {
        // 1. ghostty_init must be called before any other C API (undocumented but required)
        ghostty_init(0, nil)

        // 2. Create and finalize config — reads ~/.config/ghostty/config (TERM-05)
        guard let cfg = ghostty_config_new() else {
            fatalError("GhosttyApp: ghostty_config_new() returned nil")
        }
        ghostty_config_load_default_files(cfg)

        // Override close-on-exit to always so the window closes cleanly when
        // the shell exits, rather than showing "press any key to close".
        // We write a small override file and load it after the user's config
        // because later-loaded values take precedence in ghostty's config merger.
        let overridePath = (NSTemporaryDirectory() as NSString)
            .appendingPathComponent("pandora-ghostty-overrides.conf")
        // login-shell = false: skip /usr/bin/login wrapper which fails with
        // PermissionDenied when the app lacks setuid entitlements. Ghostty
        // will exec the shell directly instead. Proper entitlements + login
        // shell support can be added in a later phase.
        let overrideContent = "close-on-exit = always\nlogin-shell = false\n"
        try? overrideContent.write(toFile: overridePath, atomically: true, encoding: .utf8)
        overridePath.withCString { ghostty_config_load_file(cfg, $0) }

        ghostty_config_finalize(cfg)
        config = cfg

        // 3. Wire runtime callbacks (required — ghostty_app_new takes non-nil callbacks).
        // Use literal closures — required by Swift when -default-isolation=MainActor is active.
        // Literal closures that capture no context (no [weak self]) are valid C function pointers.
        var runtimeConfig = ghostty_runtime_config_s()
        // userdata is not used at app level — callbacks route via surface userdata
        runtimeConfig.userdata = nil
        runtimeConfig.supports_selection_clipboard = false

        // Wakeup: libghostty signals that app needs a tick (may come from any thread)
        runtimeConfig.wakeup_cb = { _ in
            DispatchQueue.main.async { GhosttyApp.shared.tick() }
        }

        // Action: route to surface bridge via userdata pointer
        runtimeConfig.action_cb = { appPtr, target, action in
            guard target.tag == GHOSTTY_TARGET_SURFACE else { return false }
            guard let surfacePtr = target.target.surface else { return false }
            guard let bridgePtr = ghostty_surface_userdata(surfacePtr) else { return false }
            let bridge = Unmanaged<GhosttyCallbackBridge>.fromOpaque(bridgePtr).takeUnretainedValue()
            bridge.handleAction(action)
            return false
        }

        // Close surface: notify the bridge that the process has exited
        runtimeConfig.close_surface_cb = { userdata, processAlive in
            guard let userdata else { return }
            let bridge = Unmanaged<GhosttyCallbackBridge>.fromOpaque(userdata).takeUnretainedValue()
            bridge.handleClose(processAlive: processAlive)
        }

        // Write clipboard: copy terminal-selected text to pasteboard
        runtimeConfig.write_clipboard_cb = { _, _, contents, contentsLen, _ in
            guard contentsLen > 0, let content = contents?.pointee, let data = content.data else { return }
            let string = String(cString: data)
            DispatchQueue.main.async {
                let pasteboard = NSPasteboard.general
                pasteboard.clearContents()
                pasteboard.setString(string, forType: .string)
            }
        }

        // Read clipboard: provide pasteboard content to terminal
        runtimeConfig.read_clipboard_cb = { userdata, _, opaquePtr in
            guard let userdata, let opaquePtr else { return false }
            let bridge = Unmanaged<GhosttyCallbackBridge>.fromOpaque(userdata).takeUnretainedValue()
            guard let surface = bridge.view?.surface else { return false }
            guard let string = NSPasteboard.general.string(forType: .string) else { return false }
            string.withCString { cString in
                ghostty_surface_complete_clipboard_request(surface, cString, opaquePtr, true)
            }
            return true
        }

        // Confirm clipboard read: auto-approve in Phase 1 (no permission dialog)
        runtimeConfig.confirm_read_clipboard_cb = { userdata, str, opaquePtr, _ in
            guard let userdata, let opaquePtr else { return }
            let bridge = Unmanaged<GhosttyCallbackBridge>.fromOpaque(userdata).takeUnretainedValue()
            guard let surface = bridge.view?.surface else { return }
            ghostty_surface_complete_clipboard_request(surface, str, opaquePtr, true)
        }

        // 4. Create app — must succeed; failures are fatal (can't render without app)
        guard let ghosttyApp = ghostty_app_new(&runtimeConfig, cfg) else {
            fatalError("GhosttyApp: ghostty_app_new() returned nil — check config and linker flags")
        }
        app = ghosttyApp

        // 5. Config is retained by app; we keep our own reference for updates
        // (do NOT free config here — app holds a reference to it until ghostty_app_free)
    }

    // MARK: - Bridge Management

    func retainBridge(_ bridge: GhosttyCallbackBridge) {
        retainedBridges.append(bridge)
    }

    func removeBridge(_ bridge: GhosttyCallbackBridge) {
        retainedBridges.removeAll { $0 === bridge }
    }

    // MARK: - App Tick

    /// Called by wakeup callback — drives the ghostty event loop tick
    func tick() {
        ghostty_app_tick(app)
    }

    deinit {
        ghostty_app_free(app)
        if let config {
            ghostty_config_free(config)
        }
    }
}
