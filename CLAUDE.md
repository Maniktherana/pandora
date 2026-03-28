# Pandora Working Notes

Repo-wide guidance for the Pandora app and daemon. When working inside
`pandora/Core/SplitPane/`, read and follow the more specific
`pandora/Core/SplitPane/CLAUDE.md` as the source of truth for that subsystem.

## What This Repo Is

- Native macOS app in Swift, AppKit, and SwiftUI
- Background daemon in Bun and TypeScript
- Terminal rendering through Ghostty
- Main workspace UI powered by the in-repo SplitPane engine under `pandora/Core/SplitPane/`

## Architecture Map

- `pandora/Features/Workspace/`
  - Workspace model, SplitPane bridge, drag/drop, keyboard navigation
- `pandora/Features/Sidebar/`
  - Sidebar workspace list and sidebar interactions
- `pandora/Features/Terminal/`
  - `GhosttyNSView`, surface reuse, focus routing
- `pandora/Core/Daemon/`
  - Socket client and app-side daemon integration
- `pandora/Core/SplitPane/`
  - Split pane/tab engine; see the local `CLAUDE.md`
- `daemon/src/`
  - Bun daemon, PTY ownership, socket server, persistence, tests

## Important Truths

- `WorkspaceStore` is the canonical workspace model.
- `PandoraWorkspaceController` translates between `WorkspaceStore` and SplitPane.
- `PandoraWorkspaceView` owns sidebar-to-workspace drag/drop.
- `SurfaceRegistry` owns terminal reuse and focus coordination.
- `GhosttyNSView` is the terminal boundary; app-owned shortcuts may need to be intercepted here.

## UX Rules

- Sidebar row = workspace
- Selected sidebar row = visible workspace
- Center drop on a pane = add tab(s) to that pane
- Edge drop on a pane = split that pane
- Only one terminal should truly be focused
- `Cmd+[ ]` belongs to Pandora navigation, not Ghostty

## Good Starting Points

- `pandora/Features/Workspace/ContentView.swift`
  - Top-level workspace composition and keyboard routing
- `pandora/Features/Workspace/WorkspaceStore.swift`
  - Canonical workspace state and mutations
- `pandora/Features/Workspace/PandoraWorkspaceController.swift`
  - Mapping layer between workspace state and SplitPane
- `pandora/Features/Terminal/SurfaceRegistry.swift`
  - Terminal surface reuse and focus coordination
- `pandora/Core/Daemon/DaemonClient.swift`
  - App-side daemon transport
- `daemon/src/index.ts`
  - Daemon entry point

## Commands

Run these from the repository root unless noted otherwise.

- Inspect Xcode targets and schemes:
```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -list -project pandora.xcodeproj
```

- Build the app:
```bash
mkdir -p /tmp/pandora-derived /tmp/pandora-clang-cache /tmp/pandora-swiftpm-cache /tmp/pandora-spm-clones /tmp/pandora-home/Library/Caches/org.swift.swiftpm/manifests
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
HOME=/tmp/pandora-home \
CLANG_MODULE_CACHE_PATH=/tmp/pandora-clang-cache \
SWIFTPM_MODULECACHE_OVERRIDE=/tmp/pandora-swiftpm-cache \
xcodebuild \
  -project "$(pwd)/pandora.xcodeproj" \
  -scheme pandora \
  -derivedDataPath /tmp/pandora-derived \
  -clonedSourcePackagesDirPath /tmp/pandora-spm-clones \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY='' \
  -quiet build
```

- Run the daemon locally:
```bash
cd daemon
PANDORA_HOME=/tmp/pandora-dev-home bun run src/index.ts /tmp/pandora-dev-smoke
```

- Verify the daemon:
```bash
cd daemon
bun test
bun run smoke:pty
```

## Do Not Regress

- No user-facing connected/disconnected daemon framing
- No duplicate workspace state machines
- No terminal recreation on tab or pane switch
- No focus bugs where an unfocused pane still appears active
