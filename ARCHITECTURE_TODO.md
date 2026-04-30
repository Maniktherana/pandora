# Pandora Architecture TODO

This file is the working spec for making Pandora fast, simple, and navigable again.

The core product is simple:

```text
workspace list -> selected workspace -> pane layout -> active tab body
```

The current code still has too much runtime-era compatibility:

```text
desktopStateSnapshot -> WorkspaceRuntimeState -> runtime event bus -> copied stores -> UI
```

That is not the target architecture. Do not mark a task complete because a new store exists. A task is complete only when the old source of truth is gone from the relevant flow.

## Do Not Keep Compatibility For Typecheck

This migration is allowed to break old frontend call sites while the prompt that owns those call sites is in progress.

Typecheck failures caused by old frontend references are not permission to reintroduce backend compatibility. They are the work queue for Prompts 3-8.

Deleted backend concepts are deleted. Do not recreate them, rename them, wrap them, or preserve them as compatibility shims:

```text
Runtime as backend lifecycle/bag concept
RuntimeRegistry
RuntimeCommand
RuntimeEventEnvelope
runtime_send
start_workspace_runtime
start_project_runtime
stop_project_runtime
runtime-connection
fake connected/connecting/disconnected lifecycle state
```

If frontend code still references any deleted backend lifecycle command or event, fix the frontend by deleting/replacing that call in the prompt that owns it. Do not restore Rust shims. Do not add a frontend shim that pretends the deleted backend lifecycle still exists.

Real concepts that stay:

```text
workspace ids as scope ids for workspace-local services
project:${projectId} as terminal scope only
TerminalRegistry
FileTreeRegistry
ScmRegistry
EditorIoRegistry
domain service lazy-open on demand
domain event streams / scope events for real domain updates
```

`project:${projectId}` is not a project runtime. It is a terminal scope. It survives workspace switches because bottom-panel terminals are project-scoped, not because there is a hidden runtime lifecycle.

Do not preserve compatibility to make old tests pass. Update or delete tests that assert deleted runtime behavior. Passing typecheck by keeping fake runtime concepts is a failed migration.

## Naming Is Architecture

Names must describe what the code actually does. Do not keep old names because renaming imports is annoying.

Frontend naming rules:

```text
runtime/ is not a frontend domain
runtime-client is not an acceptable frontend name
runtime-gateway is not an acceptable frontend name
runtime-event-handler is not an acceptable frontend name
runtime-event-queue is not an acceptable frontend name
connection-store is not acceptable if it models deleted runtime lifecycle state
scm/ is not an acceptable frontend domain name
```

Use these names instead:

```text
ipc/              // frontend transport boundary to Tauri scope IPC
ipc-client        // sends typed scope commands
ipc-gateway       // owns listen/unlisten wiring for scope events
ipc-event-router  // delegates incoming events to domain event handlers
git/              // user-facing Git domain, not "SCM"
git-store
git-summary-store
git-service
git-events
git-api
git-utils
git-types
```

The frontend may translate backend protocol names at the IPC boundary, but those protocol names must not leak into components or domain services as the domain language. If a backend event is still named `scm_snapshot`, convert it in `services/ipc/` or the Git event adapter. Do not name the frontend domain `scm` just because an old backend event did.

## Current Prompt Status Log — 2026-04-29

This is the current verified state after the Prompt 9 backend cleanup. Frontend prompts are not accepted unless their greps and `./node_modules/.bin/tsc --noEmit -p apps/desktop` are clean.

| Prompt | Status | Current state |
| --- | --- | --- |
| Prompt 1 — Workspace rendering CPU fix | Partial | `mountedWorkspaceIds` and hidden inactive tab body patterns are gone, but frontend typecheck is still broken by unfinished Prompt 4/6 migrations. |
| Prompt 2 — NavigationStore source of truth | Partial | `NavigationStore` exists and selection is moving there, but old runtime/snapshot compatibility still exists in workspace services. |
| Prompt 3 — Remove selection startup coupling | Partial | `startSelectionSettle`, `maybeStartSelectedWorkspace`, and the old named waiter grep clean, but `workspace-startup.ts` and `desktop-workspace-service.ts` still contain runtime connection/startup coupling that must be deleted in frontend follow-up work. |
| Prompt 4 — LayoutStore source of truth | Not done | `LayoutStore` exists and the workspace shell uses it in places, but `WorkspaceRuntimeState`, `runtime.root`, `runtime.focusedPaneID`, and old runtime layout helpers still remain in production workspace services. |
| Prompt 5 — TerminalScopeStore source of truth | Not done | `TerminalScopeStore` exists, but bottom panel, terminal startup, project terminal panel, and agent status paths still read old runtime state. |
| Prompt 6 — Domain IPC event handling | Partial | A domain event handler exists, but old runtime-named IPC compatibility files still exist and `terminal-events.ts` currently imports missing agent activity helpers. |
| Prompt 7 — Sidebar summary stores | Not done | Workspace rows still read `useRuntimeState` / `WorkspaceRuntimeState` for agent status. |
| Prompt 8 — Delete frontend runtime compatibility | Not done | `desktopStateSnapshot`, `WorkspaceRuntimeState`, `useRuntimeStore`, `workspace-runtime-model`, `workspace-startup`, `readSessionRuntimeState`, `writeSessionRuntimeState`, and publish scheduling still remain. |
| Prompt 9 — Rust domain registry refactor | Done | Backend runtime bag and lifecycle startup shims are gone. Rust commands now lazily open the specific domain service needed through domain registries. `cargo check` passes. |
| Prompt 10 — Frontend IPC/Git naming cleanup | Not done | Frontend still has `services/runtime/*` and `services/scm/*`. These are misleading names and must be replaced with `services/ipc/*` and `services/git/*`. |

Frontend typecheck fallout currently expected from unfinished frontend prompts:

