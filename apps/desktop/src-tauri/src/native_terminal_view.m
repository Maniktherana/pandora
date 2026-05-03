#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>
#import <dispatch/dispatch.h>
#import "ghostty.h"

typedef struct {
    double x;
    double y;
    double width;
    double height;
} PandoraTerminalOcclusionRect;

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

static const unsigned short kPandoraKeyCodeC = 8;
static const unsigned short kPandoraKeyCodeV = 9;
static const NSTimeInterval kPandoraSelectionAutoscrollInterval = 1.0 / 24.0;
static const double kPandoraSelectionAutoscrollStep = 1.0;

static BOOL PandoraMatchesCommandKey(NSEvent *event, unsigned short keyCode, unichar fallbackChar) {
    if (event.keyCode == keyCode) {
        return YES;
    }
    NSString *charsIgnoringModifiers = [event charactersIgnoringModifiers];
    unichar firstChar = charsIgnoringModifiers.length > 0 ? [charsIgnoringModifiers characterAtIndex:0] : 0;
    return firstChar == fallbackChar || firstChar == (fallbackChar - 32);
}

static const double kPandoraScrollbarMinimumKnobProportion = 0.03;
static const double kPandoraScrollbarWidth = 12.0;
static const double kPandoraScrollbarThumbWidth = 5.0;
static const double kPandoraScrollbarMinimumThumbHeight = 18.0;
static const double kPandoraScrollbarRightInset = 10.0;
static const double kPandoraScrollbarVerticalInset = 2.0;

static ghostty_input_mouse_momentum_e PandoraMomentumFromPhase(NSEventPhase phase) {
    switch (phase) {
    case NSEventPhaseBegan:
        return GHOSTTY_MOUSE_MOMENTUM_BEGAN;
    case NSEventPhaseStationary:
        return GHOSTTY_MOUSE_MOMENTUM_STATIONARY;
    case NSEventPhaseChanged:
        return GHOSTTY_MOUSE_MOMENTUM_CHANGED;
    case NSEventPhaseEnded:
        return GHOSTTY_MOUSE_MOMENTUM_ENDED;
    case NSEventPhaseCancelled:
        return GHOSTTY_MOUSE_MOMENTUM_CANCELLED;
    case NSEventPhaseMayBegin:
        return GHOSTTY_MOUSE_MOMENTUM_MAY_BEGIN;
    case NSEventPhaseNone:
    default:
        return GHOSTTY_MOUSE_MOMENTUM_NONE;
    }
}

static ghostty_input_scroll_mods_t PandoraScrollModsFromEvent(NSEvent *event) {
    ghostty_input_scroll_mods_t mods = 0;
    if (event.hasPreciseScrollingDeltas) {
        mods |= 1;
    }
    mods |= ((ghostty_input_scroll_mods_t)PandoraMomentumFromPhase(event.momentumPhase)) << 1;
    return mods;
}

static BOOL PandoraRectsOverlap(NSRect a, NSRect b) {
    return NSIntersectsRect(a, b) || NSContainsRect(a, b) || NSContainsRect(b, a);
}

static NSArray<NSValue *> *PandoraMergedOcclusionRects(NSArray<NSValue *> *rects) {
    NSMutableArray<NSValue *> *merged = [rects mutableCopy];
    BOOL changed = YES;

    while (changed) {
        changed = NO;
        for (NSUInteger i = 0; i < merged.count && !changed; i++) {
            NSRect left = merged[i].rectValue;
            for (NSUInteger j = i + 1; j < merged.count; j++) {
                NSRect right = merged[j].rectValue;
                if (!PandoraRectsOverlap(left, right)) {
                    continue;
                }

                NSRect unionRect = NSUnionRect(left, right);
                [merged replaceObjectAtIndex:i withObject:[NSValue valueWithRect:unionRect]];
                [merged removeObjectAtIndex:j];
                changed = YES;
                break;
            }
        }
    }

    return merged;
}

@class PandoraTerminalScrollbarView;

