#import <AppKit/AppKit.h>
#import "ghostty.h"

// Rust: native_shortcuts.rs — 0 = Ghostty, 1 = emitted app-shortcut, 2 = super (Cmd+Q quit chain)
uint8_t pandora_try_emit_app_shortcut(unsigned int keycode, BOOL cmd, BOOL shift, BOOL ctrl, BOOL alt);
void pandora_emit_terminal_focus(const char *session_id);

static ghostty_input_mods_e PandoraModsFromEvent(NSEvent *event) {
    NSUInteger flags = event.modifierFlags & NSEventModifierFlagDeviceIndependentFlagsMask;
    uint32_t mods = 0;
    if (flags & NSEventModifierFlagShift) {
        mods |= GHOSTTY_MODS_SHIFT;
    }
    if (flags & NSEventModifierFlagControl) {
        mods |= GHOSTTY_MODS_CTRL;
    }
    if (flags & NSEventModifierFlagOption) {
        mods |= GHOSTTY_MODS_ALT;
    }
    if (flags & NSEventModifierFlagCommand) {
        mods |= GHOSTTY_MODS_SUPER;
    }
    if (flags & NSEventModifierFlagCapsLock) {
        mods |= GHOSTTY_MODS_CAPS;
    }
    return (ghostty_input_mods_e)mods;
}

static uint32_t PandoraUnshiftedCodepoint(NSEvent *event) {
    NSString *chars = [event charactersIgnoringModifiers];
    if (chars.length == 0) {
        chars = [event characters];
    }
    if (chars.length == 0) {
        return 0;
    }
    return [chars characterAtIndex:0];
}

/// Embedded Ghostty host-managed surface is more sensitive than standalone Ghostty’s AppKit path;
/// trackpad deltas are scaled down heavily so scrollback matches the real app.
static const double kPandoraScrollScalePrecise = 0.13;
static const double kPandoraScrollScaleDiscrete = 0.40;

static void PandoraScaledScrollDeltas(NSEvent *event, double *outDx, double *outDy) {
    double scale = [event hasPreciseScrollingDeltas] ? kPandoraScrollScalePrecise : kPandoraScrollScaleDiscrete;
    *outDx = event.scrollingDeltaX * scale;
    *outDy = event.scrollingDeltaY * scale;
}

@interface PandoraTerminalNativeView : NSView
@property(nonatomic, assign) ghostty_surface_t surface;
@property(nonatomic, copy, nullable) NSString *sessionID;
@end

@implementation PandoraTerminalNativeView

/// Ghostty needs an explicit pixel grid + content scale (host-managed path). Pure native terminals
/// get backing updates from AppKit automatically; we mirror that here so moving the window to
/// another display updates scale without relying on the webview/JS sync loop.
- (void)pandoraSyncBackingToSurface {
    if (self.surface == NULL) {
        return;
    }
    NSWindow *win = self.window;
    CGFloat scale = (win != nil) ? win.backingScaleFactor : 1.0;
    if (scale <= 0.0 || scale != scale) {
        scale = 1.0;
    }
    NSSize sz = self.bounds.size;
    uint32_t w = (uint32_t)fmax(1.0, round(sz.width * scale));
    uint32_t h = (uint32_t)fmax(1.0, round(sz.height * scale));
    ghostty_surface_set_content_scale(self.surface, scale, scale);
    ghostty_surface_set_size(self.surface, w, h);
    if (self.layer != nil) {
        self.layer.contentsScale = scale;
    }
}

- (void)viewDidChangeBackingProperties {
    [super viewDidChangeBackingProperties];
    [self pandoraSyncBackingToSurface];
}

- (void)viewDidMoveToWindow {
    [super viewDidMoveToWindow];
    [self pandoraSyncBackingToSurface];
}

- (BOOL)acceptsFirstResponder {
    return YES;
}

- (BOOL)acceptsFirstMouse:(NSEvent *)event {
    return YES;
}