```text
workspace-api.ts still references deleted backend lifecycle commands
workspace-startup.ts still references deleted backend lifecycle commands/events
runtime-client.ts still listens for deleted runtime-connection and must become IPC transport code
terminal font preview still references deleted lifecycle behavior
project-terminal-panel-model.test.ts imports removed cycleRuntimeTabs
terminal-events.ts imports missing agent activity helpers
desktop-workspace-service.ts imports old runtime layout helper names
desktop-workspace-service.ts still passes runtime-blob mutation callbacks to layout helpers
desktop-workspace-service.ts references workspaceSelectionError
```

These failures mean the frontend prompts are unfinished. They do not justify restoring `start_workspace_runtime`, `start_project_runtime`, `stop_project_runtime`, `runtime-connection`, `RuntimeEventEnvelope`, `RuntimeCommand`, or `runtime_send`.

## Non-Negotiable Rules

- No `void someAsyncCall()` fire-and-forget calls.
- No useless comments that restate code.
- No compatibility layers unless the task explicitly says they are temporary and the acceptance criteria removes them in the same prompt.
- No new god files, "manager" files, generic coordinators, or catch-all service modules.
- No renderer-side Effect.
- No new DI framework.
- No behavior removals.
- No broad "just mirror old state into new store" migrations.
- No hidden expensive tab bodies.
- No hidden mounted workspaces.
- No workspace navigation that waits for backend startup.
- No direct React component imports from old runtime stores once the matching domain store exists.
- Keep imports explicit and local to the domain.
- Prefer small domain services and stores over one central orchestrator.
- Prefer event-driven waiting over sleep/poll loops.
- Every async action must either be awaited, returned to the caller, or handled through a named helper that logs/reports errors.

Acceptable async patterns:

```ts
async function handleClick() {
  await workspaceService.selectWorkspace(workspaceId);
}
```

```tsx
onClick={() => {
  handleClick().catch(reportUiActionError);
}}
```

```ts
function startBackgroundTask(task: Promise<unknown>, label: string) {
  task.catch((error) => reportBackgroundError(label, error));
}
```

Not acceptable:

```ts
void workspaceService.selectWorkspace(workspaceId);
```

```ts
someAsyncCall();
```

```ts
// Updates the workspace.
workspaceService.updateWorkspace(...)
```

## Target Frontend Structure

```text
apps/desktop/src/services/workspace/
  catalog-store.ts
  navigation-store.ts
  layout-store.ts
  workspace-api.ts
  workspace-service.ts
  workspace-session-service.ts
  workspace-crud-service.ts

apps/desktop/src/services/terminal/
  terminal-scope-store.ts
  terminal-command-service.ts
  terminal-startup-service.ts
  terminal-surface-service.ts
  terminal-events.ts
  project-terminal-panel-model.ts

apps/desktop/src/services/ipc/
  ipc-client.ts
  ipc-gateway.ts
  ipc-event-router.ts
  ipc-event-queue.ts        // only if real batching/backpressure is needed

apps/desktop/src/services/file-tree/
  file-tree-store.ts
  file-tree-service.ts
  file-tree-events.ts
  file-tree-preferences.ts

apps/desktop/src/services/git/
  git-store.ts
  git-summary-store.ts
  git-service.ts
  git-events.ts
  git-api.ts
  git-utils.ts
  git-types.ts

apps/desktop/src/services/editor/
  editor-store.ts
  editor-service.ts
  editor-events.ts
```

This structure is a direction, not a license to create wrappers. If a module has no real responsibility, do not create it.

## Target Frontend State Model

Frontend concepts:

```ts
type WorkspaceId = string;
type ProjectId = string;
type TerminalScopeId = WorkspaceId | `project:${ProjectId}`;
```

Workspace state is not terminal state.

```text
CatalogStore
  projects, workspaces, status, PR metadata

NavigationStore
  selected workspace/project, navigation area, search text, layout target

LayoutStore
  pane tree, focused pane, tab metadata per workspace

TerminalScopeStore
  slots, sessions, ports, agent status, project terminal panel per terminal scope

GitSummaryStore
  row-safe git summary per workspace

GitStore
  full Git panel snapshot per workspace

FileTreeStore
  directories and expanded paths per workspace

EditorStore
  buffers, dirty state, file change invalidation
```

## Terminal Scope Semantics

Workspace terminal scope:

```text
scope id = workspaceId
belongs to one workspace
UI unmounts when the workspace is no longer selected
native surfaces are removed when no visible terminal anchor exists
backend process state can live until explicit close/archive/app quit
```

Project terminal scope:

```text
scope id = project:${projectId}
owns the bottom panel terminals
survives switching between workspaces in the same project
closes only when project is removed/app quits/explicit close
```

Do not reintroduce scattered project-runtime conditionals. Use terminal scope semantics at the service boundary.

## Desired Lifecycles

### App Boot

```text
load app catalog
hydrate catalog store
hydrate navigation store
render shell immediately
start IPC event listener
background-start selected workspace services if needed
```

### Workspace Click

```text
set NavigationStore.selectedWorkspaceID immediately
set selectedProjectID immediately
save selection async with error handling
mark workspace opened async with error handling
render cached/empty layout immediately
start any required backend work in background with error handling
```

Workspace click must not await:

```text
start workspace runtime
project runtime startup
file tree init
Git init
terminal startup refresh
layout persistence
review work
```

### Workspace Screen

```text
read selected workspace from NavigationStore/CatalogStore
read layout from LayoutStore
if layout missing, show empty shell and start layout load
render pane tree from metadata
mount only active expensive tab body
```

### Active Tab Bodies

```text
editor tab -> editor service reads file
diff tab -> cold diff query only while mounted
review tab -> review queries only while mounted
terminal tab -> attach terminal scope and visible surface
```

Inactive diff/review/editor bodies must not run effects.

## Current Known False Positives

These are not done until acceptance criteria below pass:

- `NavigationStore` exists, but `desktopStateSnapshot` still drives most flows.
- `TerminalScopeStore` exists, but `WorkspaceRuntimeState` is still mutated and mirrored.
- `LayoutStore` exists, but workspace view still gates on connection/layout readiness.
- `runtime-event-router.ts` was deleted, but `runtime-event-handler.ts` still centralizes a global `RuntimeQueueEvent` pipeline.
- `workspace-selection-service.ts` still calls `startSelectionSettle`.

