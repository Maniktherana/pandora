//
//  GhosttyNSView.swift
//  pandora
//
//  Created by Manik Rana on 24/03/26.
//
//  NSView subclass that owns a ghostty_surface_t.
//  Uses CAMetalLayer for GPU-accelerated rendering (TERM-02).
//  Forwards keyboard input to libghostty (TERM-03).
//  Forwards resize events to update PTY dimensions (D-04).
//
//  Keyboard approach (matches cmux / GhosttyTerminalView.swift):
//  - event.keyCode is passed DIRECTLY as ghostty_input_key_s.keycode (raw macOS vkey)
//  - NO lookup table: ghostty maps keycodes internally
//  - interpretKeyEvents accumulates text via insertText (NSTextInputClient)
//  - Fast path for Ctrl+key bypasses interpretKeyEvents
//  - consumed_mods includes only Shift+Option (ctrl/cmd never consumed for text)
//

import AppKit
import GhosttyKit

// MARK: - GhosttyNSView

/// NSView subclass that owns a ghostty_surface_t.
/// One instance per terminal process. In Phase 1 there is exactly one instance.
@MainActor
class GhosttyNSView: NSView, NSTextInputClient {
    private struct ScrollbarState {
        let total: UInt64
        let offset: UInt64
        let visibleLength: UInt64

        var maxOffset: UInt64 {
            total > visibleLength ? total - visibleLength : 0
        }

        var hasScrollableContent: Bool {
            total > visibleLength && visibleLength > 0
        }

        var knobProportion: CGFloat {
            guard total > 0 else { return 1 }
            return CGFloat(visibleLength) / CGFloat(total)
        }

        var doubleValue: Double {
            guard maxOffset > 0 else { return 0 }
            return Double(offset) / Double(maxOffset)
        }
    }

    // MARK: - Properties

    /// The underlying ghostty surface (nil until createSurface is called)
    nonisolated(unsafe) var surface: ghostty_surface_t?

    /// Callback bridge — provides userdata pointer for C callbacks
    private var callbackBridge: GhosttyCallbackBridge?

    /// Session binding for host-managed surfaces. Nil means legacy EXEC-backed mode.
    private var sessionID: String?

    /// Registry used to route session input/output for host-managed surfaces.
    private weak var surfaceRegistry: SurfaceRegistry?

    /// Presentation mode for the surrounding slot layout.
    private var presentationMode: SlotPresentationMode = .single

    /// Marked text buffer for NSTextInputClient (IME/CJK composition)
    private var markedText: NSMutableAttributedString = NSMutableAttributedString()

    /// Text accumulator for interpretKeyEvents — populated by insertText, consumed in keyDown
    private var keyTextAccumulator: [String]? = nil

    /// Guard to ensure createSurface is called only once
    private var surfaceCreated = false

    /// Tracks whether ghostty currently considers this surface focused.
    private var isGhosttyFocused = false

    /// Tracks whether the workspace controller currently wants this session focused.
    private var isRegistryFocusTarget = false

    /// Window notifications used to keep ghostty focus aligned with AppKit key-window state.
    private var windowObservers: [NSObjectProtocol] = []

    /// Overlay scrollbar driven by libghostty's viewport callbacks.
    private lazy var scrollbar: NSScroller = {
        let scroller = NSScroller()
        scroller.target = self
        scroller.action = #selector(handleScrollbarAction(_:))
        scroller.controlSize = .small
        scroller.scrollerStyle = .legacy
        scroller.isHidden = true
        return scroller
    }()

    private var scrollbarState: ScrollbarState?

    // MARK: - Initialization

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        setupMetalLayer()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    private func setupMetalLayer() {
        wantsLayer = true
        let metalLayer = CAMetalLayer()
        metalLayer.device = MTLCreateSystemDefaultDevice()
        metalLayer.pixelFormat = .bgra8Unorm
        metalLayer.framebufferOnly = true
        metalLayer.isOpaque = false
        metalLayer.backgroundColor = NSColor.clear.cgColor
        metalLayer.contentsScale = NSScreen.main?.backingScaleFactor ?? 2.0
        metalLayer.frame = bounds
        layer = metalLayer
        addSubview(scrollbar)
    }

    // MARK: - Surface Lifecycle

