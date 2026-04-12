#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>

/// Finder-like clipboard: file URL(s) for drag/drop + Dock/Finder, and UTF-8 plain text
/// (absolute POSIX paths, newline-separated) so terminals and agent UIs that only read
/// `NSPasteboardTypeString` still receive full paths—not bare filenames.
void pandora_set_pasteboard_files(const char *const *paths, size_t count) {
    @autoreleasepool {
        if (paths == NULL || count == 0) {
            return;
        }

        NSPasteboard *pb = [NSPasteboard generalPasteboard];
        [pb clearContents];

        NSMutableArray<NSURL *> *urls = [NSMutableArray arrayWithCapacity:count];
        NSMutableString *text = [NSMutableString string];

        for (size_t i = 0; i < count; i++) {
            const char *c = paths[i];
            if (c == NULL) {
                continue;
            }
            NSString *path = [NSString stringWithUTF8String:c];
            if (path.length == 0) {
                continue;
            }

            NSURL *url = [NSURL fileURLWithPath:path];
            if (url != nil) {
                [urls addObject:url];
            }
            if (text.length > 0) {
                [text appendString:@"\n"];
            }
            [text appendString:path];
        }

        if (urls.count > 0) {
            [pb writeObjects:urls];
        }
        if (text.length > 0) {
            [pb setString:text forType:NSPasteboardTypeString];
        }
    }
}