## Phase 1: Stop Visible Lag

### Task 1.1: Active Workspace Only

Goal: render exactly one selected workspace.

Acceptance:

```bash
rg "mountedWorkspaceIds|workspaceIdsToRender|mountedReadyWorkspaceIds" apps/desktop/src/components/layout/workspace/workspace-view.tsx
```

returns no results.

`WorkspaceView` renders one `WorkspaceRuntimePane` or its replacement for the selected workspace only.

Do:

- Keep cached workspace state in stores.
- Unmount workspace DOM when it is not selected.

Do not:

- Hide old workspaces with `display: none`.
- Preserve old workspace trees in React just to keep state.

### Task 1.2: Active Expensive Tab Body Only

Goal: inactive review/diff/editor bodies do no work.

Acceptance:

```bash
rg "ReviewViewer|DiffViewer" apps/desktop/src/components/layout/workspace/workspace-view.tsx
```

Manual source check must show `ReviewViewer` and `DiffViewer` are only rendered for the active tab.

```bash
rg "display: isActiveTab|visibility: isActiveTab|aria-hidden=\\{!isActiveTab\\}" apps/desktop/src/components/layout/workspace/workspace-view.tsx
```

returns no results for review/diff wrappers.

Do:

- Return `null` for inactive expensive tabs.
- Keep terminal surface behavior deliberate and visible-only.

Do not:

- Keep hidden review/diff DOM around.
- Add `isActive` props as a substitute for unmounting unless the component is cheap and proven safe.

## Phase 2: Navigation Becomes Source Of Truth

### Task 2.1: NavigationStore Owns Selection

Goal: selected workspace/project comes from `NavigationStore`, not `desktopStateSnapshot`.

Acceptance:

```bash
rg "selectedWorkspaceID|selectedProjectID|navigationArea|layoutTargetRuntimeId|searchText" apps/desktop/src/services/workspace/desktop-view-service.ts apps/desktop/src/services/workspace/workspace-selection-service.ts apps/desktop/src/services/workspace/desktop-workspace-service.ts
```

No matches that mutate or source selection from `desktopStateSnapshot`.

Allowed temporary matches only in type declarations or deletion shims must be removed by the end of this task.

Do:

- Make `useDesktopView` derive from `CatalogStore` and `NavigationStore`, or replace call sites with domain hooks.
- Keep API stable only where needed for components, not by preserving the singleton.
- Save selection asynchronously with explicit error handling.

Do not:

- Mirror `desktopStateSnapshot` into `NavigationStore`.
- Keep `publishDesktopNow` as part of selection.

### Task 2.2: Workspace Click Is Cheap

Goal: selecting a workspace updates UI state immediately and starts background work separately.

Acceptance:

```bash
rg "startSelectionSettle|maybeStartSelectedWorkspace|waitForWorkspaceConnection" apps/desktop/src/services/workspace
```

returns no results, or only references inside a file being deleted in the same change.

`desktopWorkspaceService.selectWorkspace` must not `await` runtime startup, file tree init, Git init, terminal refresh, or layout load.

Do:

- Split `selectWorkspace` and `ensureWorkspaceActiveServices`.
- Call background startup through a named helper that reports errors.
- Make workspace shell render from cached/empty layout.

Do not:

- Keep the old `startSelectionSettle` chain.
- Wait for connection before updating selected workspace.

## Phase 3: LayoutStore Is The Layout Source Of Truth

### Task 3.1: Move Layout Mutations Off WorkspaceRuntimeState

Goal: pane tree, focused pane, and tabs mutate `LayoutStore` directly.

Acceptance:

```bash
rg "open.*InWorkspaceRuntime|cycleRuntimeTabs|setFocusedPaneInWorkspaceRuntime|WorkspaceRuntimeState" apps/desktop/src/services/workspace apps/desktop/src/hooks/use-layout-actions.ts apps/desktop/src/components/layout/workspace
```

No production code should require `WorkspaceRuntimeState` for layout or tab mutations.

Do:

- Convert layout model functions to operate on a layout snapshot/state type.
- Persist layout from `LayoutStore` with debounced save.
- Keep project terminal panel separate from workspace layout.

Do not:

- Build a fake `WorkspaceRuntimeState` adapter for layout changes.
- Persist layout from runtime blob.

### Task 3.2: Workspace Shell Does Not Gate On Runtime Connection

Goal: navigation is instant even if backend services are still starting.

Acceptance:

```bash
rg "connectionState !== \"connected\"|byRuntimeId\\[selectedWorkspaceID\\]|WorkspaceRuntimeLoading" apps/desktop/src/components/layout/workspace/workspace-view.tsx
```

No workspace-level render gate may block the shell on connection.

Do:

- Show loading indicators only inside tab bodies or narrow panels that are actually waiting.
- Render empty/cached layout shell immediately.

Do not:

- Block the whole workspace view on terminal connection.
- Block the whole workspace view on Git/file tree state.

## Phase 4: TerminalScopeStore Is The Terminal Source Of Truth

### Task 4.1: Terminal State Leaves WorkspaceRuntimeState

Goal: slots, sessions, ports, agent status, and project terminal panel live in `TerminalScopeStore`.

Acceptance:

```bash
rg "runtime\\.slots|runtime\\.sessions|runtime\\.detectedPorts|terminalAgentStatusBySlotId|terminalDisplayBySlotId" apps/desktop/src/services apps/desktop/src/components apps/desktop/src/hooks apps/desktop/src/lib
```

No production code should access these through `WorkspaceRuntimeState`.

Do:

- Use `TerminalScopeId` for workspace and project scopes.
- Keep project panel state under `project:${projectId}`.
- Make terminal startup consume `TerminalScopeStore`, `LayoutStore`, `NavigationStore`, and `CatalogStore`.

Do not:

- Read terminals through `desktopStateSnapshot.runtimes`.
- Fake a runtime adapter to call old terminal helpers.

### Task 4.2: Terminal Startup Uses Scopes

Goal: terminal lazy-open behavior survives without runtime blob.

Acceptance:

```bash
rg "getRuntimes|WorkspaceRuntimeState|connectionState" apps/desktop/src/services/terminal/terminal-startup-service.ts
```