- (BOOL)canBecomeKeyView {
    return YES;
}

- (BOOL)becomeFirstResponder {
    BOOL accepted = [super becomeFirstResponder];
    if (accepted && self.surface != NULL) {
        ghostty_surface_set_focus(self.surface, true);
        if (self.sessionID != nil) {
            pandora_emit_terminal_focus(self.sessionID.UTF8String);
        }
    }
    return accepted;
}

- (BOOL)resignFirstResponder {
    BOOL accepted = [super resignFirstResponder];
    if (accepted && self.surface != NULL) {
        ghostty_surface_set_focus(self.surface, false);
    }
    return accepted;
}

- (void)keyDown:(NSEvent *)event {
    if (self.surface == NULL) {
        return;
    }

    NSUInteger f = [event modifierFlags] & NSEventModifierFlagDeviceIndependentFlagsMask;
    BOOL cmd = (f & NSEventModifierFlagCommand) != 0;
    BOOL shift = (f & NSEventModifierFlagShift) != 0;
    BOOL ctrl = (f & NSEventModifierFlagControl) != 0;
    BOOL alt = (f & NSEventModifierFlagOption) != 0;
    uint8_t route = pandora_try_emit_app_shortcut((unsigned int)event.keyCode, cmd, shift, ctrl, alt);
    if (route == 1) {
        return;
    }
    if (route == 2) {
        [super keyDown:event];
        return;
    }

    NSString *charsIgnoringModifiers = [event charactersIgnoringModifiers];
    unichar firstChar = charsIgnoringModifiers.length > 0 ? [charsIgnoringModifiers characterAtIndex:0] : 0;
    if (cmd && !ctrl && !alt) {
        if (firstChar == 'c' || firstChar == 'C') {
            [self copy:nil];
            return;
        }
        if (firstChar == 'v' || firstChar == 'V') {
            [self paste:nil];
            return;
        }
    }

    ghostty_input_key_s key = {0};
    key.action = event.isARepeat ? GHOSTTY_ACTION_REPEAT : GHOSTTY_ACTION_PRESS;
    key.keycode = (uint32_t) event.keyCode;
    key.mods = PandoraModsFromEvent(event);
    key.consumed_mods = GHOSTTY_MODS_NONE;
    key.unshifted_codepoint = PandoraUnshiftedCodepoint(event);
    key.composing = false;

    NSString *text = [event characters];
    // Control/command chords should be delivered as key events only. Passing printable
    // text here makes Ghostty treat shortcuts like Ctrl+C as modified text input.
    if (!ctrl && !cmd && text.length > 0) {
        key.text = text.UTF8String;
    }

    ghostty_surface_key(self.surface, key);
}

- (BOOL)performKeyEquivalent:(NSEvent *)event {
    NSUInteger f = [event modifierFlags] & NSEventModifierFlagDeviceIndependentFlagsMask;
    BOOL cmd = (f & NSEventModifierFlagCommand) != 0;
    BOOL ctrl = (f & NSEventModifierFlagControl) != 0;
    BOOL alt = (f & NSEventModifierFlagOption) != 0;
    if (cmd && !ctrl && !alt) {
        NSString *charsIgnoringModifiers = [event charactersIgnoringModifiers];
        unichar firstChar = charsIgnoringModifiers.length > 0 ? [charsIgnoringModifiers characterAtIndex:0] : 0;
        if (firstChar == 'c' || firstChar == 'C') {
            [self copy:nil];
            return YES;
        }
        if (firstChar == 'v' || firstChar == 'V') {
            [self paste:nil];
            return YES;
        }
    }
    return [super performKeyEquivalent:event];
}

