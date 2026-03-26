# SplitPane

Split pane engine: recursive pane/tab layout with drag-drop, animated splits, and keyboard focus navigation. Used by the main workspace to render terminal surfaces in a tiled layout.

## Entry points

- **`SplitPaneView`** — SwiftUI view. Takes a `SplitPaneController`, a content builder `(Tab, PaneID) -> Content`, and an empty-pane builder.
- **`SplitPaneController`** — The public API. Caller creates this, holds it, and uses it to open/close/split panes programmatically. Wraps `SplitViewController`.
- **`SplitPaneDelegate`** — Optional protocol for veto (shouldCreate/shouldClose/shouldSplit) and notification (didCreate/didClose/didSelect/didMove) callbacks.
- **`SplitPaneConfig`** — Behavior flags (`allowSplits`, `allowCloseTabs`, `contentViewLifecycle`, `newTabPosition`) and appearance styling. Pass to `SplitPaneController` init. Has presets: `.default`, `.singlePane`, `.readOnly`, `.compact`, `.spacious`.

## Architecture

```
SplitPaneView
  └── SplitTreeView             renders the recursive split tree
        └── SplitNodeView       dispatches on SplitNode type
              ├── SplitContainerView   (NSViewRepresentable → NSSplitView) for splits
              └── PaneContainerView    for leaf panes
                    ├── TabBarView     tab strip + drag source
                    │     └── TabItemView  individual tab
                    └── content area   caller-provided view
```

**Model tree:** `SplitNode` is a recursive enum (`case pane(PaneState)` / `case split(SplitState)`). The tree lives in `SplitViewController` as `rootNode`. All mutations go through `SplitViewController` then surface to `SplitPaneController`.

## Key files

| File | What it does |
|------|-------------|
| `Engine/SplitViewController.swift` | Central state machine. Owns `rootNode`, `focusedPaneId`, drag state. All split/tab/focus mutations. |
| `Engine/SplitAnimator.swift` | CVDisplayLink-based 120fps divider animations. Singleton. |
| `Models/SplitNode.swift` | Recursive tree enum. `findPane`, `allPaneIds`, `computePaneBounds`. |
| `Models/PaneState.swift` | `@Observable` per-pane state: tabs array, selectedTabId. |
| `Models/SplitState.swift` | `@Observable` split node: orientation, two children, divider position (0–1). |
| `Models/TabItem.swift` | Internal tab struct. Also defines `TabTransferData` for cross-pane drag payloads (Codable + Transferable). |
| `Views/PaneContainerView.swift` | Drop zone logic. `UnifiedPaneDropDelegate` handles center (tab move) vs edge (split) drops. Guards on `WorkspaceDragBridge.isContentTabDrag` — workspace row drags are rejected. |
| `Views/TabBarView.swift` | Tab strip. Calls `WorkspaceDragBridge.shared.beginTabDragging()` on drag start so other drop zones can scope correctly. `TabDropDelegate` handles same-pane reorder. |
| `Views/SplitContainerView.swift` | NSSplitView bridge. Manages animation on split creation (pane enters from edge). Coordinator distinguishes user drags from programmatic updates. |

## Drag-drop scoping

Two drag kinds exist in the app, distinguished via `WorkspaceDragBridge.dragKind`:

- **`.contentTab`** — a SplitPane tab being dragged. Set by `TabBarView.createItemProvider`. Accepted by: pane drop zones (move/split), sidebar shell (detach to sidebar).
- **`.workspaceRow`** — a sidebar workspace row being reordered. Set by `WorkspaceSidebarRowView.onDrag`. Accepted by: sidebar kanban reorder slots, main workspace surface (merge).

`validateDrop` in both `UnifiedPaneDropDelegate` and `TabDropDelegate` checks `isContentTabDrag` — workspace row drags never activate pane drop zones.

## Drop zones (PaneContainerView)

When a content tab is dragged over a pane:
- **Center** (inner 50% of pane) → move tab to this pane
- **Left/Right edge** (outer 25%, min 80px) → split horizontally
- **Top/Bottom edge** (outer 25%, min 80px) → split vertically

Visual placeholder animates to show target zone.

## contentViewLifecycle

Configured via `SplitPaneConfig`:
- `.recreateOnSwitch` — only the selected tab's view is in the hierarchy
- `.keepAllAlive` — all tab views stay alive, non-selected are `opacity(0)` + `allowsHitTesting(false)`

Pandora uses `.keepAllAlive` to avoid terminal recreation on tab switch.