    func configure(
        sessionID: String?,
        presentationMode: SlotPresentationMode = .single,
        surfaceRegistry: SurfaceRegistry? = nil
    ) {
        self.sessionID = sessionID
        self.presentationMode = presentationMode
        self.surfaceRegistry = surfaceRegistry ?? self.surfaceRegistry ?? SurfaceRegistry.shared

        if surfaceCreated {
            refreshSurfaceLayout()
        }
    }

    func createSurface(
        app: ghostty_app_t,
        sessionID: String? = nil,
        presentationMode: SlotPresentationMode = .single,
        surfaceRegistry: SurfaceRegistry? = nil
    ) {
        configure(sessionID: sessionID, presentationMode: presentationMode, surfaceRegistry: surfaceRegistry)

        let bridge = GhosttyCallbackBridge(
            view: self,
            sessionID: self.sessionID,
            surfaceRegistry: self.surfaceRegistry
        )
        callbackBridge = bridge
        GhosttyApp.shared.retainBridge(bridge)

        var surfaceConfig = ghostty_surface_config_new()
        surfaceConfig.platform_tag = GHOSTTY_PLATFORM_MACOS
        surfaceConfig.platform = ghostty_platform_u(
            macos: ghostty_platform_macos_s(
                nsview: Unmanaged.passUnretained(self).toOpaque()
            )
        )
        if self.sessionID == nil {
            surfaceConfig.backend = GHOSTTY_SURFACE_IO_BACKEND_EXEC
        } else {
            surfaceConfig.backend = GHOSTTY_SURFACE_IO_BACKEND_HOST_MANAGED
        }
        surfaceConfig.userdata = Unmanaged.passUnretained(bridge).toOpaque()
        surfaceConfig.scale_factor = Double(window?.backingScaleFactor
            ?? NSScreen.main?.backingScaleFactor ?? 2.0)
        switch presentationMode {
        case .single:
            surfaceConfig.context = GHOSTTY_SURFACE_CONTEXT_WINDOW
        case .tabs:
            surfaceConfig.context = GHOSTTY_SURFACE_CONTEXT_TAB
        case .split:
            surfaceConfig.context = GHOSTTY_SURFACE_CONTEXT_SPLIT
        }

        if self.sessionID == nil {
            let shell = resolveLoginShell()
            shell.withCString { shellPtr in
                surfaceConfig.command = shellPtr
                surface = ghostty_surface_new(app, &surfaceConfig)
            }
        } else {
            surfaceConfig.receive_userdata = Unmanaged.passUnretained(bridge).toOpaque()
            surfaceConfig.receive_buffer = { userdata, ptr, len in
                guard let userdata, let ptr else { return }
                let bridge = Unmanaged<GhosttyCallbackBridge>.fromOpaque(userdata).takeUnretainedValue()
                bridge.routeInput(Data(bytes: ptr, count: len))
            }
            surfaceConfig.receive_resize = { userdata, cols, rows, _, _ in
                guard let userdata else { return }
                let bridge = Unmanaged<GhosttyCallbackBridge>.fromOpaque(userdata).takeUnretainedValue()
                bridge.routeResize(cols: UInt32(cols), rows: UInt32(rows))
            }
            surfaceConfig.command = nil
            surface = ghostty_surface_new(app, &surfaceConfig)
        }

        if surface == nil {
            NSLog("GhosttyNSView: ghostty_surface_new() returned nil — terminal will not render")
            return
        }

        if let sessionID, let surfaceRegistry {
            surfaceRegistry.register(self, for: sessionID)
            surfaceRegistry.flushPendingOutput(for: sessionID)
        }
    }

    // MARK: - Login Shell Resolution

    private func resolveLoginShell() -> String {
        if let shell = ProcessInfo.processInfo.environment["SHELL"], !shell.isEmpty {
            return shell
        }
        if let pw = getpwuid(getuid()), let shellPtr = pw.pointee.pw_shell {
            let shell = String(cString: shellPtr)
            if !shell.isEmpty { return shell }
        }
        return "/bin/zsh"
    }

    // MARK: - Keyboard Input (TERM-03)

    override var acceptsFirstResponder: Bool { true }

    override func becomeFirstResponder() -> Bool {
        let accepted = super.becomeFirstResponder()
        if accepted {
            surfaceRegistry?.claimFocus(for: self)
        }
        return accepted
    }

    override func resignFirstResponder() -> Bool {
        let accepted = super.resignFirstResponder()
        if accepted {
            surfaceRegistry?.releaseFocus(for: self)
        }
        return accepted
    }