@interface PandoraTerminalNativeView : NSView
@property(nonatomic, assign) ghostty_surface_t surface;
@property(nonatomic, copy, nullable) NSString *sessionID;
@property(nonatomic, strong) PandoraTerminalScrollbarView *pandoraScroller;
@property(nonatomic, assign) uint64_t pandoraScrollbarTotal;
@property(nonatomic, assign) uint64_t pandoraScrollbarOffset;
@property(nonatomic, assign) uint64_t pandoraScrollbarLength;
@property(nonatomic, assign) BOOL pandoraScrollbarTracking;
@property(nonatomic, assign) uint64_t pandoraScrollbarTrackingOffset;
@property(nonatomic, strong, nullable) NSTimer *selectionAutoscrollTimer;
@property(nonatomic, assign) double selectionAutoscrollDeltaY;
@property(nonatomic, assign) ghostty_input_mods_e selectionAutoscrollMods;
@property(nonatomic, assign) NSPoint selectionAutoscrollPoint;
/// When YES, hit testing fails so clicks/scroll reach the WKWebView (e.g. open selects/popovers).
@property(nonatomic, assign) BOOL pandoraBlocksMouseForWebOverlay;
@property(nonatomic, copy, nullable) NSArray<NSValue *> *pandoraWebOverlayOcclusionRects;
@property(nonatomic, strong, nullable) CAShapeLayer *pandoraWebOverlayMaskLayer;
@property(nonatomic, weak, nullable) NSView *pandoraForwardedMouseTarget;
- (BOOL)pandoraScrollbarIsScrollable;
- (uint64_t)pandoraScrollbarActiveOffset;
- (uint64_t)pandoraScrollbarPageRows;
- (NSRect)pandoraScrollbarThumbRectForBounds:(NSRect)bounds;
- (uint64_t)pandoraScrollbarOffsetForThumbOriginY:(CGFloat)thumbY bounds:(NSRect)bounds;
- (void)pandoraBeginScrollbarTracking;
- (void)pandoraEndScrollbarTracking;
- (void)pandoraSetScrollbarPredictedOffset:(uint64_t)offset;
@end

@interface PandoraTerminalScrollbarView : NSView
@property(nonatomic, weak, nullable) PandoraTerminalNativeView *pandoraOwner;
@property(nonatomic, assign) BOOL pandoraHovering;
@property(nonatomic, assign) BOOL pandoraDragging;
@property(nonatomic, assign) CGFloat pandoraDragThumbOffsetY;
@property(nonatomic, strong, nullable) NSTrackingArea *pandoraTrackingArea;
@end

@implementation PandoraTerminalScrollbarView

- (void)updateTrackingAreas {
    if (self.pandoraTrackingArea != nil) {
        [self removeTrackingArea:self.pandoraTrackingArea];
        self.pandoraTrackingArea = nil;
    }
    NSTrackingAreaOptions options = NSTrackingMouseEnteredAndExited | NSTrackingActiveInKeyWindow | NSTrackingInVisibleRect;
    self.pandoraTrackingArea = [[NSTrackingArea alloc] initWithRect:self.bounds
                                                            options:options
                                                              owner:self
                                                           userInfo:nil];
    [self addTrackingArea:self.pandoraTrackingArea];
    [super updateTrackingAreas];
}

- (BOOL)isOpaque {
    return NO;
}

- (void)mouseEntered:(NSEvent *)event {
    (void)event;
    self.pandoraHovering = YES;
    self.needsDisplay = YES;
}

- (void)mouseExited:(NSEvent *)event {
    (void)event;
    self.pandoraHovering = NO;
    self.needsDisplay = YES;
}

- (BOOL)pandoraUsingDarkAppearance {
    NSString *match = [self.effectiveAppearance bestMatchFromAppearancesWithNames:@[
        NSAppearanceNameAqua,
        NSAppearanceNameDarkAqua,
    ]];
    return [match isEqualToString:NSAppearanceNameDarkAqua];
}

- (void)drawRect:(NSRect)dirtyRect {
    (void)dirtyRect;
    PandoraTerminalNativeView *owner = self.pandoraOwner;
    if (owner == nil || ![owner pandoraScrollbarIsScrollable]) {
        return;
    }

    BOOL dark = [self pandoraUsingDarkAppearance];
    CGFloat centerX = NSMidX(self.bounds);
    NSRect track = NSMakeRect(
        floor(centerX - (kPandoraScrollbarThumbWidth / 2.0)),
        NSMinY(self.bounds),
        kPandoraScrollbarThumbWidth,
        NSHeight(self.bounds)
    );
    NSRect thumb = [owner pandoraScrollbarThumbRectForBounds:self.bounds];

    CGFloat trackAlpha = self.pandoraHovering || self.pandoraDragging ? 0.12 : 0.05;
    CGFloat thumbAlpha = self.pandoraDragging ? 0.78 : (self.pandoraHovering ? 0.62 : 0.44);
    NSColor *trackColor = dark
        ? [NSColor colorWithWhite:1.0 alpha:trackAlpha]
        : [NSColor colorWithWhite:0.0 alpha:trackAlpha];
    NSColor *thumbColor = dark
        ? [NSColor colorWithWhite:0.88 alpha:thumbAlpha]
        : [NSColor colorWithWhite:0.16 alpha:thumbAlpha];

    [trackColor setFill];
    NSRectFillUsingOperation(track, NSCompositingOperationSourceOver);
    [thumbColor setFill];
    NSRectFillUsingOperation(NSIntegralRect(thumb), NSCompositingOperationSourceOver);
}