returns no results.

Do:

- Check active workspace and active project through `NavigationStore`.
- Check layout terminal visibility through `LayoutStore`.
- Check slot/session state through `TerminalScopeStore`.
- Wait for terminal connection through `ConnectionStore` or a named event waiter.

Do not:

- Poll with `setTimeout` loops.
- Start project-scope terminals when only a workspace scope is needed.

## Phase 5: Domain Event Handling

### Task 5.1: Runtime Event Handler Delegates By Domain

Goal: central runtime handler routes only; domain reducers live in domain files.

Acceptance:

```bash
rg "WorkspaceRuntimeState|buildRuntimeAdapter|emptyTerminalScope|updateRuntimeSession|sanitizeWorkspaceTerminalLayout|rebuildTerminalAgentStatuses" apps/desktop/src/services/runtime/runtime-event-handler.ts
```

returns no results.

Do:

- Create `terminal-events.ts`.
- Keep file tree reducers in `file-tree-events.ts`.
- Keep SCM reducers in `scm-events.ts`.
- Keep editor reducers in `editor-events.ts`.
- Keep PR URL detection in a specific PR/terminal integration module, not generic runtime handling.

Do not:

- Move the old central reducer into a new file and call it done.
- Keep layout mutation hidden in runtime event handler except via explicit domain function calls.

### Task 5.2: Event Application Updates Narrow Stores

Goal: one event updates the smallest necessary store.

Acceptance:

Terminal events update only:

```text
TerminalScopeStore
ConnectionStore
LayoutStore when slot removals require tab cleanup
specific PR integration when output contains awaited PR URL
```

SCM events update only SCM stores.

File tree events update only FileTreeStore.

Editor events update only EditorStore.

Do:

- Keep event handlers pure-ish and small.
- Use selectors in components so updates do not rerender unrelated UI.

Do not:

- Republish all runtime state on every terminal event.
- Call terminal startup refresh twice for the same event from multiple subscribers.

## Phase 6: Sidebar Reads Narrow Summaries

### Task 6.1: Workspace Row Uses Narrow Stores

Goal: rows do not read full runtime or full SCM panel state.

Acceptance:

```bash
rg "useRuntimeState|useRuntimeStore|WorkspaceRuntimeState" apps/desktop/src/components/layout/left-sidebar
```

returns no results.

```bash
rg "snapshot\\.staged|snapshot\\.unstaged|lineStats" apps/desktop/src/components/layout/left-sidebar
```

returns no results after `ScmSummaryStore` exists.

Do:

- Add `ScmSummaryStore` for row counts and branch summary.
- Keep full SCM snapshots for the SCM panel.
- Add terminal agent summary selector in `TerminalScopeStore` if needed.

Do not:

- Make every row subscribe to full staged/unstaged arrays.
- Compute row counts by scanning full SCM snapshots in render.

## Phase 7: Delete Compatibility Layers

### Task 7.1: Remove WorkspaceRuntimeState From Production Code

Goal: the old blob is gone from the app runtime.

Acceptance:

```bash
rg "WorkspaceRuntimeState" apps/desktop/src --glob '!**/*.test.ts' --glob '!**/*.test.tsx'
```

returns no production matches.

Delete or rewrite:

```text
apps/desktop/src/services/runtime/runtime-store.ts
apps/desktop/src/services/workspace/workspace-runtime-model.ts
apps/desktop/src/services/workspace/workspace-startup.ts
apps/desktop/src/services/workspace/workspace-selection-service.ts
```

Do:

- Keep tests only if rewritten around new domain stores.
- Delete adapter builders once final call sites move.

Do not:

- Keep runtime-store as a hidden compatibility bridge.
- Keep a `createWorkspaceRuntimeState` helper in production code.

### Task 7.2: Remove Desktop Singleton

Goal: `desktopStateSnapshot` no longer exists.

Acceptance:

```bash
rg "desktopStateSnapshot|publishDesktopNow|scheduleDesktopPublish|scheduleRuntimePublish|readSessionRuntimeState|writeSessionRuntimeState" apps/desktop/src
```

returns no results.

Do:

- Replace catalog mutations with `CatalogStore`.
- Replace navigation mutations with `NavigationStore`.
- Replace PR awaiting state with a small specific store.

Do not:

- Rename the singleton and keep the same pattern.
- Keep microtask publish scheduling for app state.

## Phase 8: Rust Domain Registry Refactor — Done

Prompt 9 completed this backend phase. Do not schedule a new worker to recreate backend lifecycle compatibility.

### Task 8.1: Split RuntimeRegistry Internals

Goal: Rust no longer bundles terminal, file tree, SCM, and editor IO behind one `Runtime`.

Target:

```text
TerminalRegistry
FileTreeRegistry
ScmRegistry
EditorIoRegistry
```

Acceptance:

```bash
rg "pub struct Runtime|RuntimeRegistry|RuntimeEventEnvelope|runtime_send|RuntimeCommand" apps/desktop/src-tauri/src
```

returns no production matches after migration.

Do:

- Make each command look up only the domain service it needs.
- Preserve project terminal scope semantics.

Do not:

- Keep existing lifecycle command names to reduce frontend churn.
- Change frontend behavior in the same prompt unless explicitly assigned.
- Start all services just because terminal scope starts.
- Recreate `Runtime`, `RuntimeRegistry`, `RuntimeCommand`, `RuntimeEventEnvelope`, `runtime_send`, `start_workspace_runtime`, `start_project_runtime`, `stop_project_runtime`, or `runtime-connection`.

## Global Acceptance Checks

Run from repo root:

```bash
bunx tsc --noEmit -p apps/desktop
bun test apps/desktop/src
```

Run greps:

```bash
rg "\\bvoid\\s+[a-zA-Z0-9_.$]+\\(" apps/desktop/src
```

Must return no results in touched production files. New code must not add any.

```bash
rg "mountedWorkspaceIds|workspaceIdsToRender|mountedReadyWorkspaceIds" apps/desktop/src
```

Must return no results.