    override func keyDown(with event: NSEvent) {
        if handleOwnedShortcut(event) {
            return
        }

        guard let surface = surface else { return }
        surfaceRegistry?.claimFocus(for: self)

        let action: ghostty_input_action_e = event.isARepeat ? GHOSTTY_ACTION_REPEAT : GHOSTTY_ACTION_PRESS

        // Fast path for Ctrl+key: bypass interpretKeyEvents entirely.
        // Control input is terminal control, not text composition.
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        if flags.contains(.control) && !flags.contains(.command) && !flags.contains(.option) && !hasMarkedText() {
            surfaceRegistry?.claimFocus(for: self)
            var keyEvent = ghostty_input_key_s()
            keyEvent.action = action
            keyEvent.keycode = UInt32(event.keyCode)  // raw macOS vkey — ghostty maps internally
            keyEvent.mods = modsFromEvent(event)
            keyEvent.consumed_mods = GHOSTTY_MODS_NONE
            keyEvent.composing = false
            keyEvent.unshifted_codepoint = unshiftedCodepoint(from: event)

            let text = event.charactersIgnoringModifiers ?? event.characters ?? ""
            if text.isEmpty {
                keyEvent.text = nil
                _ = ghostty_surface_key(surface, keyEvent)
            } else {
                text.withCString { ptr in
                    keyEvent.text = ptr
                    _ = ghostty_surface_key(surface, keyEvent)
                }
            }
            return
        }

        // Compute translation mods via ghostty config (handles macos-option-as-alt etc.)
        let translationModsGhostty = ghostty_surface_key_translation_mods(surface, modsFromEvent(event))
        var translationMods = event.modifierFlags
        for flag: NSEvent.ModifierFlags in [.shift, .control, .option, .command] {
            let hasFlag: Bool
            switch flag {
            case .shift:   hasFlag = (translationModsGhostty.rawValue & GHOSTTY_MODS_SHIFT.rawValue) != 0
            case .control: hasFlag = (translationModsGhostty.rawValue & GHOSTTY_MODS_CTRL.rawValue)  != 0
            case .option:  hasFlag = (translationModsGhostty.rawValue & GHOSTTY_MODS_ALT.rawValue)   != 0
            case .command: hasFlag = (translationModsGhostty.rawValue & GHOSTTY_MODS_SUPER.rawValue) != 0
            default:       hasFlag = translationMods.contains(flag)
            }
            if hasFlag { translationMods.insert(flag) } else { translationMods.remove(flag) }
        }

        let translationEvent: NSEvent
        if translationMods == event.modifierFlags {
            translationEvent = event
        } else {
            translationEvent = NSEvent.keyEvent(
                with: event.type,
                location: event.locationInWindow,
                modifierFlags: translationMods,
                timestamp: event.timestamp,
                windowNumber: event.windowNumber,
                context: nil,
                characters: event.characters(byApplyingModifiers: translationMods) ?? "",
                charactersIgnoringModifiers: event.charactersIgnoringModifiers ?? "",
                isARepeat: event.isARepeat,
                keyCode: event.keyCode
            ) ?? event
        }

        // Set up text accumulator — insertText will populate this during interpretKeyEvents
        keyTextAccumulator = []
        defer { keyTextAccumulator = nil }

        let markedTextBefore = markedText.length > 0

        // Let AppKit handle IME, dead keys, option sequences etc.
        interpretKeyEvents([translationEvent])

        // Build the ghostty key event
        var keyEvent = ghostty_input_key_s()
        keyEvent.action = action
        keyEvent.keycode = UInt32(event.keyCode)  // raw macOS vkey — ghostty maps internally
        keyEvent.mods = modsFromEvent(event)
        keyEvent.consumed_mods = consumedMods(from: translationMods)
        keyEvent.unshifted_codepoint = unshiftedCodepoint(from: event)
        keyEvent.composing = markedText.length > 0 || markedTextBefore

        let accumulated = keyTextAccumulator ?? []
        if !accumulated.isEmpty {
            // Text from insertText (IME composition result or normal typing)
            keyEvent.composing = false
            for text in accumulated {
                if shouldSendText(text) {
                    text.withCString { ptr in
                        keyEvent.text = ptr
                        _ = ghostty_surface_key(surface, keyEvent)
                    }
                } else {
                    keyEvent.consumed_mods = GHOSTTY_MODS_NONE
                    keyEvent.text = nil
                    _ = ghostty_surface_key(surface, keyEvent)
                }
            }
            // If Enter/Return committed IME, also send the confirm key
            if markedTextBefore && markedText.length == 0 {
                if event.keyCode == 36 || event.keyCode == 76 {
                    keyEvent.consumed_mods = GHOSTTY_MODS_NONE
                    keyEvent.text = nil
                    _ = ghostty_surface_key(surface, keyEvent)
                }
            }
        } else {
            // No accumulated text — derive from event directly
            if let text = textForKeyEvent(translationEvent) {
                if shouldSendText(text) {
                    text.withCString { ptr in
                        keyEvent.text = ptr
                        _ = ghostty_surface_key(surface, keyEvent)
                    }
                } else {
                    keyEvent.consumed_mods = GHOSTTY_MODS_NONE
                    keyEvent.text = nil
                    _ = ghostty_surface_key(surface, keyEvent)
                }
            } else {
                keyEvent.consumed_mods = GHOSTTY_MODS_NONE
                keyEvent.text = nil
                _ = ghostty_surface_key(surface, keyEvent)
            }
        }
    }