- (void)copy:(id)sender {
    (void)sender;
    if (self.surface == NULL || !ghostty_surface_has_selection(self.surface)) {
        return;
    }

    ghostty_text_s text = {0};
    if (!ghostty_surface_read_selection(self.surface, &text) || text.text == NULL || text.text_len == 0) {
        if (text.text != NULL) {
            ghostty_surface_free_text(self.surface, &text);
        }
        return;
    }

    NSString *string = [[NSString alloc] initWithBytes:text.text
                                                length:text.text_len
                                              encoding:NSUTF8StringEncoding];
    if (string != nil) {
        NSPasteboard *pasteboard = [NSPasteboard generalPasteboard];
        [pasteboard clearContents];
        [pasteboard setString:string forType:NSPasteboardTypeString];
    }
    ghostty_surface_free_text(self.surface, &text);
}

- (void)paste:(id)sender {
    (void)sender;
    if (self.surface == NULL) {
        return;
    }

    NSString *string = [[NSPasteboard generalPasteboard] stringForType:NSPasteboardTypeString];
    if (string == nil || string.length == 0) {
        return;
    }

    NSData *utf8 = [string dataUsingEncoding:NSUTF8StringEncoding];
    if (utf8 == nil || utf8.length == 0) {
        return;
    }
    ghostty_surface_text(self.surface, utf8.bytes, utf8.length);
}

- (BOOL)validateUserInterfaceItem:(id<NSValidatedUserInterfaceItem>)item {
    SEL action = [item action];
    if (action == @selector(copy:)) {
        return self.surface != NULL && ghostty_surface_has_selection(self.surface);
    }
    if (action == @selector(paste:)) {
        NSString *string = [[NSPasteboard generalPasteboard] stringForType:NSPasteboardTypeString];
        return self.surface != NULL && string != nil && string.length > 0;
    }
    return YES;
}

- (void)keyUp:(NSEvent *)event {
    if (self.surface == NULL) {
        return;
    }

    ghostty_input_key_s key = {0};
    key.action = GHOSTTY_ACTION_RELEASE;
    key.keycode = (uint32_t) event.keyCode;
    key.mods = PandoraModsFromEvent(event);
    key.consumed_mods = GHOSTTY_MODS_NONE;
    key.unshifted_codepoint = PandoraUnshiftedCodepoint(event);
    key.composing = false;
    key.text = NULL;

    ghostty_surface_key(self.surface, key);
}

- (void)flagsChanged:(NSEvent *)event {
    if (self.surface == NULL) {
        return;
    }

    ghostty_input_key_s key = {0};
    NSUInteger flags = event.modifierFlags & NSEventModifierFlagDeviceIndependentFlagsMask;
    BOOL pressed = NO;

    switch (event.keyCode) {
        case 56:
        case 60:
            pressed = (flags & NSEventModifierFlagShift) != 0;
            break;
        case 59:
        case 62:
            pressed = (flags & NSEventModifierFlagControl) != 0;
            break;
        case 58:
        case 61:
            pressed = (flags & NSEventModifierFlagOption) != 0;
            break;
        case 55:
        case 54:
            pressed = (flags & NSEventModifierFlagCommand) != 0;
            break;
        default:
            pressed = YES;
            break;
    }

    key.action = pressed ? GHOSTTY_ACTION_PRESS : GHOSTTY_ACTION_RELEASE;
    key.keycode = (uint32_t) event.keyCode;
    key.mods = PandoraModsFromEvent(event);
    key.consumed_mods = GHOSTTY_MODS_NONE;
    key.unshifted_codepoint = 0;
    key.composing = false;
    key.text = NULL;
    ghostty_surface_key(self.surface, key);
}

- (NSPoint)pandoraConvertedPoint:(NSEvent *)event {
    NSPoint point = [self convertPoint:event.locationInWindow fromView:nil];
    return NSMakePoint(point.x, self.bounds.size.height - point.y);
}