```bash
rg "display: isActiveTab|visibility: isActiveTab" apps/desktop/src/components/layout/workspace
```

Must return no results for expensive tab bodies.

```bash
rg "desktopStateSnapshot|WorkspaceRuntimeState|useRuntimeStore|runtime-store|workspace-runtime-model|workspace-selection-service|workspace-startup" apps/desktop/src --glob '!**/*.test.ts' --glob '!**/*.test.tsx'
```

Expected final state: no production results.

Interim prompts may leave results only when explicitly listed in their final report.

```bash
rg "for \\(let i = 0; i <|setTimeout\\(.*100|waitForRuntimeConnected" apps/desktop/src/services
```

No manual connection polling loops.

## Subagent Prompts

Copy one prompt at a time. Each prompt has a strict write scope. Do not assign overlapping write scopes to parallel agents.

---

# Prompt 1 — Workspace Rendering CPU Fix ✅

You are working in `/Users/manik/code/pandora`.

Do not change Rust. Do not change service architecture in this prompt.

## Goal

Make the workspace UI stop rendering hidden expensive work.

## Write Scope

```text
apps/desktop/src/components/layout/workspace/
apps/desktop/src/components/editor/ only if needed for active body props
```

## Required Work

1. Delete any grow-only mounted workspace list.
2. Render exactly one selected workspace.
3. Ensure inactive diff/review tab bodies are unmounted, not hidden.
4. Do not add `void someAsyncCall()` calls.
5. Do not add comments unless they explain non-obvious behavior.

## Acceptance

```bash
rg "mountedWorkspaceIds|workspaceIdsToRender|mountedReadyWorkspaceIds" apps/desktop/src/components/layout/workspace
rg "display: isActiveTab|visibility: isActiveTab|aria-hidden=\\{!isActiveTab\\}" apps/desktop/src/components/layout/workspace
bunx tsc --noEmit -p apps/desktop
```

The first two greps must return no results for workspace rendering and expensive tab bodies.

## Final Report

Report files changed, exact rendering behavior, and typecheck result.

---

<!--
NOTES FOR PROMPT 2:
- workspace-view.tsx now renders exactly one WorkspaceRuntimeView for the selected workspace (key=selectedWorkspaceID forces remount on switch).
- mountedWorkspaceIds / workspaceIdsToRender / mountedReadyWorkspaceIds are gone; no hidden workspace DOM is kept.
- DiffViewer and ReviewViewer return null when their tab is not active; no display:none/visibility wrappers remain for those bodies.
- PaneTerminalAnchorSlot still uses visibility:hidden on its anchor div — this is intentional (native OS overlay positioning, not a React-rendered body).
- WorkspaceView still gates on runtime.connectionState === "connected" and runtime.layoutLoaded — this is Task 3.2 scope, not Prompt 1.
- Pre-existing typecheck errors in terminal-events.ts (3 errors, wrong export names) were present before this change and are unchanged.
-->

# Prompt 2 — NavigationStore As Selection Source Of Truth ✅

You are working in `/Users/manik/code/pandora`.

Do not change Rust. Do not change terminal startup internals in this prompt.

## Goal

Make workspace/project selection come from `NavigationStore`, not `desktopStateSnapshot`.

## Write Scope

```text
apps/desktop/src/services/workspace/navigation-store.ts
apps/desktop/src/services/workspace/catalog-store.ts
apps/desktop/src/hooks/use-navigation.ts
apps/desktop/src/hooks/use-desktop-view.ts
apps/desktop/src/services/workspace/desktop-view-service.ts
apps/desktop/src/services/workspace/desktop-view-store.ts
apps/desktop/src/services/workspace/desktop-view-projections.ts
apps/desktop/src/services/workspace/desktop-workspace-service.ts only selection-facing methods
apps/desktop/src/components/layout/left-sidebar/
apps/desktop/src/App.tsx if selected state wiring requires it
```

## Required Work

1. `NavigationStore` owns selected workspace, selected project, navigation area, layout target, and search text.
2. `CatalogStore` owns projects and workspaces.
3. `useDesktopView` must derive from the new stores or be replaced by direct domain hooks.
4. `selectWorkspace` must update selection immediately and return without waiting for backend startup.
5. Selection persistence and mark-opened must run with explicit error handling.
6. No `void` fire-and-forget calls.

## Acceptance

```bash
rg "desktopStateSnapshot\\.selectedWorkspaceID|desktopStateSnapshot\\.selectedProjectID|desktopStateSnapshot\\.navigationArea|desktopStateSnapshot\\.layoutTargetRuntimeId|desktopStateSnapshot\\.searchText" apps/desktop/src/services/workspace apps/desktop/src/hooks apps/desktop/src/components/layout/left-sidebar
bunx tsc --noEmit -p apps/desktop
```

The grep must return no production selection source-of-truth usage.

## Final Report

Report how selection flows after your change and which old paths remain.

---

<!--
NOTES FOR PROMPT 3:
- NavigationStore is now the single source of truth for selectedWorkspaceID, selectedProjectID, navigationArea, layoutTargetRuntimeId, and searchText.
- desktopStateSnapshot no longer has those 5 selection fields on its type. It only holds projects, workspaces, runtimes, and prAwaitingWorkspaceIds.
- useDesktopView reads all selection fields from useNavigationStore and useCatalogStore directly, bypassing the old desktopViewStore pipeline for selection.
- applyAppState (desktop-view-service.ts) hydrates NavigationStore and CatalogStore alongside updating desktopStateSnapshot.projects/workspaces.
- publishDesktopNow now builds the DesktopViewStateSnapshot by reading NavigationStore.getState() — it still publishes to the old desktopViewStore for any remaining consumers.
- workspace-selection-service.ts: applyWorkspaceSelection writes to NavigationStore only; startSelectionSettle guards read from NavigationStore.getState() instead of the old snapshot.
- workspace-crud-service.ts: all direct desktopStateSnapshot selection mutations replaced with NavigationStore calls.
- desktop-workspace-service.ts: all direct desktopStateSnapshot selection reads/writes replaced with NavigationStore calls.
- The old startSelectionSettle is still present (Prompt 3 replaces it with ensureWorkspaceActiveServices split).
- Pre-existing typecheck errors in terminal-events.ts (3 errors, wrong export names) remain unchanged.
-->