    override func keyUp(with event: NSEvent) {
        guard let surface = surface else { return }
        var keyEvent = ghostty_input_key_s()
        keyEvent.action = GHOSTTY_ACTION_RELEASE
        keyEvent.keycode = UInt32(event.keyCode)
        keyEvent.mods = modsFromEvent(event)
        keyEvent.consumed_mods = GHOSTTY_MODS_NONE
        keyEvent.text = nil
        keyEvent.composing = false
        keyEvent.unshifted_codepoint = unshiftedCodepoint(from: event)
        _ = ghostty_surface_key(surface, keyEvent)
    }

    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        if handleOwnedShortcut(event) {
            return true
        }
        return super.performKeyEquivalent(with: event)
    }

    override func flagsChanged(with event: NSEvent) {
        guard let surface = surface else { return }
        let isPress = isModifierPress(event)
        let action: ghostty_input_action_e = isPress ? GHOSTTY_ACTION_PRESS : GHOSTTY_ACTION_RELEASE
        var keyEvent = ghostty_input_key_s()
        keyEvent.action = action
        keyEvent.keycode = UInt32(event.keyCode)
        keyEvent.mods = modsFromEvent(event)
        keyEvent.consumed_mods = GHOSTTY_MODS_NONE
        keyEvent.text = nil
        keyEvent.composing = false
        _ = ghostty_surface_key(surface, keyEvent)
    }

    // MARK: - Keyboard Helpers

    private func modsFromEvent(_ event: NSEvent) -> ghostty_input_mods_e {
        var mods: UInt32 = 0
        if event.modifierFlags.contains(.shift)   { mods |= GHOSTTY_MODS_SHIFT.rawValue }
        if event.modifierFlags.contains(.control) { mods |= GHOSTTY_MODS_CTRL.rawValue  }
        if event.modifierFlags.contains(.option)  { mods |= GHOSTTY_MODS_ALT.rawValue   }
        if event.modifierFlags.contains(.command) { mods |= GHOSTTY_MODS_SUPER.rawValue }
        if event.modifierFlags.contains(.capsLock) { mods |= GHOSTTY_MODS_CAPS.rawValue }
        return ghostty_input_mods_e(rawValue: mods)
    }

    /// Only Shift and Option can be consumed for text translation.
    /// Control and Command are never consumed.
    private func consumedMods(from flags: NSEvent.ModifierFlags) -> ghostty_input_mods_e {
        var mods: UInt32 = 0
        if flags.contains(.shift)  { mods |= GHOSTTY_MODS_SHIFT.rawValue }
        if flags.contains(.option) { mods |= GHOSTTY_MODS_ALT.rawValue   }
        return ghostty_input_mods_e(rawValue: mods)
    }

    /// The codepoint produced by the key without any modifiers.
    private func unshiftedCodepoint(from event: NSEvent) -> UInt32 {
        guard event.type == .keyDown || event.type == .keyUp else { return 0 }
        if let chars = event.characters(byApplyingModifiers: []),
           let scalar = chars.unicodeScalars.first,
           scalar.value >= 0x20,
           !(scalar.value >= 0xF700 && scalar.value <= 0xF8FF) {
            return scalar.value
        }
        if let chars = event.charactersIgnoringModifiers ?? event.characters,
           let scalar = chars.unicodeScalars.first {
            return scalar.value
        }
        return 0
    }

    private func isModifierPress(_ event: NSEvent) -> Bool {
        let flags = event.modifierFlags
        switch event.keyCode {
        case 56, 60: return flags.contains(.shift)
        case 58, 61: return flags.contains(.option)
        case 59, 62: return flags.contains(.control)
        case 55, 54: return flags.contains(.command)
        case 57:     return flags.contains(.capsLock)
        default:     return false
        }
    }

    private func isControlCharacter(_ scalar: Unicode.Scalar) -> Bool {
        scalar.value < 0x20 || scalar.value == 0x7F
    }

    /// Returns the text string to attach to a key event.
    /// Returns nil for nav/function keys (Private Use Area F700–F8FF).
    /// For Ctrl+key, returns the unmodified char so ghostty's KeyEncoder handles ctrl encoding.
    private func textForKeyEvent(_ event: NSEvent) -> String? {
        guard let chars = event.characters, !chars.isEmpty else { return nil }
        if chars.count == 1, let scalar = chars.unicodeScalars.first {
            if scalar.value >= 0xF700 && scalar.value <= 0xF8FF { return nil }
            if isControlCharacter(scalar) && event.modifierFlags.contains(.control) {
                return event.characters(byApplyingModifiers: event.modifierFlags.subtracting(.control))
            }
        }
        return chars
    }

    private func shouldSendText(_ text: String) -> Bool {
        guard !text.isEmpty else { return false }
        if text.count == 1, let scalar = text.unicodeScalars.first {
            return !isControlCharacter(scalar)
        }
        return true
    }

    // MARK: - Resize Propagation (D-04)

    override func setFrameSize(_ newSize: NSSize) {
        super.setFrameSize(newSize)
        refreshSurfaceLayout()
    }

    override func layout() {
        super.layout()
        layoutScrollbar()
        refreshSurfaceLayout()
    }

    private func refreshSurfaceLayout() {
        let contentBounds = terminalContentBounds()
        let backingSize = convertToBacking(contentBounds).size
        if let metalLayer = layer as? CAMetalLayer {
            metalLayer.frame = contentBounds
            metalLayer.drawableSize = backingSize
        }
        guard let surface = surface,
              backingSize.width > 0,
              backingSize.height > 0
        else { return }
        ghostty_surface_set_size(surface, UInt32(backingSize.width), UInt32(backingSize.height))
        ghostty_surface_refresh(surface)
    }

    private func layoutScrollbar() {
        let width = NSScroller.scrollerWidth(for: .regular, scrollerStyle: .legacy)
        scrollbar.frame = NSRect(
            x: bounds.maxX - width,
            y: bounds.minY,
            width: width,
            height: bounds.height
        )
    }

    private func terminalContentBounds() -> NSRect {
        guard let state = scrollbarState, state.hasScrollableContent else {
            return bounds
        }

        let scrollbarWidth = NSScroller.scrollerWidth(for: .regular, scrollerStyle: .legacy)
        return NSRect(
            x: bounds.minX,
            y: bounds.minY,
            width: max(bounds.width - scrollbarWidth, 0),
            height: bounds.height
        )
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        installWindowObservers()
        guard window != nil else {
            removeWindowObservers()
            surfaceRegistry?.releaseFocus(for: self)
            return
        }

        if !surfaceCreated {
            surfaceCreated = true
            createSurface(
                app: GhosttyApp.shared.app,
                sessionID: sessionID,
                presentationMode: presentationMode,
                surfaceRegistry: surfaceRegistry
            )
            if let surface = surface {
                ghostty_surface_refresh(surface)
                let backingSize = convertToBacking(NSRect(origin: .zero, size: bounds.size)).size
                if backingSize.width > 0 && backingSize.height > 0 {
                    ghostty_surface_set_size(surface, UInt32(backingSize.width), UInt32(backingSize.height))
                }
            }

            if window?.firstResponder === self {
                surfaceRegistry?.claimFocus(for: self)
            } else {
                applyRegistryFocus(false)
                surfaceRegistry?.synchronizeFocus(for: self)
            }
        }

        if surfaceRegistry?.focusedSessionID == sessionID {
            window?.makeFirstResponder(self)
        }

        if window?.firstResponder === self {
            surfaceRegistry?.claimFocus(for: self)
        } else {
            surfaceRegistry?.synchronizeFocus(for: self)
        }
    }

    // MARK: - Action and Close Callbacks

    func handleAction(_ action: ghostty_action_s) {
        if action.tag == GHOSTTY_ACTION_SET_TITLE {
            if let titlePtr = action.action.set_title.title {
                let title = String(cString: titlePtr)
                window?.title = title
            }
        } else if action.tag == GHOSTTY_ACTION_SCROLLBAR {
            let scrollbarAction = action.action.scrollbar
            updateScrollbar(
                ScrollbarState(
                    total: scrollbarAction.total,
                    offset: scrollbarAction.offset,
                    visibleLength: scrollbarAction.len
                )
            )
        }
    }

    func handleClose(processAlive: Bool) {
        window?.close()
    }

    // MARK: - Mouse Events

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        trackingAreas.forEach { removeTrackingArea($0) }
        let area = NSTrackingArea(
            rect: bounds,
            options: [.activeInKeyWindow, .mouseMoved, .mouseEnteredAndExited, .inVisibleRect],
            owner: self,
            userInfo: nil
        )
        addTrackingArea(area)
    }

    override func mouseDown(with event: NSEvent) {
        guard let surface = surface else { return }
        window?.makeFirstResponder(self)
        let point = convertedMousePoint(from: event)
        ghostty_surface_mouse_pos(surface, point.x, point.y, modsFromEvent(event))
        ghostty_surface_mouse_button(surface, GHOSTTY_MOUSE_PRESS, GHOSTTY_MOUSE_LEFT, modsFromEvent(event))
    }

    override func mouseUp(with event: NSEvent) {
        guard let surface = surface else { return }
        let point = convertedMousePoint(from: event)
        ghostty_surface_mouse_pos(surface, point.x, point.y, modsFromEvent(event))
        ghostty_surface_mouse_button(surface, GHOSTTY_MOUSE_RELEASE, GHOSTTY_MOUSE_LEFT, modsFromEvent(event))
    }

    override func rightMouseDown(with event: NSEvent) {
        guard let surface = surface else { return }
        window?.makeFirstResponder(self)
        let point = convertedMousePoint(from: event)
        ghostty_surface_mouse_pos(surface, point.x, point.y, modsFromEvent(event))
        ghostty_surface_mouse_button(surface, GHOSTTY_MOUSE_PRESS, GHOSTTY_MOUSE_RIGHT, modsFromEvent(event))
    }

    override func rightMouseUp(with event: NSEvent) {
        guard let surface = surface else { return }
        let point = convertedMousePoint(from: event)
        ghostty_surface_mouse_pos(surface, point.x, point.y, modsFromEvent(event))
        ghostty_surface_mouse_button(surface, GHOSTTY_MOUSE_RELEASE, GHOSTTY_MOUSE_RIGHT, modsFromEvent(event))
    }

    override func mouseMoved(with event: NSEvent) {
        guard let surface = surface else { return }
        let point = convertedMousePoint(from: event)
        ghostty_surface_mouse_pos(surface, point.x, point.y, modsFromEvent(event))
    }

    override func mouseDragged(with event: NSEvent) {
        mouseMoved(with: event)
    }

    override func scrollWheel(with event: NSEvent) {
        guard let surface = surface else { return }
        ghostty_surface_mouse_scroll(
            surface,
            event.scrollingDeltaX,
            event.scrollingDeltaY,
            scrollModifiers(from: event)
        )
    }

    private func convertedMousePoint(from event: NSEvent) -> NSPoint {
        let point = convert(event.locationInWindow, from: nil)
        return NSPoint(x: point.x, y: bounds.height - point.y)
    }

    private func updateScrollbar(_ state: ScrollbarState) {
        scrollbarState = state
        scrollbar.knobProportion = max(0.05, min(state.knobProportion, 1))
        scrollbar.doubleValue = min(max(state.doubleValue, 0), 1)
        scrollbar.isEnabled = state.hasScrollableContent
        scrollbar.isHidden = !state.hasScrollableContent
        layoutScrollbar()
        refreshSurfaceLayout()
    }

    @objc
    private func handleScrollbarAction(_ sender: NSScroller) {
        guard let state = scrollbarState else { return }

        switch sender.hitPart {
        case .decrementPage:
            _ = performBindingAction("scroll_page_up")
        case .incrementPage:
            _ = performBindingAction("scroll_page_down")
        case .decrementLine:
            scrollToRow(max(Int64(state.offset) - 3, 0))
        case .incrementLine:
            scrollToRow(min(Int64(state.offset) + 3, Int64(state.maxOffset)))
        case .knob, .knobSlot:
            let target = UInt64((sender.doubleValue * Double(state.maxOffset)).rounded())
            scrollToRow(Int64(target))
        default:
            break
        }
    }

    @discardableResult
    private func performBindingAction(_ action: String) -> Bool {
        guard let surface else { return false }
        return action.withCString { cString in
            ghostty_surface_binding_action(surface, cString, UInt(action.utf8.count))
        }
    }

    private func scrollToRow(_ row: Int64) {
        let clampedRow = max(row, 0)
        _ = performBindingAction("scroll_to_row:\(clampedRow)")
    }

    private func scrollModifiers(from event: NSEvent) -> ghostty_input_scroll_mods_t {
        var value: Int32 = 0
        if event.hasPreciseScrollingDeltas {
            value |= 1
        }

        let momentum: Int32
        if event.momentumPhase.contains(.began) {
            momentum = 1
        } else if event.momentumPhase.contains(.stationary) {
            momentum = 2
        } else if event.momentumPhase.contains(.changed) {
            momentum = 3
        } else {
            momentum = 0
        }

        value |= momentum << 1
        return value
    }

    func feedOutput(_ data: Data) {
        guard let surface else { return }
        data.withUnsafeBytes { buffer in
            guard let ptr = buffer.baseAddress?.assumingMemoryBound(to: UInt8.self) else { return }
            ghostty_surface_write_buffer(surface, ptr, UInt(buffer.count))
        }
    }

    func applyRegistryFocus(_ focused: Bool) {
        isRegistryFocusTarget = focused
        refreshGhosttyFocus()
    }

    /// Unconditionally tells ghostty this surface is unfocused, bypassing the
    /// `isGhosttyFocused` guard. Called by `SurfaceRegistry.clearFocus()` so that
    /// transitioning to sidebar mode always stops cursor blinking even when our
    /// tracked focus state diverges from ghostty's internal state.
    func forceGhosttyUnfocus() {
        isRegistryFocusTarget = false
        guard let surface else {
            isGhosttyFocused = false
            return
        }
        ghostty_surface_set_focus(surface, false)
        isGhosttyFocused = false
    }

    private func refreshGhosttyFocus() {
        guard let surface else {
            isGhosttyFocused = false
            return
        }
        let shouldFocus = isRegistryFocusTarget
            && window?.isKeyWindow == true
            && window?.firstResponder === self
        guard isGhosttyFocused != shouldFocus else { return }
        ghostty_surface_set_focus(surface, shouldFocus)
        isGhosttyFocused = shouldFocus
    }

    private func installWindowObservers() {
        guard let window else {
            removeWindowObservers()
            return
        }

        if !windowObservers.isEmpty {
            return
        }

        let center = NotificationCenter.default
        windowObservers.append(
            center.addObserver(
                forName: NSWindow.didBecomeKeyNotification,
                object: window,
                queue: .main
            ) { [weak self] _ in
                Task { @MainActor [weak self] in
                    guard let self else { return }
                    if window.firstResponder === self {
                        self.surfaceRegistry?.claimFocus(for: self)
                    } else {
                        self.surfaceRegistry?.synchronizeFocus(for: self)
                    }
                }
            }
        )
        windowObservers.append(
            center.addObserver(
                forName: NSWindow.didResignKeyNotification,
                object: window,
                queue: .main
            ) { [weak self] _ in
                Task { @MainActor [weak self] in
                    guard let self else { return }
                    self.surfaceRegistry?.synchronizeFocus(for: self)
                }
            }
        )
    }

    private func removeWindowObservers() {
        let center = NotificationCenter.default
        for observer in windowObservers {
            center.removeObserver(observer)
        }
        windowObservers.removeAll()
    }

    // MARK: - Deallocation

    deinit {
        if let sessionID {
            DispatchQueue.main.async { [weak surfaceRegistry] in
                surfaceRegistry?.unregister(sessionID: sessionID)
            }
        }
        if let surface = surface {
            ghostty_surface_free(surface)
        }
        if let bridge = callbackBridge {
            DispatchQueue.main.async {
                GhosttyApp.shared.removeBridge(bridge)
            }
        }
    }

    /// Silently consume all selector-based commands dispatched by interpretKeyEvents.
    /// Without this, AppKit propagates commands like insertNewline: up the responder chain
    /// for keys such as Enter, which ends at the window and triggers NSBeep when unhandled.
    /// The terminal handles all key input via ghostty_surface_key, so these dispatches are always spurious.
    override func doCommand(by selector: Selector) {
        // intentionally a no-op — swallow without beeping
    }
}