- (void)mouseDown:(NSEvent *)event {
    PandoraTerminalNativeView *owner = self.pandoraOwner;
    if (owner == nil || ![owner pandoraScrollbarIsScrollable]) {
        return;
    }

    [self.pandoraOwner pandoraBeginScrollbarTracking];
    self.pandoraDragging = YES;
    self.needsDisplay = YES;

    NSPoint point = [self convertPoint:event.locationInWindow fromView:nil];
    NSRect thumb = [owner pandoraScrollbarThumbRectForBounds:self.bounds];
    if (!NSPointInRect(point, thumb)) {
        uint64_t base = [owner pandoraScrollbarActiveOffset];
        uint64_t page = [owner pandoraScrollbarPageRows];
        if (point.y > NSMaxY(thumb)) {
            [owner pandoraSetScrollbarPredictedOffset:(base > page ? base - page : 0)];
        } else {
            uint64_t maxOffset = owner.pandoraScrollbarTotal - owner.pandoraScrollbarLength;
            [owner pandoraSetScrollbarPredictedOffset:MIN(maxOffset, base + page)];
        }
        self.pandoraDragging = NO;
        self.needsDisplay = YES;
        [owner pandoraEndScrollbarTracking];
        return;
    }

    self.pandoraDragThumbOffsetY = point.y - NSMinY(thumb);
    while (true) {
        NSEvent *next = [self.window nextEventMatchingMask:NSEventMaskLeftMouseDragged | NSEventMaskLeftMouseUp];
        if (next.type == NSEventTypeLeftMouseUp) {
            break;
        }
        if (next.type != NSEventTypeLeftMouseDragged) {
            continue;
        }

        NSPoint dragPoint = [self convertPoint:next.locationInWindow fromView:nil];
        CGFloat thumbY = dragPoint.y - self.pandoraDragThumbOffsetY;
        uint64_t targetOffset = [owner pandoraScrollbarOffsetForThumbOriginY:thumbY bounds:self.bounds];
        [owner pandoraSetScrollbarPredictedOffset:targetOffset];
    }

    self.pandoraDragging = NO;
    self.needsDisplay = YES;
    [self.pandoraOwner pandoraEndScrollbarTracking];
}

@end

static NSMapTable<NSValue *, PandoraTerminalNativeView *> *PandoraSurfaceViewMap(void) {
    static NSMapTable<NSValue *, PandoraTerminalNativeView *> *map;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        map = [NSMapTable strongToWeakObjectsMapTable];
    });
    return map;
}

static void PandoraRegisterSurfaceView(ghostty_surface_t surface, PandoraTerminalNativeView *view) {
    if (surface == NULL || view == nil) {
        return;
    }
    NSMapTable<NSValue *, PandoraTerminalNativeView *> *map = PandoraSurfaceViewMap();
    @synchronized(map) {
        [map setObject:view forKey:[NSValue valueWithPointer:surface]];
    }
}

static void PandoraUnregisterSurfaceView(ghostty_surface_t surface) {
    if (surface == NULL) {
        return;
    }
    NSMapTable<NSValue *, PandoraTerminalNativeView *> *map = PandoraSurfaceViewMap();
    @synchronized(map) {
        [map removeObjectForKey:[NSValue valueWithPointer:surface]];
    }
}

static PandoraTerminalNativeView *PandoraViewForSurface(ghostty_surface_t surface) {
    if (surface == NULL) {
        return nil;
    }
    NSMapTable<NSValue *, PandoraTerminalNativeView *> *map = PandoraSurfaceViewMap();
    @synchronized(map) {
        return [map objectForKey:[NSValue valueWithPointer:surface]];
    }
}

@implementation PandoraTerminalNativeView

- (instancetype)initWithFrame:(NSRect)frameRect {
    self = [super initWithFrame:frameRect];
    if (self == nil) {
        return nil;
    }

    _pandoraScroller = [[PandoraTerminalScrollbarView alloc] initWithFrame:NSZeroRect];
    _pandoraScroller.pandoraOwner = self;
    _pandoraScroller.hidden = YES;
    [self addSubview:_pandoraScroller];
    [self pandoraLayoutScrollbar];

    return self;
}

- (void)dealloc {
    PandoraUnregisterSurfaceView(self.surface);
    [self pandoraStopSelectionAutoscroll];
}

