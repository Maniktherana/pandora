# Pandora Working Notes

## What This Repo Is

- Native macOS app in Swift/AppKit/SwiftUI
- Background daemon in Bun/TypeScript
- Terminal rendering through libghostty
- Main workspace UI powered by SplitPane (unvendored, lives in Core)

## Current Architecture

- `pandora/Features/Workspace/`
  - workspace model, SplitPane bridge, drag/drop, keyboard navigation
- `pandora/Features/Sidebar/`
  - sidebar workspace list and sidebar interactions
- `pandora/Features/Terminal/`
  - Ghostty view, surface reuse, focus routing
- `pandora/Core/Daemon/`
  - socket client and app-side daemon integration
- `pandora/Core/SplitPane/`
  - split pane/tab engine; see CLAUDE.md inside for architecture
- `daemon/src/`
  - Bun daemon, PTY ownership, socket server, persistence

## Important Truths

- `WorkspaceStore` is the canonical workspace model.
- `PandoraWorkspaceController` translates between `WorkspaceStore` and SplitPane.
- `PandoraWorkspaceView` owns sidebar-to-workspace drag/drop.
- `SurfaceRegistry` owns terminal focus.
- `GhosttyNSView` is the terminal boundary; app-owned shortcuts may need to be intercepted here.

## Current UX Rules

- Sidebar row = workspace
- Selected sidebar row = visible workspace
- Center drop on a pane = add tab(s) to that pane
- Edge drop on a pane = split that pane
- Only one terminal should truly be focused
- `Cmd+[ ]` belongs to Pandora navigation, not Ghostty

## Commands

- Build app:
```bash
mkdir -p /tmp/pandora-derived /tmp/pandora-clang-cache /tmp/pandora-swiftpm-cache /tmp/pandora-spm-clones /tmp/pandora-home/Library/Caches/org.swift.swiftpm/manifests && DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer HOME=/tmp/pandora-home CLANG_MODULE_CACHE_PATH=/tmp/pandora-clang-cache SWIFTPM_MODULECACHE_OVERRIDE=/tmp/pandora-swiftpm-cache xcodebuild -project /Users/manik/code/pandora/pandora.xcodeproj -scheme pandora -derivedDataPath /tmp/pandora-derived -clonedSourcePackagesDirPath /tmp/pandora-spm-clones CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY='' -quiet build
```

- Run daemon locally:
```bash
cd /Users/manik/code/pandora/daemon
PANDORA_HOME=/tmp/pandora-dev-home bun run src/index.ts /tmp/pandora-dev-smoke
```

- Daemon verification:
```bash
bun test
bun run smoke:pty
```

## Do Not Regress

- No user-facing connected/disconnected daemon framing
- No duplicate workspace state machines
- No terminal recreation on tab/pane switch
- No focus bugs where an unfocused pane still appears active