# Prompt 3 — Remove Selection Startup Coupling

You are working in `/Users/manik/code/pandora`.

Do not change Rust.

## Goal

Delete `startSelectionSettle` and make backend service startup a background concern separate from selecting a workspace.

## Write Scope

```text
apps/desktop/src/services/workspace/desktop-workspace-service.ts
apps/desktop/src/services/workspace/workspace-selection-service.ts
apps/desktop/src/services/workspace/workspace-startup.ts
apps/desktop/src/services/workspace/workspace-api.ts
apps/desktop/src/services/file-tree/file-tree-service.ts only call-site signature updates
apps/desktop/src/services/scm/scm-service.ts only call-site signature updates
```

## Required Work

1. Remove `startSelectionSettle`.
2. Replace it with explicit background startup functions:
   - `ensureProjectTerminalScopeStarted`
   - `ensureWorkspaceBackendServicesStarted`
   - `ensureWorkspaceLayoutLoaded`
3. These functions must not block selection.
4. All background calls must use explicit error handling, not `void`.
5. Remove connection wait polling from selection.

## Deletion is required

- Delete frontend calls to deleted backend lifecycle commands: `start_workspace_runtime`, `start_project_runtime`, and `stop_project_runtime`.
- Delete frontend listeners and waiters for the deleted `runtime-connection` event.
- Delete fake connection/startup state that exists only to preserve the old runtime lifecycle.
- Do not restore backend shims. Typecheck failures caused by these old frontend references belong to this prompt.

## Acceptance

```bash
rg "startSelectionSettle|maybeStartSelectedWorkspace|waitForWorkspaceConnection" apps/desktop/src/services/workspace
rg "\\bvoid\\s+[a-zA-Z0-9_.$]+\\(" apps/desktop/src/services/workspace
bunx tsc --noEmit -p apps/desktop
```

The first grep must return no results. The second must not show new or touched fire-and-forget calls.

## Final Report

Report the new selection lifecycle and the new background startup lifecycle.

---

# Prompt 4 — LayoutStore Source Of Truth

You are working in `/Users/manik/code/pandora`.

Do not change Rust. Do not change terminal process commands in this prompt.

## Goal

Move pane layout and tab metadata off `WorkspaceRuntimeState`.

## Write Scope

```text
apps/desktop/src/services/workspace/layout-store.ts
apps/desktop/src/services/workspace/workspace-layout-model.ts
apps/desktop/src/services/workspace/workspace-tab-model.ts
apps/desktop/src/services/workspace/workspace-session-service.ts
apps/desktop/src/hooks/use-layout-actions.ts
apps/desktop/src/components/layout/workspace/
apps/desktop/src/services/workspace/workspace-persistence.ts if layout save/load signatures change
```

## Required Work

1. Layout mutations operate on layout state, not runtime state.
2. Tab commands write to `LayoutStore`.
3. Workspace layout persistence reads from `LayoutStore`.
4. Workspace shell renders from `LayoutStore` even before backend terminal connection.
5. Do not build fake runtime adapters.

## Deletion is required

- Delete layout helpers that require `WorkspaceRuntimeState` or runtime mutation callbacks.
- Delete or rewrite tests that only assert deleted runtime-layout helpers such as `cycleRuntimeTabs`.
- Delete old helper names instead of keeping aliases like `openDiffTabInWorkspaceRuntime` or `openReviewTabInWorkspaceRuntime`.
- Do not preserve runtime layout compatibility for typecheck.

## Acceptance

```bash
rg "WorkspaceRuntimeState|open.*InWorkspaceRuntime|cycleRuntimeTabs|setFocusedPaneInWorkspaceRuntime|runtime\\.root|runtime\\.focusedPaneID" apps/desktop/src/services/workspace apps/desktop/src/hooks/use-layout-actions.ts apps/desktop/src/components/layout/workspace
bunx tsc --noEmit -p apps/desktop
```

No production layout mutation should require `WorkspaceRuntimeState`.

## Final Report

Report new layout API, persistence behavior, and remaining runtime references if any.

---

# Prompt 5 — TerminalScopeStore Source Of Truth

You are working in `/Users/manik/code/pandora`.

Do not change Rust.

## Goal

Move terminal slot/session/port/agent/project panel state off `WorkspaceRuntimeState`.

## Write Scope

```text
apps/desktop/src/services/terminal/terminal-scope-store.ts
apps/desktop/src/services/terminal/terminal-startup-service.ts
apps/desktop/src/services/terminal/terminal-command-service.ts
apps/desktop/src/services/terminal/project-terminal-panel-model.ts
apps/desktop/src/services/workspace/project-terminal-service.ts
apps/desktop/src/components/layout/bottom-panel/
apps/desktop/src/components/terminal/
apps/desktop/src/lib/terminal/
```

## Required Work

1. Define and consistently use terminal scope ids.
2. Workspace terminal scope uses `workspaceId`.
3. Project terminal scope uses `project:${projectId}`.
4. Terminal startup consumes:
   - `NavigationStore`
   - `CatalogStore`
   - `LayoutStore`
   - `TerminalScopeStore`
   - `ConnectionStore`
5. Remove `getRuntimes` and `WorkspaceRuntimeState` from terminal startup.
6. No manual polling loops.
7. No `void` fire-and-forget calls.

## Deletion is required

- Delete terminal reads through `desktopStateSnapshot.runtimes`.
- Delete terminal startup logic that waits for deleted runtime connection state.
- Delete project-runtime conditionals and replace them with `TerminalScopeId` semantics.
- Do not create a runtime-shaped adapter to feed old terminal helpers.

## Acceptance

```bash
rg "WorkspaceRuntimeState|getRuntimes|runtime\\.slots|runtime\\.sessions|runtime\\.detectedPorts|connectionState" apps/desktop/src/services/terminal apps/desktop/src/components/layout/bottom-panel apps/desktop/src/components/terminal apps/desktop/src/lib/terminal
bunx tsc --noEmit -p apps/desktop
```