- (void)pandoraLayoutScrollbar {
    if (self.pandoraScroller == nil) {
        return;
    }
    NSRect bounds = self.bounds;
    CGFloat x = NSMaxX(bounds) - kPandoraScrollbarWidth - kPandoraScrollbarRightInset;
    CGFloat y = NSMinY(bounds) + kPandoraScrollbarVerticalInset;
    CGFloat height = fmax(0.0, NSHeight(bounds) - (kPandoraScrollbarVerticalInset * 2.0));
    self.pandoraScroller.frame = NSMakeRect(x, y, kPandoraScrollbarWidth, height);
    self.pandoraScroller.needsDisplay = YES;
}

- (BOOL)pandoraScrollbarIsScrollable {
    return self.pandoraScrollbarTotal > self.pandoraScrollbarLength && self.pandoraScrollbarLength > 0;
}

- (uint64_t)pandoraScrollbarActiveOffset {
    return self.pandoraScrollbarTracking ? self.pandoraScrollbarTrackingOffset : self.pandoraScrollbarOffset;
}

- (uint64_t)pandoraScrollbarPageRows {
    return MAX(1, self.pandoraScrollbarLength);
}

- (NSRect)pandoraScrollbarThumbRectForBounds:(NSRect)bounds {
    if (![self pandoraScrollbarIsScrollable]) {
        return NSZeroRect;
    }

    uint64_t maxOffset = self.pandoraScrollbarTotal - self.pandoraScrollbarLength;
    uint64_t offset = MIN([self pandoraScrollbarActiveOffset], maxOffset);
    double value = maxOffset == 0 ? 1.0 : (double)offset / (double)maxOffset;
    double knob = (double)self.pandoraScrollbarLength / (double)self.pandoraScrollbarTotal;
    knob = fmin(1.0, fmax(kPandoraScrollbarMinimumKnobProportion, knob));

    CGFloat trackHeight = NSHeight(bounds);
    CGFloat thumbHeight = fmin(trackHeight, fmax(kPandoraScrollbarMinimumThumbHeight, trackHeight * knob));
    CGFloat travel = fmax(0.0, trackHeight - thumbHeight);
    CGFloat thumbY = NSMaxY(bounds) - thumbHeight - (travel * value);
    CGFloat thumbX = floor(NSMidX(bounds) - (kPandoraScrollbarThumbWidth / 2.0));
    return NSMakeRect(thumbX, thumbY, kPandoraScrollbarThumbWidth, thumbHeight);
}

- (uint64_t)pandoraScrollbarOffsetForThumbOriginY:(CGFloat)thumbY bounds:(NSRect)bounds {
    if (![self pandoraScrollbarIsScrollable]) {
        return 0;
    }

    NSRect thumb = [self pandoraScrollbarThumbRectForBounds:bounds];
    CGFloat trackHeight = NSHeight(bounds);
    CGFloat travel = fmax(0.0, trackHeight - NSHeight(thumb));
    if (travel <= 0.0) {
        return 0;
    }

    CGFloat clampedY = fmin(NSMaxY(bounds) - NSHeight(thumb), fmax(NSMinY(bounds), thumbY));
    CGFloat value = (NSMaxY(bounds) - NSHeight(thumb) - clampedY) / travel;
    value = fmin(1.0, fmax(0.0, value));
    uint64_t maxOffset = self.pandoraScrollbarTotal - self.pandoraScrollbarLength;
    return (uint64_t)llround(value * (double)maxOffset);
}

- (void)pandoraBeginScrollbarTracking {
    self.pandoraScrollbarTracking = YES;
    self.pandoraScrollbarTrackingOffset = self.pandoraScrollbarOffset;
}

- (void)pandoraEndScrollbarTracking {
    self.pandoraScrollbarTracking = NO;
    self.pandoraScrollbarTrackingOffset = self.pandoraScrollbarOffset;
}

- (void)pandoraScrollByRows:(double)rows {
    if (self.surface == NULL || fabs(rows) < 0.5) {
        return;
    }
    ghostty_surface_mouse_scroll(self.surface, 0, rows, 0);
}

- (void)pandoraSetScrollbarPredictedOffset:(uint64_t)offset {
    if (self.pandoraScrollbarTotal <= self.pandoraScrollbarLength) {
        return;
    }

    uint64_t maxOffset = self.pandoraScrollbarTotal - self.pandoraScrollbarLength;
    if (offset > maxOffset) {
        offset = maxOffset;
    }

    uint64_t base = self.pandoraScrollbarTracking ? self.pandoraScrollbarTrackingOffset : self.pandoraScrollbarOffset;
    int64_t delta = (int64_t)offset - (int64_t)base;
    if (delta == 0) {
        return;
    }

    [self pandoraScrollByRows:(double)delta];
    self.pandoraScrollbarTracking = YES;
    self.pandoraScrollbarTrackingOffset = offset;
    self.pandoraScroller.needsDisplay = YES;
}