- (void)mouseDown:(NSEvent *)event {
    if (self.surface == NULL) {
        return;
    }
    [[self window] makeFirstResponder:self];
    if (self.sessionID != nil) {
        pandora_emit_terminal_focus(self.sessionID.UTF8String);
    }
    NSPoint point = [self pandoraConvertedPoint:event];
    ghostty_surface_mouse_pos(self.surface, point.x, point.y, PandoraModsFromEvent(event));
    ghostty_surface_mouse_button(self.surface, GHOSTTY_MOUSE_PRESS, GHOSTTY_MOUSE_LEFT, PandoraModsFromEvent(event));
}

- (void)mouseUp:(NSEvent *)event {
    if (self.surface == NULL) {
        return;
    }
    NSPoint point = [self pandoraConvertedPoint:event];
    ghostty_surface_mouse_pos(self.surface, point.x, point.y, PandoraModsFromEvent(event));
    ghostty_surface_mouse_button(self.surface, GHOSTTY_MOUSE_RELEASE, GHOSTTY_MOUSE_LEFT, PandoraModsFromEvent(event));
}

- (void)rightMouseDown:(NSEvent *)event {
    if (self.surface == NULL) {
        return;
    }
    [[self window] makeFirstResponder:self];
    if (self.sessionID != nil) {
        pandora_emit_terminal_focus(self.sessionID.UTF8String);
    }
    NSPoint point = [self pandoraConvertedPoint:event];
    ghostty_surface_mouse_pos(self.surface, point.x, point.y, PandoraModsFromEvent(event));
    ghostty_surface_mouse_button(self.surface, GHOSTTY_MOUSE_PRESS, GHOSTTY_MOUSE_RIGHT, PandoraModsFromEvent(event));
}

- (void)rightMouseUp:(NSEvent *)event {
    if (self.surface == NULL) {
        return;
    }
    NSPoint point = [self pandoraConvertedPoint:event];
    ghostty_surface_mouse_pos(self.surface, point.x, point.y, PandoraModsFromEvent(event));
    ghostty_surface_mouse_button(self.surface, GHOSTTY_MOUSE_RELEASE, GHOSTTY_MOUSE_RIGHT, PandoraModsFromEvent(event));
}

- (void)mouseMoved:(NSEvent *)event {
    if (self.surface == NULL) {
        return;
    }
    NSPoint point = [self pandoraConvertedPoint:event];
    ghostty_surface_mouse_pos(self.surface, point.x, point.y, PandoraModsFromEvent(event));
}

- (void)mouseDragged:(NSEvent *)event {
    [self mouseMoved:event];
}

- (void)scrollWheel:(NSEvent *)event {
    if (self.surface == NULL) {
        return;
    }
    double dx, dy;
    PandoraScaledScrollDeltas(event, &dx, &dy);
    ghostty_surface_mouse_scroll(self.surface, dx, dy, 0);
}

@end

void *pandora_terminal_view_new(double x, double y, double width, double height) {
    NSRect frame = NSMakeRect(x, y, width, height);
    PandoraTerminalNativeView *view = [[PandoraTerminalNativeView alloc] initWithFrame:frame];
    return (__bridge_retained void *) view;
}

void pandora_terminal_view_set_surface(void *view_ptr, ghostty_surface_t surface) {
    PandoraTerminalNativeView *view = (__bridge PandoraTerminalNativeView *) view_ptr;
    view.surface = surface;
    [view pandoraSyncBackingToSurface];
}

void pandora_terminal_view_set_session_id(void *view_ptr, const char *session_id) {
    PandoraTerminalNativeView *view = (__bridge PandoraTerminalNativeView *) view_ptr;
    if (session_id == NULL) {
        view.sessionID = nil;
        return;
    }
    view.sessionID = [NSString stringWithUTF8String:session_id];
}

bool pandora_terminal_view_focus(void *view_ptr) {
    PandoraTerminalNativeView *view = (__bridge PandoraTerminalNativeView *) view_ptr;
    NSWindow *window = view.window;
    if (window == nil) {
        return false;
    }
    return [window makeFirstResponder:view];
}