No production terminal code should depend on the runtime blob.

## Final Report

Report terminal scope semantics, project terminal behavior, and typecheck result.

---

# Prompt 6 — Domain IPC Event Handling

You are working in `/Users/manik/code/pandora`.

Do not change Rust.

## Goal

Make IPC event handling delegate to domain files and update narrow stores.

## Write Scope

```text
apps/desktop/src/services/ipc/ipc-event-router.ts
apps/desktop/src/services/terminal/terminal-events.ts
apps/desktop/src/services/file-tree/file-tree-events.ts
apps/desktop/src/services/git/git-events.ts
apps/desktop/src/services/editor/editor-events.ts
apps/desktop/src/services/workspace/ only if removing event callbacks from desktop-workspace-service.ts
```

## Required Work

1. Create `terminal-events.ts`.
2. Move terminal event application out of the IPC router.
3. Move PR URL detection to a specific integration module or keep it as a tiny explicit callback, not embedded in generic event routing.
4. `ipc-event-router.ts` may route, but not reduce domain state itself.
5. Do not use `WorkspaceRuntimeState` adapters.

## Deletion is allowed

- Delete `RuntimeQueueEvent` compatibility paths when real scope/domain events are handled directly.
- Delete translation code for old `RuntimeEventEnvelope` shapes.
- Delete frontend handling for `runtime-connection`; no domain handler should synthesize fake lifecycle connection state.
- Do not keep a central reducer just to satisfy old call sites.

## Acceptance

```bash
rg "WorkspaceRuntimeState|buildRuntimeAdapter|emptyTerminalScope|sanitizeWorkspaceTerminalLayout|updateRuntimeSession|rebuildTerminalAgentStatuses" apps/desktop/src/services/ipc apps/desktop/src/services/terminal/terminal-events.ts
bunx tsc --noEmit -p apps/desktop
```

The grep must return no results.

## Final Report

Report event ownership by domain and any remaining central callback responsibilities.

---

# Prompt 7 — Sidebar Summary Stores

You are working in `/Users/manik/code/pandora`.

Do not change Rust.

## Goal

Make sidebar rows read narrow summaries only.

## Write Scope

```text
apps/desktop/src/services/git/git-summary-store.ts
apps/desktop/src/services/git/git-store.ts
apps/desktop/src/services/git/git-events.ts
apps/desktop/src/services/terminal/terminal-scope-store.ts
apps/desktop/src/components/layout/left-sidebar/
```

## Required Work

1. Add Git summary state for row data.
2. Git row summary includes counts and line stats only.
3. Full staged/unstaged arrays remain for the Git panel.
4. Workspace rows read terminal agent summary through a narrow selector.
5. Workspace rows do not scan full Git snapshots in render.

## Deletion is required

- Delete row subscriptions to `useRuntimeState`, `useRuntimeStore`, and `WorkspaceRuntimeState`.
- Delete row render-time scans of full Git snapshots once `GitSummaryStore` exists.
- Delete compatibility selectors that reconstruct runtime-shaped data for sidebar rows.

## Acceptance

```bash
rg "useRuntimeState|useRuntimeStore|WorkspaceRuntimeState" apps/desktop/src/components/layout/left-sidebar
rg "snapshot\\.staged|snapshot\\.unstaged" apps/desktop/src/components/layout/left-sidebar
bunx tsc --noEmit -p apps/desktop
```

Both greps must return no results.

## Final Report

Report summary store shape and row subscription behavior.

---

# Prompt 8 — Delete Frontend Runtime Compatibility

You are working in `/Users/manik/code/pandora`.

Do not change Rust.

## Goal

Delete the old frontend runtime blob and desktop singleton after domain stores are source of truth.

## Write Scope

```text
apps/desktop/src/services/runtime/runtime-store.ts
apps/desktop/src/services/workspace/desktop-view-service.ts
apps/desktop/src/services/workspace/workspace-runtime-model.ts
apps/desktop/src/services/workspace/workspace-selection-service.ts
apps/desktop/src/services/workspace/workspace-startup.ts
apps/desktop/src/services/workspace/desktop-workspace-service.ts
apps/desktop/src/hooks/use-desktop-view.ts
all production imports that reference deleted files
```

## Required Work

1. Delete `WorkspaceRuntimeState` production usage.
2. Delete `desktopStateSnapshot`.
3. Delete runtime-store compatibility.
4. Delete workspace runtime model compatibility.
5. Shrink `desktop-workspace-service.ts` into a thin public facade.
6. No new compatibility aliases.

## Deletion is required

- Delete `runtime-store.ts`; do not keep it as a hidden bridge.
- Delete `workspace-runtime-model.ts`; do not move its runtime helpers into another file.
- Delete `workspace-selection-service.ts` and `workspace-startup.ts` if their only remaining job is old runtime compatibility.
- Delete `readSessionRuntimeState`, `writeSessionRuntimeState`, `scheduleRuntimePublish`, and all imports of them.
- Delete tests or update them to domain stores when they assert deleted runtime blob behavior.

## Acceptance

```bash
rg "desktopStateSnapshot|WorkspaceRuntimeState|useRuntimeStore|runtime-store|workspace-runtime-model|workspace-selection-service|workspace-startup|readSessionRuntimeState|writeSessionRuntimeState|scheduleRuntimePublish" apps/desktop/src --glob '!**/*.test.ts' --glob '!**/*.test.tsx'
wc -l apps/desktop/src/services/workspace/desktop-workspace-service.ts
bunx tsc --noEmit -p apps/desktop
bun test apps/desktop/src
```

The grep must return no production results. `desktop-workspace-service.ts` should be under 700 lines unless the final report justifies why not.

## Final Report

Report deleted files, remaining facade responsibilities, line count, typecheck result, and test result.

---

# Prompt 9 — Rust Domain Registry Refactor ✅

You are working in `/Users/manik/code/pandora`.

Do not change frontend in this prompt except generated type names if absolutely required.

## Goal

Replace the Rust `Runtime` bag with domain registries.

## Write Scope