- (void)pandoraUpdateScrollbarTotal:(uint64_t)total offset:(uint64_t)offset length:(uint64_t)length {
    self.pandoraScrollbarTotal = total;
    self.pandoraScrollbarOffset = offset;
    self.pandoraScrollbarLength = length;

    BOOL visible = total > length && length > 0;
    self.pandoraScroller.hidden = !visible;
    if (!visible) {
        self.pandoraScrollbarTracking = NO;
        return;
    }

    uint64_t maxOffset = total - length;
    if (offset > maxOffset) {
        offset = maxOffset;
        self.pandoraScrollbarOffset = offset;
    }
    [self pandoraLayoutScrollbar];
    self.pandoraScroller.needsDisplay = YES;
}

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
    uint32_t w = (uint32_t)fmax(1.0, floor(sz.width * scale));
    uint32_t h = (uint32_t)fmax(1.0, floor(sz.height * scale));
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

- (void)setFrameSize:(NSSize)newSize {
    [super setFrameSize:newSize];
    [self pandoraLayoutScrollbar];
    [self pandoraApplyWebOverlayOcclusionMask];
}

- (BOOL)pandoraPointIsInWebOverlayOcclusion:(NSPoint)point {
    for (NSValue *value in self.pandoraWebOverlayOcclusionRects) {
        if (NSPointInRect(point, value.rectValue)) {
            return YES;
        }
    }
    return NO;
}

- (nullable NSCursor *)pandoraResizeCursorForOcclusionPoint:(NSPoint)point {
    for (NSValue *value in self.pandoraWebOverlayOcclusionRects) {
        NSRect rect = value.rectValue;
        if (!NSPointInRect(point, rect)) {
            continue;
        }

        if (rect.size.height > rect.size.width * 3.0) {
            return [NSCursor resizeLeftRightCursor];
        }
        if (rect.size.width > rect.size.height * 3.0) {
            return [NSCursor resizeUpDownCursor];
        }
    }

    return nil;
}

- (nullable NSView *)pandoraHitTestViewBelowForOcclusionPoint:(NSPoint)point {
    NSView *superview = self.superview;
    if (superview == nil) {
        return nil;
    }

    NSPoint superPoint = [self convertPoint:point toView:superview];
    BOOL passedSelf = NO;
    for (NSView *candidate in superview.subviews.reverseObjectEnumerator) {
        if (candidate == self) {
            passedSelf = YES;
            continue;
        }
        if (!passedSelf) {
            continue;
        }
        if ([candidate isKindOfClass:PandoraTerminalNativeView.class]) {
            continue;
        }
        if (candidate.hidden || candidate.alphaValue <= 0.0) {
            continue;
        }

        NSPoint candidatePoint = [candidate convertPoint:superPoint fromView:superview];
        NSView *hit = [candidate hitTest:candidatePoint];
        if (hit != nil) {
            return hit;
        }
    }

    return nil;
}

- (BOOL)pandoraForwardMouseEventIfOccluded:(NSEvent *)event
                                  selector:(SEL)selector
                           beginsSequence:(BOOL)beginsSequence
                             endsSequence:(BOOL)endsSequence {
    NSPoint point = [self convertPoint:event.locationInWindow fromView:nil];
    BOOL pointOccluded = [self pandoraPointIsInWebOverlayOcclusion:point];
    NSCursor *resizeCursor = pointOccluded ? [self pandoraResizeCursorForOcclusionPoint:point] : nil;
    if (resizeCursor != nil) {
        [resizeCursor set];
    }

    NSView *target = self.pandoraForwardedMouseTarget;
    if (beginsSequence || target == nil) {
        if (!pointOccluded) {
            if (endsSequence) {
                self.pandoraForwardedMouseTarget = nil;
            }
            return NO;
        }
        target = [self pandoraHitTestViewBelowForOcclusionPoint:point];
        if (beginsSequence) {
            self.pandoraForwardedMouseTarget = target;
        }
    }

    if (target == nil || ![target respondsToSelector:selector]) {
        if (endsSequence) {
            self.pandoraForwardedMouseTarget = nil;
        }
        return pointOccluded;
    }

#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Warc-performSelector-leaks"
    [target performSelector:selector withObject:event];
#pragma clang diagnostic pop

    if (endsSequence) {
        self.pandoraForwardedMouseTarget = nil;
    }
    return YES;
}