// MARK: - NSTextInputClient (IME/CJK Composition — TERM-03)

extension GhosttyNSView {

    func insertText(_ string: Any, replacementRange: NSRange) {
        // Accumulate text during interpretKeyEvents; keyDown reads and sends it.
        let text: String
        if let attributed = string as? NSAttributedString {
            text = attributed.string
        } else if let plain = string as? String {
            text = plain
        } else {
            return
        }
        if keyTextAccumulator != nil {
            keyTextAccumulator!.append(text)
        } else {
            // Called outside of keyDown (e.g. direct IME commit) — send immediately
            guard let surface = surface else { return }
            var keyEvent = ghostty_input_key_s()
            keyEvent.action = GHOSTTY_ACTION_PRESS
            keyEvent.keycode = 0
            keyEvent.mods = GHOSTTY_MODS_NONE
            keyEvent.consumed_mods = GHOSTTY_MODS_NONE
            keyEvent.composing = false
            text.withCString { ptr in
                keyEvent.text = ptr
                _ = ghostty_surface_key(surface, keyEvent)
            }
        }
        markedText = NSMutableAttributedString()
    }

    func setMarkedText(_ string: Any, selectedRange: NSRange, replacementRange: NSRange) {
        if let attributed = string as? NSAttributedString {
            markedText = NSMutableAttributedString(attributedString: attributed)
        } else if let plain = string as? String {
            markedText = NSMutableAttributedString(string: plain)
        }
        if let surface = surface {
            let text = markedText.string
            text.withCString { ptr in
                ghostty_surface_preedit(surface, ptr, UInt(text.utf8.count))
            }
        }
    }

