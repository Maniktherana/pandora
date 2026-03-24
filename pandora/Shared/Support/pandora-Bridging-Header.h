//
//  pandora-Bridging-Header.h
//  pandora
//
//  Created by Manik Rana on 24/03/26.
//
//  Bridging header for libghostty C API access.
//  Exposes the ghostty C API to Swift code in the pandora target.
//

// The ghostty C API is exposed via the GhosttyKit xcframework module (libghostty).
// Swift code uses `import GhosttyKit` directly — the xcframework module map
// exports all C API symbols automatically via Swift's Clang importer.
// This bridging header is kept as a placeholder; the actual C API access
// goes through the module import in Swift files.