- (void)cursorUpdate:(NSEvent *)event {
    NSPoint point = [self convertPoint:event.locationInWindow fromView:nil];
    NSCursor *resizeCursor = [self pandoraResizeCursorForOcclusionPoint:point];
    if (resizeCursor != nil) {
        [resizeCursor set];
        return;
    }
    [super cursorUpdate:event];
}

- (void)pandoraApplyWebOverlayOcclusionMask {
    if (self.layer == nil) {
        return;
    }

    if (self.pandoraWebOverlayOcclusionRects.count == 0) {
        self.layer.mask = nil;
        self.pandoraWebOverlayMaskLayer = nil;
        return;
    }

    CGFloat scale = self.window != nil ? self.window.backingScaleFactor : NSScreen.mainScreen.backingScaleFactor;
    if (scale <= 0.0 || scale != scale) {
        scale = 1.0;
    }

    CGMutablePathRef path = CGPathCreateMutable();
    CGPathAddRect(path, NULL, NSRectToCGRect(self.bounds));
    for (NSValue *value in self.pandoraWebOverlayOcclusionRects) {
        CGPathAddRect(path, NULL, NSRectToCGRect(value.rectValue));
    }
    CAShapeLayer *mask = [CAShapeLayer layer];
    mask.frame = self.bounds;
    mask.contentsScale = scale;
    mask.fillRule = kCAFillRuleEvenOdd;
    mask.path = path;
    self.layer.mask = mask;
    self.pandoraWebOverlayMaskLayer = mask;
    CGPathRelease(path);
}

- (BOOL)acceptsFirstResponder {
    if (self.pandoraBlocksMouseForWebOverlay) {
        return NO;
    }
    return YES;
}

- (NSView *)hitTest:(NSPoint)point {
    if (self.pandoraBlocksMouseForWebOverlay) {
        return nil;
    }
    if ([self pandoraPointIsInWebOverlayOcclusion:point]) {
        return nil;
    }
    return [super hitTest:point];
}

- (BOOL)acceptsFirstMouse:(NSEvent *)event {
    if (self.pandoraBlocksMouseForWebOverlay) {
        return NO;
    }
    return YES;
}