```text
apps/desktop/src-tauri/src/runtime/
apps/desktop/src-tauri/src/runtime_ipc.rs
apps/desktop/src-tauri/src/commands.rs
apps/desktop/src-tauri/src/main.rs
apps/desktop/src-tauri/src/surface_registry/
apps/desktop/src-tauri/src/terminal_commands/
```

## Required Work

1. Create `TerminalRegistry`.
2. Create `FileTreeRegistry`.
3. Create `ScmRegistry`.
4. Create `EditorIoRegistry`.
5. Commands look up only the domain service they need.
6. Preserve project terminal scope lifetime.
7. Delete old lifecycle compatibility commands instead of preserving fake startup APIs.
8. Remove `Runtime`, `RuntimeRegistry`, `RuntimeCommand`, `RuntimeEventEnvelope`, `runtime_send`, `start_workspace_runtime`, `start_project_runtime`, `stop_project_runtime`, and `runtime-connection`.
9. Do not keep backend compatibility for old frontend calls. Frontend fallout is owned by Prompts 3-8.

## Acceptance

```bash
rg "pub struct Runtime|RuntimeRegistry|RuntimeCommand|RuntimeEventEnvelope|runtime_send|start_workspace_runtime|start_project_runtime|stop_project_runtime|runtime-connection" apps/desktop/src-tauri/src
cargo check
```

The grep must return no production results.

## Final Report

Report registry structure, command lookup changes, project scope lifetime behavior, and `cargo check` result.

<!--
NOTES FROM PROMPT 9:
- `Runtime` struct and `RuntimeRegistry` are deleted. `registry.rs` is gone.
- Four domain registries now live in proper subdirectories under `runtime/`:
    - `runtime/terminal/` — ProcessManager, PTY, port detection, seeding, agent signal, TerminalRegistry
    - `runtime/file_tree/` — FileTreeService + FileTreeRegistry
    - `runtime/scm/` — ScmService + ScmRegistry
    - `runtime/editor_io/` — EditorIoService + EditorIoRegistry
- `DomainRegistries` is the single Tauri-managed state struct holding all four registries.
- `RuntimeCommand` is gone; the backend command enum is `IpcCommand`.
- `RuntimeEventEnvelope` is gone; backend events use `ScopeEventEnvelope`.
- `RuntimeEvent` and `RuntimeEmitter` were renamed to `ScopeEvent` and `ScopeEmitter`.
- `RuntimeConnectionEvent`/`RuntimeConnectionState` and the `runtime-connection` event were deleted.
- `runtime_send` Tauri command is gone; the remaining command transport is `scope_send`.
- `start_workspace_runtime`, `start_project_runtime`, and `stop_project_runtime` Tauri commands were deleted. Domain services now open lazily when `scope_send` dispatches a command that needs terminal, file tree, SCM, or editor IO.
- Commands look up only the domain service they need. `scope_send` resolves workspace/project scope from the database, then opens the matching registry entry on demand.
- Project terminal scope lifetime preserved: `project:<project_id>` key never closed on workspace switch.
- `cargo check` passes.
- Acceptance grep returns zero results.
- Frontend fallout is intentionally left to Prompts 1-8: old frontend code still invokes deleted startup commands and listens for deleted connection events. Do not re-add backend shims to make that pass.
-->

---

# Prompt 10 — Frontend IPC/Git Naming Cleanup

You are working in `/Users/manik/code/pandora`.

Do not change Rust in this prompt.

## Goal

Delete misleading frontend names after the runtime-bag deletion.

The frontend transport boundary is IPC, not runtime. The user-facing source-control domain is Git, not SCM.

## Required Renames

```text
apps/desktop/src/services/runtime/ -> apps/desktop/src/services/ipc/
runtime-client.ts -> ipc-client.ts
runtime-gateway.ts -> ipc-gateway.ts
runtime-event-handler.ts -> ipc-event-router.ts
runtime-event-queue.ts -> ipc-event-queue.ts only if queueing is still real
connection-store.ts -> delete unless it is renamed to a real domain status store

apps/desktop/src/services/scm/ -> apps/desktop/src/services/git/
scm-store.ts -> git-store.ts
scm-summary-store.ts -> git-summary-store.ts
scm-service.ts -> git-service.ts
scm-events.ts -> git-events.ts
scm-api.ts -> git-api.ts
scm-utils.ts -> git-utils.ts
scm-types.ts -> git-types.ts
```

## Deletion is required

- Delete the `services/runtime` frontend folder. Do not keep it as an alias barrel.
- Delete the `services/scm` frontend folder. Do not keep it as an alias barrel.
- Delete frontend `runtime*` names for IPC transport code.
- Delete frontend `scm*` names for Git domain code.
- Do not keep compatibility imports to reduce diff size.
- Do not create `runtime` or `scm` wrapper modules that simply re-export the new names.

## Allowed Translation Boundary

If backend protocol/event names still contain `scm_*`, translate them at the IPC boundary or in `git-events.ts`. Components and frontend domain services must speak Git.

If backend protocol/event names still contain `scope_*`, that is allowed at the IPC boundary because scope ids are real. Do not turn that into a runtime concept.

## Suggested Timing

Run this after Prompt 3 removes deleted backend lifecycle references and before Prompt 6 finalizes IPC event routing. Do not run it in parallel with any prompt that is already editing the same IPC/Git imports.

## Acceptance

```bash
test ! -d apps/desktop/src/services/runtime
test ! -d apps/desktop/src/services/scm
rg "services/runtime|services/scm|runtime-client|runtime-gateway|runtime-event-handler|runtime-event-queue|useRuntimeStore|runtime-store|scm-store|scm-service|scm-events|scm-summary-store|scm-api|scm-utils|scm-types" apps/desktop/src
rg "\\bScm\\b|\\bSCM\\b|\\bscm[A-Z_]|\\bscm_" apps/desktop/src --glob '!**/ipc/**'
bunx tsc --noEmit -p apps/desktop
```

The first two `test` commands must pass. The greps must return no frontend results except backend protocol names isolated under `services/ipc/`.

## Final Report

Report renamed folders/files, deleted aliases, any protocol translations left in `services/ipc/`, and typecheck result.