    func unmarkText() {
        markedText = NSMutableAttributedString()
    }

    func selectedRange() -> NSRange {
        NSRange(location: NSNotFound, length: 0)
    }

    func markedRange() -> NSRange {
        if markedText.length > 0 {
            return NSRange(location: 0, length: markedText.length)
        }
        return NSRange(location: NSNotFound, length: 0)
    }

    func hasMarkedText() -> Bool {
        markedText.length > 0
    }

    func attributedSubstring(forProposedRange range: NSRange, actualRange: NSRangePointer?) -> NSAttributedString? {
        nil
    }

    func validAttributesForMarkedText() -> [NSAttributedString.Key] {
        []
    }

    func firstRect(forCharacterRange range: NSRange, actualRange: NSRangePointer?) -> NSRect {
        guard let surface = surface else { return .zero }
        var x: Double = 0, y: Double = 0, w: Double = 0, h: Double = 0
        ghostty_surface_ime_point(surface, &x, &y, &w, &h)
        let localPoint = NSPoint(x: x, y: y)
        let screenPoint = window?.convertToScreen(NSRect(origin: convert(localPoint, to: nil), size: .zero))
        return screenPoint ?? .zero
    }

    func characterIndex(for point: NSPoint) -> Int {
        NSNotFound
    }

}

private extension GhosttyNSView {
    func handleOwnedShortcut(_ event: NSEvent) -> Bool {
        let modifiers = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        guard modifiers.contains(.command),
              modifiers.subtracting(.command).isEmpty else {
            return false
        }

        if event.keyCode == 33 || event.charactersIgnoringModifiers == "[" {
            return surfaceRegistry?.handleCommandBracket(forward: false) ?? false
        }

        if event.keyCode == 30 || event.charactersIgnoringModifiers == "]" {
            return surfaceRegistry?.handleCommandBracket(forward: true) ?? false
        }

        if event.keyCode == 13 || event.charactersIgnoringModifiers?.lowercased() == "w" {
            return WorkspaceCloseTabBridge.shared.closeFocusedTab()
        }

        if event.keyCode == 12 || event.charactersIgnoringModifiers?.lowercased() == "q" {
            NSApp.terminate(nil)
            return true
        }

        return false
    }
}