- (BOOL)canBecomeKeyView {
    if (self.pandoraBlocksMouseForWebOverlay) {
        return NO;
    }
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

- (void)pandoraStopSelectionAutoscroll {
    if (self.selectionAutoscrollTimer != nil) {
        [self.selectionAutoscrollTimer invalidate];
        self.selectionAutoscrollTimer = nil;
    }
    self.selectionAutoscrollDeltaY = 0;
}

- (double)pandoraSelectionAutoscrollDeltaForPoint:(NSPoint)point {
    if (point.y < 0) {
        return kPandoraSelectionAutoscrollStep;
    }
    if (point.y > self.bounds.size.height) {
        return -kPandoraSelectionAutoscrollStep;
    }
    return 0;
}

- (void)pandoraTickSelectionAutoscroll:(NSTimer *)timer {
    (void)timer;
    if (self.surface == NULL || self.selectionAutoscrollDeltaY == 0) {
        [self pandoraStopSelectionAutoscroll];
        return;
    }

    ghostty_surface_mouse_pos(
        self.surface,
        self.selectionAutoscrollPoint.x,
        self.selectionAutoscrollPoint.y,
        self.selectionAutoscrollMods
    );
    ghostty_surface_mouse_scroll(self.surface, 0, self.selectionAutoscrollDeltaY, 0);
}

- (void)pandoraUpdateSelectionAutoscrollForPoint:(NSPoint)point mods:(ghostty_input_mods_e)mods {
    self.selectionAutoscrollPoint = point;
    self.selectionAutoscrollMods = mods;

    double delta = [self pandoraSelectionAutoscrollDeltaForPoint:point];
    if (delta == 0) {
        [self pandoraStopSelectionAutoscroll];
        return;
    }

    self.selectionAutoscrollDeltaY = delta;
    if (self.selectionAutoscrollTimer == nil) {
        self.selectionAutoscrollTimer = [NSTimer scheduledTimerWithTimeInterval:kPandoraSelectionAutoscrollInterval
                                                                         target:self
                                                                       selector:@selector(pandoraTickSelectionAutoscroll:)
                                                                       userInfo:nil
                                                                        repeats:YES];
    }
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

    if (cmd && !ctrl && !alt) {
        if (PandoraMatchesCommandKey(event, kPandoraKeyCodeC, 'c')) {
            [self copy:nil];
            return;
        }
        if (PandoraMatchesCommandKey(event, kPandoraKeyCodeV, 'v')) {
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
    // Function keys (arrows, home, end, etc.) use AppKit private-use Unicode (0xF700–0xF8FF);
    // passing them as text bypasses Ghostty's keycode→escape-sequence translation (DECCKM, etc.).
    if (!ctrl && !cmd && text.length > 0) {
        unichar ch = [text characterAtIndex:0];
        if (ch < 0xF700 || ch > 0xF8FF) {
            key.text = text.UTF8String;
        }
    }

    ghostty_surface_key(self.surface, key);
}

- (BOOL)performKeyEquivalent:(NSEvent *)event {
    // performKeyEquivalent: is sent to ALL views in the hierarchy, not just the
    // first responder. Only handle Cmd+C/V if this view actually has focus,
    // otherwise a sibling terminal (e.g. the bottom panel) can steal the event.
    if (self.window.firstResponder != self) {
        return [super performKeyEquivalent:event];
    }
    NSUInteger f = [event modifierFlags] & NSEventModifierFlagDeviceIndependentFlagsMask;
    BOOL cmd = (f & NSEventModifierFlagCommand) != 0;
    BOOL ctrl = (f & NSEventModifierFlagControl) != 0;
    BOOL alt = (f & NSEventModifierFlagOption) != 0;
    if (cmd && !ctrl && !alt) {
        if (PandoraMatchesCommandKey(event, kPandoraKeyCodeC, 'c')) {
            [self copy:nil];
            return YES;
        }
        if (PandoraMatchesCommandKey(event, kPandoraKeyCodeV, 'v')) {
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
    if ([self pandoraForwardMouseEventIfOccluded:event selector:@selector(mouseDown:) beginsSequence:YES endsSequence:NO]) {
        return;
    }
    if (self.surface == NULL) {
        return;
    }
    [self pandoraStopSelectionAutoscroll];
    [[self window] makeFirstResponder:self];
    if (self.sessionID != nil) {
        pandora_emit_terminal_focus(self.sessionID.UTF8String);
    }
    NSPoint point = [self pandoraConvertedPoint:event];
    ghostty_surface_mouse_pos(self.surface, point.x, point.y, PandoraModsFromEvent(event));
    ghostty_surface_mouse_button(self.surface, GHOSTTY_MOUSE_PRESS, GHOSTTY_MOUSE_LEFT, PandoraModsFromEvent(event));
}

- (void)mouseUp:(NSEvent *)event {
    if ([self pandoraForwardMouseEventIfOccluded:event selector:@selector(mouseUp:) beginsSequence:NO endsSequence:YES]) {
        return;
    }
    if (self.surface == NULL) {
        return;
    }
    [self pandoraStopSelectionAutoscroll];
    NSPoint point = [self pandoraConvertedPoint:event];
    ghostty_surface_mouse_pos(self.surface, point.x, point.y, PandoraModsFromEvent(event));
    ghostty_surface_mouse_button(self.surface, GHOSTTY_MOUSE_RELEASE, GHOSTTY_MOUSE_LEFT, PandoraModsFromEvent(event));
}

- (void)rightMouseDown:(NSEvent *)event {
    if ([self pandoraForwardMouseEventIfOccluded:event selector:@selector(rightMouseDown:) beginsSequence:YES endsSequence:NO]) {
        return;
    }
    if (self.surface == NULL) {
        return;
    }
    [self pandoraStopSelectionAutoscroll];
    [[self window] makeFirstResponder:self];
    if (self.sessionID != nil) {
        pandora_emit_terminal_focus(self.sessionID.UTF8String);
    }
    NSPoint point = [self pandoraConvertedPoint:event];
    ghostty_surface_mouse_pos(self.surface, point.x, point.y, PandoraModsFromEvent(event));
    ghostty_surface_mouse_button(self.surface, GHOSTTY_MOUSE_PRESS, GHOSTTY_MOUSE_RIGHT, PandoraModsFromEvent(event));
}

- (void)rightMouseUp:(NSEvent *)event {
    if ([self pandoraForwardMouseEventIfOccluded:event selector:@selector(rightMouseUp:) beginsSequence:NO endsSequence:YES]) {
        return;
    }
    if (self.surface == NULL) {
        return;
    }
    [self pandoraStopSelectionAutoscroll];
    NSPoint point = [self pandoraConvertedPoint:event];
    ghostty_surface_mouse_pos(self.surface, point.x, point.y, PandoraModsFromEvent(event));
    ghostty_surface_mouse_button(self.surface, GHOSTTY_MOUSE_RELEASE, GHOSTTY_MOUSE_RIGHT, PandoraModsFromEvent(event));
}

- (void)mouseMoved:(NSEvent *)event {
    if ([self pandoraForwardMouseEventIfOccluded:event selector:@selector(mouseMoved:) beginsSequence:NO endsSequence:NO]) {
        return;
    }
    if (self.surface == NULL) {
        return;
    }
    NSPoint point = [self pandoraConvertedPoint:event];
    ghostty_surface_mouse_pos(self.surface, point.x, point.y, PandoraModsFromEvent(event));
}

- (void)mouseDragged:(NSEvent *)event {
    if ([self pandoraForwardMouseEventIfOccluded:event selector:@selector(mouseDragged:) beginsSequence:NO endsSequence:NO]) {
        return;
    }
    if (self.surface == NULL) {
        return;
    }
    NSPoint point = [self pandoraConvertedPoint:event];
    ghostty_surface_mouse_pos(self.surface, point.x, point.y, PandoraModsFromEvent(event));
    [self pandoraUpdateSelectionAutoscrollForPoint:point mods:PandoraModsFromEvent(event)];
}

- (void)scrollWheel:(NSEvent *)event {
    if ([self pandoraForwardMouseEventIfOccluded:event selector:@selector(scrollWheel:) beginsSequence:NO endsSequence:NO]) {
        return;
    }
    if (self.surface == NULL) {
        return;
    }
    double dx = event.scrollingDeltaX;
    double dy = event.scrollingDeltaY;
    if (event.hasPreciseScrollingDeltas) {
        dx *= 2.0;
        dy *= 2.0;
    }
    ghostty_surface_mouse_scroll(self.surface, dx, dy, PandoraScrollModsFromEvent(event));
}

@end

void *pandora_terminal_view_new(double x, double y, double width, double height) {
    NSRect frame = NSMakeRect(x, y, width, height);
    PandoraTerminalNativeView *view = [[PandoraTerminalNativeView alloc] initWithFrame:frame];
    return (__bridge_retained void *) view;
}

void pandora_terminal_view_set_surface(void *view_ptr, ghostty_surface_t surface) {
    PandoraTerminalNativeView *view = (__bridge PandoraTerminalNativeView *) view_ptr;
    if (view.surface != NULL && view.surface != surface) {
        PandoraUnregisterSurfaceView(view.surface);
    }
    view.surface = surface;
    if (surface != NULL) {
        PandoraRegisterSurfaceView(surface, view);
    } else {
        [view pandoraUpdateScrollbarTotal:0 offset:0 length:0];
    }
    [view pandoraSyncBackingToSurface];
}

void pandora_terminal_view_update_scrollbar_for_surface(
    ghostty_surface_t surface,
    uint64_t total,
    uint64_t offset,
    uint64_t length
) {
    void (^updateBlock)(void) = ^{
        PandoraTerminalNativeView *view = PandoraViewForSurface(surface);
        if (view == nil) {
            return;
        }
        [view pandoraUpdateScrollbarTotal:total offset:offset length:length];
    };

    if (NSThread.isMainThread) {
        updateBlock();
    } else {
        dispatch_async(dispatch_get_main_queue(), updateBlock);
    }
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

void pandora_terminal_view_set_blocks_mouse_for_web_overlay(void *view_ptr, bool blocks) {
    PandoraTerminalNativeView *view = (__bridge PandoraTerminalNativeView *) view_ptr;
    view.pandoraBlocksMouseForWebOverlay = blocks ? YES : NO;
    if (blocks) {
        NSWindow *window = view.window;
        if (window != nil && window.firstResponder == view) {
            (void)[window makeFirstResponder:nil];
        }
    }
}

void pandora_terminal_view_set_web_occlusion_rects(
    void *view_ptr,
    const PandoraTerminalOcclusionRect *rects,
    uintptr_t count
) {
    PandoraTerminalNativeView *view = (__bridge PandoraTerminalNativeView *) view_ptr;
    if (count == 0 || rects == NULL) {
        view.pandoraWebOverlayOcclusionRects = @[];
        [view pandoraApplyWebOverlayOcclusionMask];
        return;
    }

    NSMutableArray<NSValue *> *values = [NSMutableArray arrayWithCapacity:(NSUInteger)count];
    for (uintptr_t i = 0; i < count; i++) {
        PandoraTerminalOcclusionRect rect = rects[i];
        if (rect.width <= 0.0 || rect.height <= 0.0) {
            continue;
        }
        [values addObject:[NSValue valueWithRect:NSMakeRect(rect.x, rect.y, rect.width, rect.height)]];
    }
    view.pandoraWebOverlayOcclusionRects = PandoraMergedOcclusionRects(values);
    [view pandoraApplyWebOverlayOcclusionMask];
}
