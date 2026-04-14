# Design Document: [App Name]
**Native macOS Development Environment Manager and Agentic Supervisor**

| Field | Detail |
|---|---|
| Status | Draft |
| Author | TBD |
| Created | March 2026 |
| Last Updated | March 2026 |

---

## Table of Contents

1. [Overview](#1-overview)
2. [Problem Statement](#2-problem-statement)
3. [Goals and Non-Goals](#3-goals-and-non-goals)
4. [Positioning](#4-positioning)
5. [Architecture Overview](#5-architecture-overview)
6. [Tech Stack](#6-tech-stack)
7. [Configuration](#7-configuration)
8. [Core Subsystems](#8-core-subsystems)
   - 8.1 Background Daemon
   - 8.2 Process Management
   - 8.3 Terminal Panes (libghostty)
   - 8.4 Persistence Model
   - 8.5 Project Identity and Lockfile
   - 8.6 SSH and Remote Development
   - 8.7 Floating Window (NSPanel)
   - 8.8 MCP, Agent Skills, and Stack Awareness
9. [User Interface](#9-user-interface)
   - 9.1 Main Window Layout
   - 9.2 Sidebar
   - 9.3 Terminal Pane
   - 9.4 Advanced Process Features
   - 9.5 Project Switcher
   - 9.6 Settings
   - 9.7 Config Change Dialog
10. [Agentic Layer (Phase 2)](#10-agentic-layer-phase-2)
    - 10.1 Overview
    - 10.2 Agent Process Type and Config
    - 10.3 Worktree Provisioning and Lifecycle
    - 10.4 Agent State Detection
    - 10.5 File Review Panel
    - 10.6 PR View (GitHub Integration)
    - 10.7 Annotation and Agent Correction
    - 10.8 Parallel Agents
    - 10.9 Merge, Push, and Discard Flow
    - 10.10 Interaction Model Discipline
11. [CLI Companion](#11-cli-companion)
12. [Monetization](#12-monetization)
13. [Companion Mobile App](#13-companion-mobile-app)
14. [Competitive Landscape](#14-competitive-landscape)
15. [Build Phases](#15-build-phases)
16. [Open Questions](#16-open-questions)

---

## 1. Overview

[App Name] is a native macOS application that serves as a persistent process dashboard and agentic development supervisor. It replaces the fragmented workflow of maintaining multiple terminal windows per project — one for the dev server, one for the TypeScript watcher, one for the queue worker, one or more for AI agents — with a single purpose-built native window that manages, monitors, and persists all of them.

The application uses SwiftUI for its interface with AppKit for window-level control (NSPanel floating window, libghostty surface hosting) and libghostty for GPU-accelerated terminal rendering via Metal. A background daemon keeps all processes alive even when the GUI is closed. The app supports both local and SSH remote development environments with automatic port forwarding.

In Phase 2, the app extends into agentic development supervision: agents run as first-class processes inside an already-healthy environment, each isolated in its own git worktree, with a full file review panel and inline annotation workflow for supervising their work without becoming an IDE.

**One-line description:** Define your stack, open the app, everything runs. Agents work in parallel, you supervise their diffs, close your laptop — nothing stops.

**Open source:** The core application is open source. Monetization is based exclusively on infrastructure services with real costs that technical users can self-host.

---

## 2. Problem Statement

Modern development workflows involve many concurrent long-running processes. A typical full-stack project — React frontend, Node/Bun backend, TypeScript watcher, database studio, one or more AI agents — requires five or more simultaneous terminal sessions. As agent-based workflows become standard, this number grows further.

**Tab juggling.** Developers lose track of which terminal is running what. Finding the crashed process requires clicking through every tab. There is no unified view of what is healthy.

**No persistence.** Closing a terminal window kills everything. Reopening after a break means restarting every process from scratch, finding the right directories, remembering every command flag. tmux solves this but introduces TUI navigation friction, broken scrolling, and no native GUI.

**Scroll friction in TUI tools.** Tools like mprocs reimplement scrollback buffers in a TUI. The result is always worse than what a real terminal emulator provides natively. Scrolling feels wrong because the TUI is solving a problem the terminal already solved.

**Agents are context-blind.** AI coding agents running in a separate terminal have no awareness of the rest of the stack. The dev server crashed ten minutes ago — the agent doesn't know. It generates code against a broken environment. Context must be manually pasted by the developer every time.

**Remote dev is manual friction.** Working over SSH means manually setting up `-L` port forwards for every port, re-establishing tunnels when connections drop, and having no visibility into remote process health unless you SSH in and check.

**Agentic tools are environment-blind.** Tools like Superset and Parallel Code solve parallel agent orchestration in isolation. They have no concept of your dev server, your queue worker, your port health, or your crash history. The agent runs in a vacuum alongside your environment rather than inside it.

**No native quality.** Existing tools use Electron (heavy), a TUI (no GUI, bad scroll), or a webview-based terminal (xterm.js, not a real terminal). There is no lightweight, purpose-built native Mac app that solves these problems together.

---

## 3. Goals and Non-Goals

### Goals

- Single native Mac window for running and monitoring an entire project's process stack
- Terminal quality identical to Ghostty by embedding libghostty directly with Metal rendering
- Full persistence via a background daemon — close the app, everything keeps running
- Remote development over SSH with automatic port forwarding, identical UX to local
- CLI tool (`soload`) as the universal integration surface — agents, humans, and scripts all use the same commands
- Floating NSPanel window that correctly overlays fullscreen apps and Stage Manager
- Open source core with infrastructure-based monetization
- Phase 2: parallel agents in isolated git worktrees with file review and annotation

### Non-Goals

- Code editing — the developer never types code inside this app
- Being a general-purpose terminal emulator (Ghostty, iTerm2, Warp replacement)
- Windows or Linux support in v1 — Mac-first, may expand via different rendering backend
- Production environment monitoring — this is a dev and staging tool only
- Providing AI agents — the app manages and supervises agents, it does not supply them
- Language servers, intellisense, autocomplete, or any IDE-tier features
- Providing a code execution sandbox for agents — agents have their own bash environments

---

## 4. Positioning

### Against process managers

The closest existing product is soloterm.com (Solo by Aaron Francis). Solo uses Ghostty compiled to WASM running inside a Tauri webview — technically clever but still a webview-based terminal. It has no persistence (close the app, processes die), no SSH support, and no planned worktree isolation. This app uses native libghostty with Metal rendering, a background daemon for true persistence, and SSH with automatic port forwarding — all built on AppKit + SwiftUI rather than Tauri.

### Against agentic tools

Superset.sh is the closest agentic competitor — Electron-based, parallel agents, worktree isolation, diff viewer, Linear and Slack integrations, moving upmarket fast. It is exclusively an agent orchestration tool with no awareness of your running development environment. This app is the opposite: the environment is the product, and agents are processes running inside it. An agent in this app knows your API is on port 3000, knows it crashed four minutes ago, and can read the last 100 lines of its output — because the MCP server is built into the daemon that is already running your stack.

### The spectrum

```
Claude Code / Codex CLI      [This App]          Cursor / Zed
─────────────────────────────────────────────────────────────
Fully autonomous             Supervised           You write code
You see nothing              You can review       You're in control
No environment context       Full stack running   Editor-centric
Close = agents die           Persistent daemon    No persistence concept
```

This app occupies a gap that is genuinely unoccupied. It is lighter than Cursor (no code editing, no language servers), more aware than Claude Code (the full stack is running, MCP-connected), and more persistent and environment-aware than Superset.

---

## 5. Architecture Overview

The application has four distinct layers communicating via well-defined interfaces.

```
┌─────────────────────────────────────────────────────────────────┐
│                          GUI Layer                              │
│  AppKit — NSWindow, NSPanel, window lifecycle, global hotkey    │
│  SwiftUI — sidebar, settings, file review, project switcher    │
│  libghostty surfaces — one Metal-rendered terminal per process  │
│  SwiftUI file review panel — diff view, annotation, PR view     │
└───────────────────────────────┬─────────────────────────────────┘
                                │ Unix socket (local)
                                │ WebSocket over SSH tunnel (remote)
┌───────────────────────────────▼─────────────────────────────────┐
│                         Daemon Layer                            │
│  Bun/TypeScript binary (soload), launchd (mac) / systemd (linux)│
│  Owns all PTYs and child processes via node-pty                 │
│  Maintains per-process scrollback buffers in memory             │
│  Crash detection, auto-restart with backoff                     │
│  MCP server exposing all process state to agents                │
│  Git operations for worktree lifecycle (Phase 2)                │
│  Lockfile management per project                                │
└───────────────────────────────┬─────────────────────────────────┘
                                │ child_process / PTY
┌───────────────────────────────▼─────────────────────────────────┐
│                        Process Layer                            │
│  User-defined processes: vite, bun, tsc, drizzle, claude, etc.  │
│  Each in its own PTY — full shell, colors, Starship, REPL       │
│  Agent processes: claude, codex, gemini — in git worktrees      │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                        Config Layer                             │
│  ~/.solo/solo.db — internal project state (always present)      │
│  solo.yml — committed to repo, team-shared (optional)           │
│  .solo-local.yml — personal overrides, gitignored (optional)    │
│  ~/.solo/state/ — daemon runtime state per project              │
└─────────────────────────────────────────────────────────────────┘
```

The GUI and daemon communicate over a Unix domain socket locally. For remote projects, the GUI connects to a daemon on the remote machine via SSH, with PTY I/O and log data streamed through the tunnel.

---

## 6. Tech Stack

| Component | Technology | Rationale |
|---|---|---|
| App foundation | AppKit + SwiftUI | SwiftUI for all UI (sidebar, settings, file review, project switcher); AppKit for window-level control that SwiftUI cannot provide (NSPanel floating window, NSWindow subclassing, global hotkey, libghostty surface hosting) |
| Terminal rendering | libghostty | Metal GPU rendering identical to Ghostty; reads ~/.config/ghostty/config; handles PTY, VT parsing, fonts, ligatures |
| Daemon | Bun / TypeScript | Cross-platform; compiled to standalone binary via `bun build --compile` (no runtime dependency); remote install via `curl` script; `node-pty` for PTY management (same library VS Code uses) |
| Process management | node-pty + child_process | PTY allocation, SIGCHLD handling, process lifecycle |
| CLI | Bun / TypeScript (same package) | `soload` binary — primary interface for humans, agents, and scripts; connects to daemon via Unix socket |
| IPC (local) | Unix domain socket | Zero-overhead local daemon communication; shared by GUI and CLI |
| IPC (remote) | WebSocket over SSH tunnel | Real-time streaming over SSH |
| Config | YAML (optional) + SQLite | YAML for team-shared config (opt-in); SQLite for app-internal project state (always present) |
| Daemon persistence | launchd (macOS) / systemd (Linux) | OS-native service management, auto-start on login |
| SSH | System OpenSSH binary | Tunnel, port forwarding, remote PTY streaming; inherits user's ~/.ssh/config, agent, known_hosts |
| Syntax highlighting | tree-sitter via swift-tree-sitter | Production-grade, grammar-based highlighting for JS/TS/Swift/Python/Go/Rust/HTML/CSS (GUI only, Phase 2) |
| Git operations | Shell invocation | Wraps standard git commands; no custom git implementation |
| Daemon state | SQLite via better-sqlite3 | Project config, process definitions, runtime state; single file at `~/.solo/solo.db` |

### Why AppKit + SwiftUI, not pure SwiftUI

The app uses SwiftUI for all UI code — sidebar, process list, settings, file review panel, project switcher, dialogs. SwiftUI is the right choice for building modern, clean UI quickly.

AppKit is used only where SwiftUI has known limitations that cannot be worked around:

- **NSPanel for the floating window.** SwiftUI controls the NSWindow object and does not allow subclassing or direct configuration. NSPanel requires specific `styleMask`, `collectionBehavior`, and `level` settings to float over fullscreen apps and Stage Manager correctly. Ghostty uses pure SwiftUI and their quick terminal cannot float over fullscreen apps — a known open issue that required 800+ lines of workaround code and still doesn't work correctly.
- **libghostty surface hosting.** The terminal surfaces are `NSView` subclasses backed by `CAMetalLayer`. These are embedded into the SwiftUI layout via `NSViewRepresentable`, but the view itself is AppKit because libghostty's C API targets `NSView`, not SwiftUI.
- **Global hotkey registration.** `CGEventTap` for the floating window hotkey is an AppKit/Carbon-level API.
- **Window lifecycle control.** Preventing duplicate project windows, managing the NSPanel independently of the main window, and handling `hidesOnDeactivate` / `becomesKeyOnlyIfNeeded` behavior.

The pattern is: SwiftUI views embedded in AppKit-owned windows via `NSHostingView`. All UI logic, state management, and layout is SwiftUI. AppKit provides the window shell and the handful of native APIs that SwiftUI cannot access. This gives modern UI development speed without hitting SwiftUI's window-level ceiling.

### Why Bun/TypeScript for the daemon, not Swift

The daemon and GUI are separate binaries communicating over a JSON socket protocol. They share no types, no frameworks, no compilation step. The daemon needs to run on macOS locally and on Linux remotely (EC2, dev boxes, cloud environments). Swift on Linux exists but the toolchain is ~500MB, has sparse server library ecosystem, and requires a separate install. Bun is a single binary that runs on macOS and Linux with the full Node/TS ecosystem available. `node-pty` (the standard PTY library — VS Code uses it) handles process spawning with full PTY allocation. Remote daemon installation becomes `npm install -g soload` instead of SCP'ing pre-compiled architecture-specific binaries. The MCP server, HTTP endpoints, file watching, SQLite — all have mature, battle-tested TypeScript libraries.

### Why libghostty over xterm.js or Ghostty WASM

soloterm.com uses Ghostty compiled to WASM running inside a Tauri webview. This gives Ghostty's terminal correctness but not its rendering quality — WASM renders through WebGL inside a webview process, not directly via Metal. libghostty embedded natively renders directly to a Metal surface with no intermediate layer. The user's actual Ghostty config — fonts, themes, cursor style, opacity, Starship prompt — loads automatically because the library reads `~/.config/ghostty/config` at startup. There is no separate configuration to maintain.

| | libghostty (native) | Ghostty WASM (webview) | xterm.js |
|---|---|---|---|
| Renderer | Metal direct | WebGL in webview | Canvas/WebGL in webview |
| User Ghostty config | ✅ automatic | Partial | ❌ |
| Scrollback | Native libghostty | Native libghostty | Custom implementation |
| Process overhead | None | Webview process | Webview process |
| Cross-platform | macOS + Linux | Any webview host | Any webview host |

---

## 7. Configuration

Configuration follows a three-tier model. No config file is required in the repo — the app works out of the box by storing everything internally. YAML files are opt-in for users who want text-based config or team-shared process definitions.

### 7.1 Three-Tier Config Model

**Tier 1 — App-internal (always works, no files in repo)**

The daemon stores all project configuration in its SQLite database at `~/.solo/solo.db`. When a user opens a directory for the first time and adds processes through the GUI — name, command, port, autostart toggle — they're saved here. This is the default and primary mode. A developer can open any repo, add processes through the UI, and never create a config file.

```
~/.solo/solo.db
  └── projects table
      └── project: /Users/dev/myapp
          ├── process: frontend  │ command: bun run dev  │ port: 5173  │ autostart: true
          ├── process: api       │ command: bun run --watch src/index.ts  │ port: 3000  │ autostart: true
          └── process: types     │ command: tsc --noEmit --watch  │ autostart: true
```

This means the app works for any codebase — open source repos you don't own, mature codebases where the team doesn't use your tool, repos you're just exploring. No file pollution.

**Tier 2 — `.solo-local.yml` (personal, gitignored, optional)**

A local YAML file in the repo for power users who prefer text config. Automatically gitignored on creation. Overrides and extends Tier 1.

```yaml
# .solo-local.yml — in .gitignore
host: user@myserver.com    # SSH host for remote dev

processes:
  ngrok:
    command: ngrok http 3000
    autostart: false

  redis:
    command: redis-server
    port: 6379
    autostart: true
```

**Tier 3 — `solo.yml` (committed, team-shared, opt-in)**

A committed YAML file for teams that want shared process definitions. Only created if the user explicitly chooses "Export config to solo.yml" from the app. This is never auto-generated.

```yaml
# solo.yml — committed to repo
profiles:
  dev:
    processes: [frontend, api, types]
  full:
    processes: [frontend, api, types, db, worker, stripe]

processes:
  frontend:
    command: bun run dev
    port: 5173
    autostart: true
    depends_on:
      api:
        wait_for_port: 3000

  api:
    command: bun run --watch src/index.ts
    port: 3000
    autostart: true
    restart_on_crash: true
    restart_delay_ms: 1000

  types:
    command: tsc --noEmit --watch
    autostart: true

  db:
    command: drizzle-kit studio
    port: 4983
    autostart: false

  worker:
    command: bun run worker.ts
    autostart: false
    restart_on_crash: true

  stripe:
    command: stripe listen --forward-to localhost:3000/webhooks/stripe
    autostart: false

# Phase 2 — agents section
agents:
  feature-auth:
    command: claude
    task: "implement JWT auth in src/auth/"
    setup:
      - "cp $SOLO_ROOT/.env .env"
      - "bun install"
```

**Resolution order:**

```
solo.yml (if exists, team-shared base)
  → merged with .solo-local.yml (if exists, personal overrides and additions)
    → merged with internal DB config (always present, UI-managed)
      → result is the active config
```

Processes defined in a higher tier override lower tiers by name. Processes unique to any tier are included. The internal DB is always the base — YAML files layer on top. If no YAML files exist, the internal DB is the entire config.

### 7.2 GUI-First Process Management

The UI provides a form for adding and editing processes without ever touching a YAML file:

- **Add process:** Name, command, port (optional), autostart toggle, restart on crash toggle
- **Edit process:** Click process in sidebar → settings popover
- **Remove process:** Context menu → Remove
- **Reorder:** Drag in sidebar

All changes save to the internal DB immediately. If a `solo.yml` exists, the app shows a subtle indicator that DB-only processes won't be shared with the team, and offers "Add to solo.yml" as an action.

### 7.3 Config Change Detection

When `solo.yml` or `.solo-local.yml` changes on disk (git pull, branch switch, manual edit), the daemon detects the change via file watching and the GUI presents a confirmation dialog showing exactly what changed before restarting affected processes. No silent surprises.

### 7.4 Config Schema Validation

On load, the daemon validates YAML config and reports errors with line numbers. Invalid process definitions are skipped with a warning rather than blocking the entire project from starting. The internal DB config is always valid by construction (the GUI enforces schema).

---

## 8. Core Subsystems

### 8.1 Background Daemon

A standalone Bun/TypeScript binary (`soload`) separate from the GUI app. On macOS, registered with launchd and auto-starting on login. On Linux (remote dev), registered with systemd user service or started manually.

**Responsibilities:**
- Resolving the three-tier config: internal DB → `.solo-local.yml` → `solo.yml`
- Watching YAML config files for changes (if they exist)
- Spawning and owning all PTYs via `node-pty`
- Maintaining per-process scrollback buffers in memory (configurable, default 5,000 lines)
- Accepting connections from the GUI via Unix domain socket
- Streaming PTY output to connected clients
- Receiving keystrokes from clients and writing to PTY stdin
- Monitoring child processes via exit events
- Auto-restarting crashed processes with exponential backoff
- Writing and cleaning up the lockfile per project
- Running the MCP server on a local HTTP port
- Managing git worktree lifecycle for all agent processes (Phase 2)
- Injecting MCP connection config when spawning agent processes (Phase 2)

**Socket protocol (Unix domain socket, JSON messages):**

| Message | Direction | Description |
|---|---|---|
| `hello` | GUI → Daemon | Connect, request project state |
| `state_snapshot` | Daemon → GUI | Full state of all processes and last N buffer lines |
| `output_chunk` | Daemon → GUI | Incremental PTY output for a process |
| `input` | GUI → Daemon | Keystroke to forward to PTY stdin |
| `process_status` | Daemon → GUI | State change (started, crashed, restarted) |
| `start_process` | GUI → Daemon | Start a stopped or lazy process |
| `stop_process` | GUI → Daemon | SIGTERM, then SIGKILL after timeout |
| `restart_process` | GUI → Daemon | Stop then start |
| `pause_process` | GUI → Daemon | SIGSTOP |
| `resume_process` | GUI → Daemon | SIGCONT |
| `provision_worktree` | GUI → Daemon | Create git worktree and start agent (Phase 2) |
| `discard_worktree` | GUI → Daemon | Remove worktree and branch (Phase 2) |
| `merge_worktree` | GUI → Daemon | Merge agent branch and clean up (Phase 2) |

Socket path: `/tmp/solo-{projectIDHash}.sock`

### 8.2 Process Management

Each process in `solo.yml` is managed independently.

**Lifecycle state machine:**

```
defined → spawning → running ──→ crashed → restarting → running
                   ↓                              (after max retries)
                stopped (user)              → failed (manual restart needed)
                   ↓
                starting (user)
```

**PTY allocation:** Each process gets its own PTY, meaning colors and ANSI codes work correctly, interactive programs and REPLs behave as expected, Starship and shell customizations initialize normally, and the user's full `~/.zshrc` or equivalent loads.

**Signal handling:**

| Action | Signal | Notes |
|---|---|---|
| Pause | SIGSTOP | Kernel-level, cannot be caught by process |
| Resume | SIGCONT | |
| Stop graceful | SIGTERM | Process can handle and clean up |
| Stop force | SIGKILL | Sent after 5s SIGTERM timeout |
| Crash detection | SIGCHLD | Daemon notified on any child exit |

**Auto-restart with backoff:** On non-zero exit, the daemon waits `restart_delay_ms` then respawns. After 5 consecutive crashes within 30 seconds, the process is marked as failed and requires manual restart to prevent thrashing.

**Desktop notifications:** On crash, a native macOS notification fires via `UNUserNotificationCenter` with the process name and last line of output before the crash. If the app is focused, it shows a toast instead.

**Dependency ordering:** Processes can declare `depends_on` with a `wait_for_port` condition. The daemon polls the specified port using a TCP connect probe and only starts the dependent process once it receives a connection. This ensures the frontend doesn't start before the API is actually ready to serve requests — not just spawned.

**OSC notification forwarding:** The daemon monitors PTY output for OSC notification escape sequences (the same mechanism that triggers Claude Code's "awaiting input" notification in Ghostty). These are forwarded as macOS desktop notifications when the app is blurred, or as in-app toasts when focused.

### 8.3 Terminal Panes (libghostty)

Each process in the GUI has a corresponding libghostty surface — a self-contained Metal-rendered terminal instance.

**What libghostty handles automatically:**
- VT/ANSI escape sequence parsing and the full terminal state machine
- GPU-accelerated text rendering via Metal
- Font shaping via CoreText — ligatures, emoji, CJK, all correct
- Reading `~/.config/ghostty/config` — the user's font, theme, cursor style, and opacity apply automatically
- Scrollback buffer with native trackpad scrolling
- Mouse event forwarding
- IME for CJK input

**What the app provides:**
- The `MTKView` that libghostty renders into
- Routing keyboard events from the active pane to the daemon's PTY stdin via socket
- Window resize events to update PTY dimensions via `TIOCSWINSZ`
- Switching the active surface when the user selects a different process

**Scrollback:** Because libghostty maintains its own buffer and handles scroll natively, there is no custom scroll implementation in this app. Trackpad scroll, scroll wheel, and keyboard scroll shortcuts all behave identically to Ghostty. This resolves the primary pain point with mprocs and similar TUI tools.

### 8.4 Persistence Model

The model is analogous to tmux — the daemon owns all processes, the GUI is a client — but surfaced through a native GUI rather than a TUI.

**On first open:**
1. GUI finds `solo.yml`, checks for lockfile
2. No lockfile — starts daemon, passes project path
3. Daemon reads config, spawns all autostart processes, writes lockfile
4. GUI connects to socket, receives state snapshot
5. GUI renders the running stack

**On close:**
1. GUI closes window, disconnects from socket
2. Daemon and all processes continue running unaffected
3. Scrollback buffers remain in daemon memory

**On reopen:**
1. GUI finds `solo.yml`, checks lockfile — PID alive
2. GUI connects to existing daemon socket
3. Daemon sends full state snapshot with buffered output
4. GUI renders state identical to when it was closed

**On machine restart:**
1. launchd starts daemon binary at login
2. Daemon reads persisted state from `~/.solo/state/{projectID}.json`
3. Respawns all processes that were running at last shutdown
4. GUI opens and sees the running stack

### 8.5 Project Identity and Lockfile

**Project identity** is the canonical resolved absolute path of the directory containing `solo.yml`. Symlinks are resolved so that `/tmp/myapp` and `/private/tmp/myapp` are treated as the same project on macOS.

```swift
let projectID = URL(fileURLWithPath: soloYmlPath)
    .deletingLastPathComponent()
    .resolvingSymlinksInPath()
    .path
```

**Lockfile** lives at `{project_root}/.solo.lock`, written on daemon start, deleted on clean exit.

```json
{
  "pid": 48291,
  "socket": "/tmp/solo-abc123.sock",
  "version": "1.0.0",
  "started": "2026-03-10T09:00:00Z"
}
```

**Resolution logic:**
```
lockfile exists?
  ├── YES → is PID alive?
  │          ├── YES → daemon running → connect to socket
  │          └── NO  → stale lockfile → delete → start fresh daemon
  └── NO  → start fresh daemon
```

**GUI project registry:** The GUI maintains a `[String: ProjectWindow]` registry keyed by canonical path. Opening the same project twice focuses the existing window rather than opening a duplicate.

### 8.6 SSH and Remote Development

For remote projects the full daemon model runs on the remote machine. The local GUI connects over SSH.

```yaml
# solo.yml
host: user@myserver.com
identity_file: ~/.ssh/id_ed25519

processes:
  frontend:
    command: bun run dev
    port: 5173     # auto-forwarded to localhost:5173 on local Mac
  api:
    command: bun run --watch src/index.ts
    port: 3000     # auto-forwarded to localhost:3000 on local Mac
```

**Connection flow:**
1. GUI reads `host` from config, spawns `/usr/bin/ssh` as a subprocess
2. Checks if `soload` exists on the remote via `ssh exec 'which soload'`
3. If not found → runs remote bootstrap (see below), GUI shows "Installing Solo daemon on remote host..." with streamed output
4. Checks for remote lockfile via `ssh exec 'cat /path/to/repo/.solo.lock'`
5. If no lockfile → starts remote daemon via `ssh exec 'soload init --project /path/to/repo'`
6. Sets up port forwarding for every port in config — `localhost:{port}` locally tunnels to `localhost:{port}` remotely
7. Opens a forwarded socket to the remote daemon's Unix socket
8. Communicates with the remote daemon identically to local

**Remote bootstrap (first connect only):**

The remote machine may have nothing installed — no Node, no npm, no Bun. The daemon binary is distributed as a standalone compiled executable (Bun's `bun build --compile` produces a single binary with no runtime dependency). Installation uses a curl-pipe-bash pattern identical to how Bun, Deno, and Homebrew install:

```bash
ssh user@host 'curl -fsSL https://soload.dev/install | bash'
```

The install script:
1. Detects architecture via `uname -m` → `x86_64` or `aarch64`
2. Detects OS via `uname -s` → `Linux` or `Darwin`
3. Downloads the correct binary from GitHub releases: `soload-linux-x64`, `soload-linux-arm64`
4. Installs to `~/.local/bin/soload`, creates the directory if needed
5. Adds `~/.local/bin` to PATH in `~/.bashrc` / `~/.zshrc` if not already present
6. Prints version to confirm success

The GUI handles this transparently — the user selects a remote directory, the app detects `soload` is missing, shows a progress screen while the install script runs over SSH, and then proceeds to start the daemon. Subsequent connects skip this step entirely.

**Published binaries:** Every release publishes 4 binaries to GitHub releases:
- `soload-darwin-x64` (macOS Intel)
- `soload-darwin-arm64` (macOS Apple Silicon)
- `soload-linux-x64`
- `soload-linux-arm64`

The macOS GUI app bundles the appropriate darwin binary and symlinks it to `/usr/local/bin/soload` during onboarding. Remote installs use the curl script.

**Remote persistence:** The remote daemon persists when the local GUI disconnects. Closing the Mac app leaves all remote processes running. Reconnecting re-establishes the tunnel and replays the buffer.

### 8.7 Floating Window (NSPanel)

The floating window summons the app over any context — another app, a fullscreen space, Stage Manager — via a global hotkey without disrupting focus.

**Implementation uses NSPanel, not NSWindow:**

```swift
let panel = NSPanel(
    contentRect: .zero,
    styleMask: [.nonactivatingPanel, .borderless, .resizable],
    backing: .buffered,
    defer: false
)

panel.level = NSWindow.Level(
    rawValue: Int(CGWindowLevelForKey(.floatingWindow)) + 1
)

panel.collectionBehavior = [
    .canJoinAllSpaces,       // visible on every Space
    .fullScreenAuxiliary,    // overlays fullscreen apps correctly
    .ignoresCycle,           // invisible to Cmd+Tab
    .stationary              // not absorbed into Stage Manager groups
]

panel.isFloatingPanel = true
panel.hidesOnDeactivate = false
panel.becomesKeyOnlyIfNeeded = true
```

**Why this works when Ghostty's doesn't:** Ghostty uses pure SwiftUI for its window layer and cannot subclass or directly configure NSWindow. This app uses AppKit for the window shell (NSPanel with full configuration control) and SwiftUI for the content inside it. The floating window's NSPanel configuration is a few lines of AppKit; everything the user sees inside it is SwiftUI. Ghostty's float-over-fullscreen is a known open issue; this is a solved problem in this architecture.

**Global hotkey:** Registered via `CGEventTap`. No Accessibility permissions required for most key combinations. Toggle show/hide without activating the main app.

**Behavior:**

| Scenario | Behavior |
|---|---|
| Working in another app | Panel floats above, receives input, other app keeps focus |
| App in fullscreen space | Panel overlays the fullscreen space correctly |
| Stage Manager active | Panel floats above all groups, not absorbed into any |
| Spotlight opens | Panel auto-dismisses |
| Hotkey pressed | Shows/hides without activating the main app |

### 8.8 Agent Integration via CLI

Agents interact with the running stack through the same CLI that humans use: `soload`. Every coding agent has bash. Every coding agent can run a command. No protocol, no config injection, no discovery step.

```bash
soload status                    # all processes: name, state, port, health
soload status api                # single process detail
soload logs api                  # last 50 lines (default)
soload logs api --errors         # error/warning/fatal lines only
soload logs api --errors -n 10   # last 10 error lines
soload search "TypeError"        # grep across all processes, 10 matches/process cap
soload search "TypeError" api    # grep one process
soload restart api               # restart, wait for port, report status
soload start worker              # start a stopped/lazy process
soload stop stripe               # graceful stop
soload health                    # port health table for all configured ports
```

All commands connect to the daemon's existing Unix socket — the same one the GUI uses. The CLI adds zero infrastructure. No HTTP server, no MCP protocol, no SSE streams, no JSON schema definitions.

**Output format:** Human-readable by default, `--json` flag for structured output:

```bash
$ soload status
  NAME       STATE     PORT   HEALTH
  frontend   running   5173   ✓
  api        running   3000   ✓
  types      running   -      -
  worker     crashed   -      -
  db         stopped   4983   -

$ soload status --json
[{"name":"frontend","status":"running","port":5173,"healthy":true}, ...]
```

Agents parse the human-readable output naturally — the same way they parse `git status`, `npm test`, or `docker ps`. The `--json` flag exists for scripting and CI, not because agents need it.

**Token efficiency:** `soload status` for 10 processes produces ~100 tokens of output. `soload logs api --errors -n 10` produces ~200 tokens. Compare this to dumping 10,000 lines of scrollback. The CLI enforces small output by default — agents get clean, bounded responses without any special configuration.

#### How agents discover the CLI

The daemon appends a short block to the agent's instruction file (CLAUDE.md, .codex/instructions.md, or equivalent) when creating a worktree:

```markdown
## Solo Stack

This project's dev stack is managed by Solo.
Run `soload status` to check all processes before and after changes.
Run `soload logs <name> --errors` to see recent errors.
Run `soload restart <name>` if a process crashed.
```

~30 tokens of instructions. The agent reads it, knows the commands, uses them like any other CLI tool. No MCP config to inject, no per-agent integration to worry about, no "does this agent support MCP?" question.

#### Why CLI over MCP

MCP is a protocol designed for structured tool discovery and invocation. It requires an HTTP server, tool schema definitions, per-agent config injection (`--mcp-config`, `--mcp-server`), and assumes the agent has native MCP client support. That's a lot of machinery for what is fundamentally "the agent needs to check if the API is running."

The CLI does the same thing with zero overhead:
- No HTTP server to run
- No protocol to implement
- No per-agent config flags to inject
- No dependency on agent MCP support
- Works with every agent that has bash (all of them)
- Works for human developers too — same commands
- Works in CI/CD scripts
- Testable with `curl` → not needed, just run the command

MCP can be added later as an optional thin wrapper around the daemon socket if there's demand for structured tool integration. But the CLI is the primary interface — it's simpler, more universal, and zero-overhead for both agents and humans.

#### What this enables in practice

An agent running in its worktree can:

- Run `soload status` → see the entire stack health in ~100 tokens
- Run `soload logs api --errors` → see the last 20 error lines from the API
- Run `soload restart worker` → restart a crashed worker, get confirmation with port health
- Run `soload search "TypeError"` → find which process produced an error

All through bash. The same way the agent runs `git diff`, `bun test`, or `ls src/`. No special integration. The agent treats `soload` like any other Unix tool in its environment.

This is qualitatively different from editor-based agents, which are reactive — the developer must explicitly share context. With `soload` on the PATH, the agent always has access to the full environmental context because the CLI connects to the daemon that is already managing the stack.

---

## 9. User Interface

### 9.1 Main Window Layout

**Process manager view (Phase 1):**

```
┌──────────────────────────────────────────────────────────────────┐
│  toolbar: [project name ▾]  [profiles]  [editor ↗]  [⚙]         │
├───────────────┬──────────────────────────────────────────────────┤
│               │                                                  │
│   PROCESSES   │           Terminal Pane                          │
│               │                                                  │
│  ● frontend   │   (libghostty surface — Metal GPU terminal)      │
│    :5173      │                                                  │
│  ● api        │   Full interactive PTY. Type into any pane.      │
│    :3000      │   Your exact Ghostty config — fonts, theme,      │
│  ● types      │   Starship, ligatures, cursor — all apply.       │
│  ○ db         │                                                  │
│  ○ stripe     │                                                  │
│               │                                                  │
│  LOCAL        │                                                  │
│  ● redis      │                                                  │
│               │                                                  │
└───────────────┴──────────────────────────────────────────────────┘
```

**Agentic view (Phase 2) — agent pane selected:**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  toolbar: [project name ▾]  [profiles]  [editor ↗]  [⚙]                    │
├──────────────┬──────────────────────────────┬──────────────────────────────┤
│              │                              │                              │
│  PROCESSES   │      Terminal Pane           │    File Review Panel         │
│  ● frontend  │                              │                              │
│  ● api       │  claude working in           │  Changed Files (3)           │
│  ● types     │  .solo/worktrees/feat-auth   │  ├ src/auth/login.ts +45 -12 │
│              │                              │  ├ src/auth/session.ts +8 -2 │
│  AGENTS      │  > I'll refactor the auth    │  └ tests/auth.test.ts +30    │
│  ◈ feature   │  module to use optional      │                              │
│    auth ●    │  chaining throughout...      │  [full file view]            │
│  ◈ fix-login │                              │  syntax highlighted          │
│    ⚡ waiting │                              │  diff blocks inline          │
│  ◈ research  │                              │  green adds, red removes     │
│    ●         │                              │                              │
│              │                              │  [line selection active]     │
│              │                              │  ┌──────────────────────┐   │
│              │                              │  │ annotation input...  │   │
│              │                              │  └──────────────────────┘   │
│              │                              │                              │
│              │                              │  feature/auth · 3 files      │
│              │                              │  +83 −14                     │
│              │                              │  [Discard] [Open in Zed]     │
│              │                              │  [Push & Create PR]          │
└──────────────┴──────────────────────────────┴──────────────────────────────┘
```

### 9.2 Sidebar

Each process row shows:

- **Status dot** — green (running), red (crashed), grey (stopped), yellow (restarting)
- **Process name**
- **Port badge** — small pill showing the port number if defined
- **Notification ring** — illuminates on crash, warning output, or OSC notification from the process
- **Context menu** — right-click for start, stop, restart, pause, resume, clear output

Processes are grouped into **PROCESSES** (from `solo.yml`) and **LOCAL** (from `.solo-local.yml`). In Phase 2 an **AGENTS** section appears below these. Agents use a `◈` badge to distinguish them from infrastructure processes.

### 9.3 Terminal Pane

The main content area is a libghostty surface. Selecting a process in the sidebar switches the visible surface. Every surface continues running and accumulating output in the background regardless of which one is visible.

Every pane is always interactive — clicking into any pane and typing forwards keystrokes directly to that process's PTY stdin via the daemon. No mode switching. REPLs, interactive prompts, and programs expecting stdin work identically to a real terminal because they are connected to a real PTY.

### 9.4 Advanced Process Features

**Run profiles:** Defined in `solo.yml`, selectable from the toolbar. Switching a profile stops processes not in the new profile and starts processes that are newly included.

**Port health indicator:** A colored indicator on each process row showing whether the configured port is actively accepting TCP connections — separate from whether the process is running. A process can be running but its port can be down.

**Cross-process log search:** A search bar (Cmd+F) that greps the scrollback buffers of all running processes simultaneously and shows matches grouped by process. Finding which process produced a particular error no longer requires clicking through every terminal tab.

**Git-aware restart prompts:** The app watches for git branch switches and `solo.yml` changes. On a branch switch the app prompts to restart processes whose configuration changed. On a `package.json` or lockfile change it prompts to run the install command before restarting.

**One-off command runner:** A scratchpad pane accessible from the toolbar or command palette. Run a migration, seed the database, or clear a cache without defining it as a named process. Output appears in a temporary pane, history of recently run commands is persisted.

**Dependency ordering:** The `depends_on.wait_for_port` condition in `solo.yml` causes the daemon to probe the port via TCP and only start the dependent process once the port is accepting connections.

**Environment management:** Per-process and per-profile environment variable overrides configurable in `.solo-local.yml`. The worktree setup for agents copies `.env` and `.env.local` into the worktree automatically via setup scripts.

### 9.5 Project Switcher

Cmd+K opens a command palette-style switcher showing all open projects and recent projects. Selecting a project brings its window to focus or opens a new window.

### 9.6 Settings

A SwiftUI settings panel:
- Default editor (VS Code, Zed, Xcode, custom)
- Notification preferences per process category
- Daemon behavior — restart policy, buffer size, backoff parameters
- SSH identity file defaults
- Floating window hotkey
- Theme (light/dark/system)
- GitHub token for PR integration (Phase 2)
- Worktree base directory (default `.solo/worktrees/`, configurable globally and per-project)

### 9.7 Config Change Dialog

On `solo.yml` change:

```
solo.yml has changed

  2 processes added: redis, worker
  1 process modified: api (command changed)

  Apply changes and restart affected processes?

  [View Diff]  [Skip]  [Apply]
```

---

## 10. Agentic Layer (Phase 2)

> **Prerequisite:** Nothing in this section is built until the process manager (Sections 8–9) is stable, shipped, and working reliably. The foundation must exist before the agentic layer is meaningful. This layer extends the product rather than replacing it.

### 10.1 Overview

In Phase 2 the app adds a first-class concept of agents — task-scoped processes that run inside isolated git worktrees, produce code changes, and can be supervised, annotated, and merged without the developer leaving the app.

The key architectural difference from Superset and similar tools: agents in this app run inside an environment that is already healthy and fully MCP-connected. The agent knows the API is running, knows the last error from the dev server, and can restart a crashed worker — because all of that context is ambient in the daemon that is already managing the stack, and the agent interacts with it through token-efficient scripts shipped as a skill folder into its worktree.

### 10.2 Agent Process Type and Config

Agents are defined in a separate `agents:` section of `solo.yml`, distinct from `processes:`. Processes are long-running infrastructure with no defined end. Agents are task-scoped workers with a beginning, a task, and a completion state.

```yaml
agents:
  feature-auth:
    command: claude          # any CLI agent: claude, codex, gemini, opencode
    task: "implement JWT auth in src/auth/"    # optional, sent to agent stdin on start
    setup:                   # runs inside worktree after creation
      - "cp $SOLO_ROOT/.env .env"
      - "bun install"
    teardown:                # runs on worktree deletion
      - "docker compose down"

  fix-login:
    command: codex
    task: "fix the login redirect bug in src/pages/login.tsx"
    setup:
      - "cp $SOLO_ROOT/.env .env"
      - "npm install"

  research:
    command: claude
    worktree: false          # no isolation — read-only, no file changes expected
```

The daemon owns worktree creation for all agents uniformly. There is no special-casing per agent — whether the command is `claude`, `codex`, `gemini`, or any other CLI tool, the daemon creates the worktree, runs setup, and launches the agent inside it. This avoids two different code paths, two different worktree locations, and two different cleanup semantics.

### 10.3 Worktree Provisioning and Lifecycle

When an agent is started (and `worktree: false` is not set), the daemon executes the full worktree lifecycle. This is a thin automation layer over standard git commands.

**Worktree location:** `.solo/worktrees/{agent-name}/` inside the project root. This directory is automatically added to `.gitignore` on first use. The base directory is configurable globally in Settings and per-project in solo.yml.

Worktrees are not placed in `/tmp/` because: (1) macOS cleans `/tmp` on reboot, destroying in-progress agent work; (2) the daemon has persistence as a core feature — worktrees should survive reboots; (3) keeping worktrees relative to the project root makes `git worktree list` and cleanup predictable.

**On start:**
```bash
# Daemon creates worktree and branch
git worktree add .solo/worktrees/feature-auth -b solo/feature-auth

# Run setup commands sequentially inside worktree
cd .solo/worktrees/feature-auth
SOLO_ROOT=/path/to/project
cp $SOLO_ROOT/.env .env
bun install

# Append agent instructions to CLAUDE.md / .codex/instructions.md
# (~30 tokens: "Run `soload status` to check processes.
#  Run `soload logs <n> --errors` for errors.
#  Run `soload restart <n>` if a process crashed.")

# Start agent inside worktree (soload is on PATH)
claude    # or codex, gemini, etc.
```

If a `task:` is defined in the config, the daemon sends it to the agent's PTY stdin after the agent process starts. This is equivalent to typing the task description into the agent's prompt.

**On discard:**
```bash
# Run teardown commands if configured
cd .solo/worktrees/feature-auth && docker compose down

# Remove worktree and branch
git worktree remove .solo/worktrees/feature-auth
git branch -d solo/feature-auth
```

**On merge:**
```bash
git merge solo/feature-auth
git worktree remove .solo/worktrees/feature-auth
git branch -d solo/feature-auth
# if --push-pr, then:
git push origin solo/feature-auth
# open PR creation in browser
```

**Orphan cleanup:** On startup, the daemon runs `git worktree list --porcelain` in each registered project root. Any worktree path under `.solo/worktrees/` with no corresponding agent entry in daemon state is presented as "orphaned — remove or reconnect?" `git worktree prune` handles the git metadata side. The daemon handles the state side.

**Daemon state per worktree:**

```swift
struct AgentWorktree {
    let id: UUID
    let projectPath: String
    let worktreePath: String    // .solo/worktrees/feature-auth
    let branchName: String      // solo/feature-auth
    let agentCommand: String    // claude
    let ptyHandle: PTYHandle    // libghostty surface
    var status: WorktreeStatus
}

enum WorktreeStatus {
    case provisioning
    case running
    case waitingForInput
    case finished
    case crashed
}
```

### 10.4 Agent State Detection

The daemon scans PTY output for known patterns to produce the `waitingForInput` state displayed in the sidebar:

```swift
let waitingPatterns = [
    "Do you want to proceed",    // Claude Code permission prompts
    "Press Enter to continue",
    "Waiting for your input",
    "(y/n)",
    "(yes/no)",
]
```

The `⚡` indicator in the sidebar fires when any of these patterns appear in the agent's PTY output, alerting the developer that the agent is blocked without requiring them to watch every terminal.

### 10.5 File Review Panel

When an agent pane is selected in the sidebar, a review panel slides in from the right. The terminal pane remains the primary surface — the review panel is supplementary context, not a workspace the developer lives in.

**Changed files list:** A compact tree showing only files modified by the agent — not the full project. Each file shows `+N -N` line counts. Clicking a file loads the file view.

**Full file view with inline diff:** This is the Cursor-style view. The full file is shown, scrollable, with syntax highlighting applied to all lines. Diff blocks are overlaid inline — not a separate unified diff pane, but the actual file content with changed lines marked:

- Unchanged lines: normal syntax highlighted text
- Added lines: green left border, subtle green background tint
- Removed lines: red left border, subtle red background, shown inline above the replacement
- Hunk boundaries: faint horizontal separator

Syntax highlighting uses tree-sitter via `swift-tree-sitter` — lives under the official tree-sitter GitHub org, maintained by the core team. Grammar files cover JS, TS, Python, Go, Rust, CSS, HTML, JSON, YAML. `Neon` (ChimeHQ) is a production macOS syntax highlighting system built on it. Files in unsupported languages fall back to unstyled monospace. No language server, no intellisense — token coloring only.

**Implementation:** The data source is `git diff main...<agent-branch> -- <filepath>` parsed into a line-by-line structure and merged with the full file content:

```swift
enum DiffLineType { case unchanged, added, removed, hunkHeader }

struct DiffLine {
    let type: DiffLineType
    let content: String
    let lineNumber: Int?        // nil for removed lines
    let originalLineNumber: Int?
}
```

The parser reads unified diff format from git, builds the line array, and the SwiftUI view renders it in a `List`. Each row is a `HStack` with a colored left border view, line number, and syntax-highlighted text.

### 10.6 PR View (GitHub Integration)

Once an agent has pushed a branch and a PR exists, the file review panel can switch between the local worktree diff view and the GitHub PR view. Both use the same rendering pipeline — the data source changes but the line-level diff view is identical.

**GitHub API calls:**

```
# Check if PR exists for the branch
GET /repos/{owner}/{repo}/pulls?head={branch}&state=open

# Get PR file list and patches
GET /repos/{owner}/{repo}/pulls/{pull_number}/files
```

The files endpoint returns each changed file with its unified diff patch. The app parses this using the same `DiffLine` structure and renders identically to the local view.

**Token:** A GitHub personal access token stored in Keychain, configured in Settings. Read-only scopes sufficient.

**Automatic switching:** The panel shows the local diff while the agent is actively running or the branch has not been pushed. Once a PR is detected it offers a toggle to view the PR diff with any review comments annotated on the relevant lines.

### 10.7 Annotation and Agent Correction

The core interaction in the review panel. The developer never edits code directly — they annotate what needs changing and the agent corrects it.

**Interaction flow:**
1. Developer scrolls the file view, sees something incorrect
2. Developer clicks a line number or drags across multiple lines
3. An annotation popover appears anchored to the selection
4. Developer types: *"this will break on null input, use optional chaining"*
5. Developer presses Enter or clicks Send
6. The annotation is written to the agent's PTY stdin with context prepended:

```
[Review note — src/auth/login.ts lines 47–52]:
this will break on null input, use optional chaining
```

This is stdin forwarding to a PTY — exactly what typing in the terminal does, but structured and contextual. The app does not parse code, does not call a language server, does not make edits. The agent remains the actor.

**Annotation badges:** Annotated lines show a small dot in the gutter. Clicking it shows the annotation text and — if the agent's response is available via MCP — a summary of what the agent did in response.

### 10.8 Parallel Agents

Multiple agents run simultaneously, each with their own worktree, terminal pane, and review panel state.

```
PROCESSES
● frontend          :5173
● api               :3000
● types

AGENTS
◈ feature-auth      ●  running    claude
◈ fix-login-bug     ⚡  waiting    codex
◈ research          ●  running    claude
```

Each agent connects to the same daemon via `soload`. An agent fixing a bug runs `soload logs api --errors` and gets the last 20 error lines from the crashed API directly without the developer manually copying logs.

**The `⚡ waiting` indicator** means the agent's PTY output matched a waiting pattern — it needs attention. Clicking the agent row jumps to its terminal pane.

### 10.9 Merge, Push, and Discard Flow

The summary bar at the top of the review panel:

```
solo/feature-auth  ·  3 files changed  ·  +83  −14
[Discard]  [Open in Zed]  [Push & Create PR]  [Merge locally]
```

**Merge locally:** Runs `git merge solo/feature-auth` from the repo root, removes the worktree. If there are merge conflicts, the app surfaces them and defers to the editor via "Open in Zed / VS Code" passing the worktree path.

**Push & Create PR:** Runs `git push origin solo/feature-auth` then opens `github.com/user/repo/compare/solo/feature-auth` in the browser. PR creation stays in GitHub — the app does not build a PR creation UI.

**Open in editor:** Passes the worktree path (not the main repo path) to the configured editor. The developer does full code review in their editor before merging.

**Discard:** Removes the worktree and deletes the branch. Confirmation required if there are unreviewed changes.

### 10.10 Interaction Model Discipline

This section defines what the app explicitly does not do to prevent scope creep toward full IDE.

| Action | In Scope | Out of Scope |
|---|---|---|
| Full scrollable file view with syntax highlighting | ✅ | |
| Inline diff blocks overlaid on the full file | ✅ | |
| Line selection and annotation popover | ✅ | |
| Forwarding annotations to agent's PTY stdin | ✅ | |
| Per-file or per-hunk accept/discard | ✅ | |
| Push branch, open PR creation in browser | ✅ | |
| PR diff view via GitHub API | ✅ | |
| Direct code editing in the review panel | | ❌ |
| Autocomplete or intellisense | | ❌ |
| Language server integration | | ❌ |
| Full project file browser for unchanged files | | ❌ |
| Code search across the project | | ❌ |
| Providing a code execution sandbox for agents | | ❌ |

**The guiding principle:** the developer supervises and annotates, the agent acts. The moment the developer is writing code in the app rather than in their editor, the product has become an IDE and the positioning has collapsed. Similarly, the moment the app provides its own execution sandbox, it is competing with the agent's own environment rather than augmenting it.

---

## 11. CLI (`soload`)

The CLI is the primary integration surface for humans, agents, and scripts. It is part of the same Bun/TypeScript package as the daemon. All commands connect to the daemon's Unix socket — the same socket the GUI uses.

```bash
# Project management
soload                           # opens GUI for current directory's project
soload open ~/projects/myapp     # opens GUI for a specific project
soload init                      # creates a project entry for the current directory

# Process control
soload status                    # all processes: name, state, port, health
soload status api                # single process detail + uptime, restart count
soload start worker              # start a stopped or lazy process
soload stop stripe               # graceful stop (SIGTERM → SIGKILL)
soload restart api               # restart, wait for port if configured, report status
soload pause types               # SIGSTOP — freeze process
soload resume types              # SIGCONT — unfreeze

# Logs
soload logs api                  # last 50 lines (default)
soload logs api -n 100           # last 100 lines (hard cap 200)
soload logs api --errors         # error/warning/fatal lines only
soload logs api --errors -n 10   # last 10 error lines
soload search "TypeError"        # grep across all processes, 10 matches/process cap
soload search "TypeError" api    # grep single process

# Health
soload health                    # port health table: port, status, latency
soload health api                # single process port health

# Daemon management
soload daemon status             # is the daemon running, PID, uptime
soload daemon stop               # stop daemon and all processes
soload daemon restart            # restart daemon
soload list                      # all projects with running daemons

# Process definition (GUI-less workflow)
soload add frontend "bun run dev" --port 5173 --autostart
soload add api "bun run --watch src/index.ts" --port 3000 --restart-on-crash
soload remove frontend
soload edit api --port 3001

# Output format
soload status --json             # JSON output for scripting/CI
soload logs api --json           # JSON array of log lines
```

**Implementation:** Every command connects to the daemon's Unix socket at `/tmp/solo-{projectHash}.sock` found via the lockfile. If no daemon is running, commands that need one (status, logs, restart) print an error and suggest `soload init`. Commands that manage config (add, remove, edit) write to the internal SQLite DB directly and notify a running daemon to reload.

**Installation:** `curl -fsSL https://soload.dev/install | bash` — downloads the compiled binary for your OS and architecture, installs to `~/.local/bin/soload`. Also available via `brew install soload` on macOS. The macOS GUI app bundles the binary and offers to symlink it to `/usr/local/bin/soload` during onboarding. On remote Linux machines, the GUI runs the curl install automatically over SSH on first connect.

**Agent usage:** The CLI is the recommended way for agents to interact with the stack. The daemon appends ~30 tokens of instructions to the agent's instruction file (CLAUDE.md, .codex/instructions.md) on worktree creation, telling it to use `soload status`, `soload logs --errors`, and `soload restart`. No MCP config, no HTTP endpoints, no protocol — just bash commands.

**Human usage:** Developers use the same commands from their terminal. `soload status` replaces clicking through terminal tabs to find what's running. `soload logs api --errors` replaces scrolling through a terminal pane looking for red text. The CLI is useful even without the GUI open.

---

## 12. Monetization

### Free Tier (Forever)

The complete local experience with no artificial limits. Unlimited projects, processes, terminal panes, port forwards, SSH connections, MCP integration, parallel agents, worktrees, and file review. The full value proposition of the app is free and open source.

### Paid — Infrastructure Services Only

Monetization is based on services with real infrastructure costs that technical users can self-host. There are no feature paywalls.

| Service | Description | Self-hostable |
|---|---|---|
| **Hosted relay** | Managed WebSocket relay for mobile companion app and remote machine connectivity through NAT/firewalls | Yes — Docker image published |
| **Managed cloud dev boxes** | Spin up a remote dev environment in one click inside the app. Billed per minute. No server configuration. | No — infrastructure ops |
| **Managed GPU instances** | Cloud GPU for running local AI models or large agent workloads. Click to start, billed by usage, auto-teardown on idle. | No — infrastructure ops |
| **Team relay** | Shared relay with team features: Slack crash notifications, shared process dashboard, team-wide port health | Partially self-hostable |

The managed cloud dev boxes and GPU instances are the primary revenue opportunity. They have genuine infrastructure costs and months of operational complexity that almost nobody will replicate by forking the app — the same model as Supabase, Vercel, and Fly: open source the client, monetize the infrastructure.

---

## 13. Companion Mobile App

An iOS app connecting to the daemon for monitoring and basic control when away from the Mac.

### Feature Scope

The mobile experience is read-mostly. Full terminal interaction on a phone is not a goal.

| Feature | Description |
|---|---|
| Process dashboard | Live view of all process statuses |
| Log streaming | Real-time log tail per process |
| Basic controls | Restart crashed processes, start lazy ones, stop running ones |
| Push notifications | Crash alerts via APNs through the relay server |
| Port health | Whether configured ports are accepting connections |
| Agent status | Running/waiting/finished state for active agents (Phase 2) |

### Connectivity

**Same network:** The app connects directly to the daemon's WebSocket interface on the local network. No infrastructure needed.

**Remote:** Traffic routes through the relay server — daemon connects outbound to relay, mobile connects to relay, relay brokers messages. Neither Mac nor phone needs to be publicly addressable. Relay Docker image is published for self-hosting.

---

## 14. Competitive Landscape

### Process Manager Comparison

cmux is a terminal emulator, not a process manager — it doesn't define or autostart processes from a config file. It belongs in this table because it's the closest native-Mac terminal used alongside the same workflows. The distinction between "terminal for agents" (cmux) and "process manager with terminals" (Solo, this app) is the key conceptual divide in this space.

| | [App Name] | soloterm.com | cmux | mprocs | tmux |
|---|---|---|---|---|---|
| Terminal quality | libghostty / Metal | Ghostty WASM / webview | libghostty / Metal | TUI | TUI |
| Process persistence | ✅ daemon | ❌ close = dead | ❌ layout only, processes die | ❌ | ✅ |
| SSH + auto port forward | ✅ | ❌ | ✅ partial¹ | ❌ | Manual only |
| Config file (process definitions) | ✅ | ✅ solo.yml | ❌ | ✅ mprocs.yaml | ❌ |
| Auto-restart on crash | ✅ | ✅ | ❌ | ✅ | ❌ |
| Solo.yml change detection | ✅ | ✅ | ❌ | ❌ | ❌ |
| Run profiles | ✅ | ❌ | ❌ | ❌ | ❌ |
| Dependency ordering (wait_for_port) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Port health indicator | ✅ | ❌ | Sidebar display only | ❌ | ❌ |
| Cross-process log search | ✅ | ❌ | ❌ | ❌ | ❌ |
| Git-aware restart prompts | ✅ | ❌ | ❌ | ❌ | ❌ |
| Floating window (NSPanel, correct) | ✅ | ❌ | ❌ | ❌ | ❌ |
| MCP integration | ✅ via CLI | ✅ basic (read + restart) | ❌ | ❌ | ❌ |
| Parallel agents + worktrees | ✅ Phase 2 | ❌ | ❌ | ❌ | ❌ |
| File review + annotation | ✅ Phase 2 | ❌ | ❌ | ❌ | ❌ |
| Native Mac (AppKit + SwiftUI) | ✅ | Tauri / webview | ✅ | ❌ | ❌ |
| Open source | ✅ | ❌ | ✅ AGPL | ✅ MIT | ✅ |
| Mobile companion | ✅ planned | ❌ | ❌ | ❌ | ❌ |
| macOS only | ✅ | ❌ cross-platform planned | ✅ | ❌ | ❌ |

¹ cmux has `cmux ssh user@host` with auto port forwarding. Remote CLI commands from within the session are still an open issue.

### Agentic Tool Comparison (Phase 2)

These are the tools your app competes with once the agentic layer ships. None of them have a running dev environment — they're all agent orchestrators that sit beside your stack rather than owning it.

| | [App Name] | Superset.sh | Conductor | cmux | Parallel Code |
|---|---|---|---|---|---|
| Parallel agents | ✅ | ✅ | ✅ | ✅ tabs | ✅ |
| Worktree isolation | ✅ | ✅ | ✅ | ❌ | ✅ |
| Running dev environment | ✅ | ❌ | ❌ | ❌ | ❌ |
| Process persistence | ✅ daemon | ❌ | ❌ | ❌ layout only | ❌ |
| MCP + Skills for agents | ✅ via CLI | ❌ MCP only | ❌ | ❌ | ❌ |
| SSH + remote dev | ✅ | ❌ | ❌ | ✅ partial | ❌ |
| Full file + inline diff view | ✅ | ✅ | ✅ diff-first | ❌ | ❌ |
| Inline annotation → agent | ✅ | ❌ | ❌ | ❌ | ❌ |
| PR view + creation | ✅ | ✅ | ✅ | ✅ sidebar | ❌ |
| Linear integration | ❌ | ✅ | ✅ | ❌ | ❌ |
| Embedded browser | ❌ | ❌ | ❌ | ✅ | ❌ |
| Open source | ✅ | ❌ ELv2 | ✅ free | ✅ AGPL | ✅ |
| Native Mac (AppKit + SwiftUI) | ✅ | ❌ Electron | ✅ | ✅ AppKit | ❌ Electron |
| Code editing | ❌ by design | ❌ | ❌ | ❌ | ❌ |

**Key differentiation from all agentic tools:** Every tool in this table sits beside your development environment. This app owns the environment. Agents run inside a stack that is already healthy, and interact with it through `soload` — the same CLI humans use. An agent can run `soload status` to see its entire stack in ~100 tokens, run `soload logs api --errors` to get the last 20 error lines, and run `soload restart worker` to restart a crashed service — without the developer doing anything. None of the tools above have any concept of a running dev stack.

---

## 15. Build Roadmap

The roadmap is divided into milestones rather than phases. Each milestone has a clear definition of done and a hard rule: nothing from the next milestone starts until the current one is stable. The v1 launch target is Milestone 4 — feature parity with Solo plus persistence. Everything after that is differentiation.

### Milestone 0 — Skeleton (no shipper, private)

The smallest possible thing that proves the stack works.

- Xcode project: AppKit app, libghostty linked as xcframework
- One hardcoded `bun run dev` process spawned on launch
- libghostty surface renders in the window, receives keyboard input
- Process output appears in the terminal pane

**Done when:** You can type into a running Vite dev server inside the app and it behaves identically to Ghostty.

---

### Milestone 1 — Config and Sidebar (no shipper, private)

Basic multi-process support driven by config.

- Parse `solo.yml` — process name, command, autostart, port
- Sidebar with process list, status dots (running / stopped / crashed)
- Click a process in the sidebar → switch the visible libghostty surface
- Start / stop / restart via context menu
- Manual start for processes with `autostart: false`
- `.solo-local.yml` parsed and merged, gitignore entry written on first use

**Done when:** You can define your full dev stack in `solo.yml`, open the app, and everything starts. Clicking between processes shows each terminal. Stopping and restarting works.

---

### Milestone 2 — Crash Handling and Notifications (no shipper, private)

The app is now useful as a monitor, not just a launcher.

- `SIGCHLD` handling — daemon detects process exit
- Auto-restart with exponential backoff (configurable, default on)
- Desktop notifications on crash via `UNUserNotificationCenter`
- OSC notification forwarding — if a process sends an OSC bell or notification escape, it becomes a macOS notification when the app is blurred, or an in-app toast when focused
- Status badge updates in sidebar — crashed (red), restarting (yellow)
- Config change dialog — when `solo.yml` changes after a git pull, show what changed and confirm before applying

**Done when:** Kill your dev server from the command line. The app detects the crash, shows a notification, restarts it automatically, and the sidebar reflects each state transition.

---

### Milestone 3 — Daemon and Persistence (no shipper, private)

This is the hardest milestone technically. Getting it right is what separates this app from Solo.

- Extract process management into a standalone daemon binary
- Daemon registers with launchd, starts at login
- Unix domain socket IPC between GUI and daemon
- Lockfile system with symlink resolution
- Reconnect flow — GUI opens, finds existing daemon, replays scrollback buffer
- Scrollback buffer maintained in daemon memory (default 5,000 lines per process, configurable total ceiling of 50,000 lines across all processes via LRU eviction)
- `state_snapshot` message on reconnect — GUI renders current state as if it never closed
- Graceful daemon shutdown — daemon persists state to `~/.solo/state/{projectID}.json` for machine restarts
- launchd respawns daemon at login, which reads persisted state and respawns all previously-running processes

**Done when:** Start all your processes. Quit the app entirely. Wait a minute. Reopen the app. Everything is exactly where you left it — processes still running, scrollback intact, status correct. Restart your Mac. Open the app. Processes start automatically.

---

### Milestone 4 — v1 Launch

Polish, distribution, and CLI. This is the public launch. Feature set at this point matches Solo plus daemon persistence.

- Floating window — NSPanel with correct `collectionBehavior` flags, global hotkey, floats over fullscreen and Stage Manager
- Project switcher — Cmd+K palette, recent projects, multiple windows
- One-off command runner — scratchpad pane for migrations, seeds, one-shot commands
- CLI companion — `solo` binary, Homebrew formula, opens app or communicates with daemon
- Settings panel — default editor, notification preferences, daemon config, hotkey, theme
- Onboarding — first-run flow, `solo.yml` template generation, launchd registration prompt
- Auto-update via Sparkle
- Open source repository published

**Definition of v1:** A developer can define their dev stack in `solo.yml`, open the app once, and never think about starting their stack again. Processes restart on crash. The app persists when closed. The stack is back immediately on machine restart.

---

### Milestone 5 — Process Management Depth (post-launch)

The features that make this genuinely better than Solo on process management alone.

- Run profiles — `dev`, `test`, `full` etc., selectable from toolbar
- Dependency ordering — `depends_on: api` with `wait_for_port: 3000`, daemon probes TCP before starting dependent
- Port health indicator — sidebar badge showing whether the configured port is actually accepting TCP connections, separate from process status
- Git-aware restart prompts — watch for branch switches and lockfile changes, prompt to run install and restart affected processes
- Cross-process log search — Cmd+F greps all scrollback buffers simultaneously, results grouped by process
- Environment management — per-process env overrides in `.solo-local.yml`

**Done when:** Switch git branches. App detects the change, shows which processes are affected, offers to run `bun install` before restarting. Port health badges update in real time. Searching for an error string shows which process produced it without clicking through every pane.

---

### Milestone 6 — SSH and Remote Dev (post-launch)

- SSH connection via system OpenSSH binary — `host:` field in config (solo.yml, .solo-local.yml, or internal DB)
- Automatic port forwarding for every configured port
- Remote daemon bootstrap — `curl -fsSL https://soload.dev/install | bash` over SSH on first connect, GUI shows setup progress screen
- Remote lockfile system — same persistence model as local
- Tunneled Unix socket — GUI communicates with remote daemon identically to local

**Done when:** Add `host: user@myserver.com` to your config. Open the app. First time: it installs `soload` on the remote (no npm/node required), starts the daemon, sets up tunnels. All processes start on the remote machine. All configured ports appear on `localhost`. Close the app — remote processes keep running. Reopen — reconnects and replays buffer. Second time: instant connect, no setup.

---

### Milestone 7 — CLI Depth and Agent Integration (post-launch)

The CLI becomes the full integration surface for humans, agents, and scripts.

- `soload status` — process table with state, port, health, uptime
- `soload logs <name>` — last 50 lines default, `-n` flag, `--errors` filter
- `soload search <query>` — cross-process grep, 10 matches/process cap
- `soload health` — port health table with latency
- `soload restart <name>` — restart with port health wait and confirmation
- `soload add/remove/edit` — GUI-less process definition management
- `--json` flag on all commands for scripting/CI
- All commands connect to existing daemon Unix socket — no HTTP server needed
- Agent instruction injection — daemon appends `soload` usage to CLAUDE.md on worktree creation
- Documentation: example CLAUDE.md snippet, example CI usage, example agent workflows

**Done when:** An agent spawned by the daemon runs `soload status` and gets a ~100-token stack summary. It runs `soload logs api --errors` and gets the last 20 error lines. It runs `soload restart worker` and the worker restarts and reports healthy. A human developer uses the same commands from their terminal. A CI script uses `soload status --json` to check stack health.

---

### Milestone 8 — Mobile Companion and Relay (post-launch)

- iOS app — process dashboard, log streaming, basic controls, push notifications
- Relay server — WebSocket broker, same-network direct connection, cross-network relay
- Self-hostable Docker image published
- Hosted relay as paid tier

---

### Milestone 9 — Agentic Layer (long-term, post-revenue)

Does not start until the core process manager has paying users and is stable. Full detail in Section 10.

- Agent process type in `solo.yml` — separate from infrastructure processes
- Unified worktree provisioning — daemon owns all worktree creation for every agent
- Worktree lifecycle — automated git worktree creation in `.solo/worktrees/`, env copy via setup scripts, teardown scripts, cleanup
- `soload` CLI instructions appended to CLAUDE.md on worktree creation
- Agent state detection from PTY output patterns — `⚡ waiting` badge in sidebar
- File review panel — slide-in panel when agent pane is focused, changed files list, full file view with tree-sitter syntax highlighting and inline diff blocks
- Inline annotation — select lines, type note, forwarded to agent PTY stdin with file and line context
- PR view — GitHub API integration, same diff renderer, review comment display
- Parallel agent sidebar — multiple agents with status badges
- Merge, push, and discard flow

**Done when:** Spin up three agents on three branches. Each works in its own worktree with `soload` on the PATH for stack interaction. Sidebar shows their status. Review one agent's diff, annotate a bad line, watch it correct itself. Push and open PR in browser. Merge a finished one locally.

---

## 16. Open Questions

Researched questions show a finding. Unresolved questions are noted pending decisions.

| Question | Finding / Status |
|---|---|
| **App name** | ❓ No decision. Must avoid soloterm.com and soloterm/solo (Laravel package). Both occupy the same namespace. |
| **libghostty API stability** | ⚠️ Pre-1.0, C API exists and is usable. `libghostty-spm` distributes a prebuilt xcframework as a Swift Package, removing the need to compile from Zig source. cmux (AGPL, actively maintained) is the best reference for tracking breaking changes. Acceptable risk. |
| **Daemon install UX** | ✅ The daemon is compiled to a standalone binary via `bun build --compile` — no runtime dependency. Locally, the GUI app bundles it and symlinks to `/usr/local/bin/soload` during onboarding. launchd plist written to `~/Library/LaunchAgents/` on macOS, systemd user service on Linux. |
| **SSH implementation** | ✅ **Use the system OpenSSH binary.** macOS ships `/usr/bin/ssh` on every machine. Spawn it as a subprocess with `-N` (tunnel only, no login shell), `-L` for each configured port, and a Unix socket forward for the daemon connection. This gives the user's `~/.ssh/config`, SSH agent, `known_hosts`, key management, and multiplexing for free. OpenSSH subprocess is what VS Code Remote SSH does. Example invocation: `ssh -N -o ServerAliveInterval=10 -L /tmp/solo-remote.sock:/tmp/solo-{hash}.sock -L 5173:localhost:5173 -L 3000:localhost:3000 user@host` |
| **Remote daemon bootstrap** | ✅ `curl -fsSL https://soload.dev/install | bash` — same pattern as Bun, Deno, Homebrew. Install script detects arch (`uname -m`) and OS (`uname -s`), downloads the correct compiled binary from GitHub releases, installs to `~/.local/bin/soload`. No npm/bun/node required on the remote machine. The GUI runs this automatically over SSH on first connect and shows a setup progress screen. Four binaries published per release: `darwin-x64`, `darwin-arm64`, `linux-x64`, `linux-arm64`. |
| **Buffer memory ceiling** | ✅ Default 5,000 lines per process. LRU eviction at configurable total ceiling (default 50,000 lines across all processes). Lines are counted at write time; old lines dropped from ring buffer front. At 10 processes × 5,000 lines this is roughly 25–50MB depending on average line length — acceptable. MCP endpoints hard-cap responses independently of buffer size. |
| **Syntax highlighting (Phase 2)** | ✅ **Use tree-sitter via `swift-tree-sitter`.** Lives under the official `tree-sitter` GitHub org, maintained by the tree-sitter core team, v0.9.0 released November 2024. Grammar files (`.scm` highlight queries) are just pattern matching rules — they don't bitrot regardless of binding age. JS, TS, Python, Go, Rust, CSS, HTML, JSON, YAML all have active SPM-compatible grammar packages. `Neon` (ChimeHQ) is a production macOS syntax highlighting system built on it. **Decision: use tree-sitter from day one of Phase 2.** |
| **Worktree location** | ✅ `.solo/worktrees/{agent-name}/` inside the project root, gitignored automatically. Configurable base directory in Settings (global) and per-project. Not in `/tmp/` — macOS cleans it on reboot, destroying in-progress work. Not sibling directories — pollutes parent directory with 5+ agents. Follows Superset's pattern of a configurable base with a sensible project-local default. |
| **Worktree ownership** | ✅ **Daemon owns all worktree creation for every agent.** No special-casing Claude Code's `--worktree` flag. The daemon runs `git worktree add`, runs setup scripts, copies the skill folder, then launches the agent inside the worktree. Claude Code works fine launched inside an existing worktree. This avoids two code paths, two worktree locations, and two cleanup semantics. |
| **Agent execution sandbox** | ✅ **Do not provide one.** Every coding agent already has its own bash environment. The app exposes a CLI (`soload`) that agents call like any other Unix tool. No MCP server, no scripts folder, no middleware. MCP can be added as an optional wrapper later if there's demand. |
| **Config file requirement** | ✅ **solo.yml is optional.** Config follows a three-tier model: (1) app-internal SQLite DB at `~/.solo/solo.db` (always present, GUI-managed), (2) `.solo-local.yml` (personal, gitignored, optional), (3) `solo.yml` (team-shared, committed, opt-in). A developer can open any repo, add processes through the GUI, and never touch a config file. |
| **MCP integration** | ✅ **Not in v1. Optional future layer.** Agent integration is CLI-first — agents run `soload status`, `soload logs --errors`, `soload restart` via bash. MCP can be added later as a thin HTTP wrapper around the daemon socket for structured tool discovery, but the CLI handles 100% of the use cases with zero overhead. |
| **Annotation delivery (Phase 2)** | ❓ Unresolved pending testing. Agents buffering stdin during autonomous tool-use phases may not read the annotation until they return to interactive state. Needs verification with Claude Code, Codex CLI, and Gemini CLI. Fallback: queue annotation, send after next PTY output line, show "queued" badge state. |
| **Orphan worktree cleanup (Phase 2)** | ✅ On daemon startup, run `git worktree list --porcelain` in each registered project root. Any worktree path under `.solo/worktrees/` with no daemon state entry is presented as "orphaned — remove or reconnect?" Reconnect is available for large repos where reprovisioning is expensive. `git worktree prune` handles git metadata. |
| **GitHub token scope (Phase 2)** | ✅ Request `repo` read-only for PR view. The push flow opens `github.com/compare/{branch}` in the browser — no write API call needed. Store token in Keychain only. |
| **Windows / Linux** | ✅ Not in v1 and not planned. libghostty supports Linux via OpenGL; daemon is platform-agnostic POSIX Swift. The hard blocker is AppKit + NSPanel which is macOS only. Cross-platform requires a full GUI rebuild in GTK or Tauri — a separate product decision, not an extension of this one. |

---

## 17. Architecture Overviews

Component-level diagrams for each major subsystem. These sit below the high-level four-layer diagram in Section 5 and are the reference for implementation.

### 17.1 Daemon Internal Architecture

```
soload (Bun/TypeScript binary)
│
├── ConfigResolver
│   ├── Reads ~/.solo/solo.db (internal DB, always present)
│   ├── Reads solo.yml (if exists in project root)
│   ├── Reads .solo-local.yml (if exists in project root)
│   ├── Merges: solo.yml → .solo-local.yml → internal DB → active config
│   ├── FSWatch on YAML files (if they exist), debounced 300ms
│   └── Notifies ProcessRegistry of added / removed / changed processes
│
├── ProcessRegistry
│   ├── Map<string, ManagedProcess> keyed by process name
│   ├── spawn()   node-pty: pty.spawn(command, { cwd, env })
│   ├── stop()    SIGTERM → wait 5s → SIGKILL
│   ├── pause()   SIGSTOP
│   ├── resume()  SIGCONT
│   └── exit handler → crash detection → restart queue with backoff
│       backoff: 1s 2s 4s 8s 16s 30s cap; fail-state after 5 in 30s
│
├── ManagedProcess  (one per process)
│   ├── pid: number
│   ├── ptyProcess: IPty          node-pty handle — read/write
│   ├── scrollback: RingBuffer    5,000 lines default
│   ├── errorIndex: number[]      indices of lines matching error patterns
│   ├── status: ProcessStatus
│   └── oscScanner()              scans output for OSC 9/99/777 sequences
│
├── PortHealthMonitor
│   ├── TCP connect probe per configured port, every 5 seconds
│   └── Broadcasts port_health_change on status transition
│
├── StateStore  (SQLite via better-sqlite3)
│   ├── projects:   canonical path, last opened, UI-defined processes
│   ├── processes:  name, command, port, autostart, last status, wasRunning
│   └── Flushed on clean shutdown; read on restart to respawn processes
│
├── SocketServer
│   ├── Unix domain socket at /tmp/solo-{projectHash}.sock
│   ├── Handles connections from both GUI and CLI
│   ├── Multiple simultaneous client connections
│   ├── JSON + 4-byte length-prefix framing
│   ├── On connect → send state_snapshot + last N lines per process
│   └── On output → broadcast output_chunk to all clients
│
└── Lockfile  at {project_root}/.solo.lock
    ├── { pid, socketPath, version, started }
    ├── Written on start, deleted on clean exit
    └── Stale detection: process.kill(pid, 0) catch → stale
```

### 17.2 GUI ↔ Daemon IPC

```
GUI (DaemonClient)                    Daemon (SocketServer)
──────────────────                    ─────────────────────

connect() ──────────────────────────▶
◀────────────────────── state_snapshot   all process states + N lines each

input(process, bytes) ──────────────▶   write bytes to process PTY master
◀────────────── output_chunk(process)    PTY output broadcast to all clients

start_process(name) ────────────────▶
stop_process(name) ─────────────────▶
restart_process(name) ──────────────▶
pause_process(name) ────────────────▶
resume_process(name) ───────────────▶

◀──────────── process_status(name, s)    state change broadcast
◀──────────── port_health(name, ok)      port probe result
◀──────────── notification(name, text)   OSC sequence from process output

disconnect() ───────────────────────▶   daemon continues, processes live
```

Reconnect flow: GUI retries socket connect with 100ms → 500ms → 2s backoff. On reconnect, daemon sends fresh `state_snapshot` including any crashes or state changes that occurred while disconnected.

### 17.3 SSH Tunnel Architecture  (Milestone 6)

```
Local Mac                                     Remote Machine
─────────────────────────────                 ─────────────────────
GUI App                                       soload (remote daemon)
│                                             │
│  ProcessManager spawns:                     │
│  /usr/bin/ssh                               │
│    -N                                       │  no login shell
│    -o ServerAliveInterval=10                │  fast dead-connection detection
│    -o ServerAliveCountMax=3                 │
│    -L /tmp/solo-remote.sock:                │
│       /tmp/solo-{hash}.sock   ─────────────▶│  daemon socket forward
│    -L 5173:localhost:5173     ─────────────▶│  frontend port
│    -L 3000:localhost:3000     ─────────────▶│  api port
│    -L 4983:localhost:4983     ─────────────▶│  db studio port
│    user@host                                │
│                                             │
│  DaemonClient.connect(                      │
│    "/tmp/solo-remote.sock")   ─────────────▶│  identical to local IPC
│                                             │
│  localhost:5173 in browser    ─────────────▶│  frontend dev server
│  localhost:3000 from agent    ─────────────▶│  api server

SSH process is owned by daemon, not GUI.
On GUI disconnect: tunnel stays alive, daemon and processes continue.
On GUI reconnect: DaemonClient reconnects to existing forwarded socket.
On network drop: ServerAlive flags cause ssh subprocess to exit,
    daemon detects subprocess exit, retries ssh with backoff.
```

**Remote bootstrap (first connect):**
```
1. ssh exec: which soload
   ├── found → skip to step 4
   └── not found → continue
2. ssh exec: curl -fsSL https://soload.dev/install | bash
   install script detects uname -m (x86_64 / aarch64) + uname -s (Linux / Darwin)
   downloads soload-{os}-{arch} from GitHub releases
   installs to ~/.local/bin/soload, adds to PATH
   GUI streams this output as a setup progress screen
3. ssh exec: soload --version  (verify install)
4. ssh exec: soload init --project /path/to/repo  (start daemon if not running)
5. Subsequent connects: find running daemon via lockfile, skip steps 1-4
```

### 17.4 libghostty Integration Architecture

```
NSWindow / NSPanel  (AppKit — owns the window, controls level and behavior)
└── NSHostingView  (bridges AppKit window to SwiftUI content)
    ├── SidebarView (SwiftUI)
    │   └── ProcessRowView × N  (status dot, name, port badge, notification ring)
    │
    └── TerminalContainerView (NSViewRepresentable — wraps AppKit NSView for SwiftUI)
        └── surfaces: [String: GhosttyNSView]   one per process, all alive
            │
            ├── GhosttyNSView  (NSView subclass)
            │   ├── CAMetalLayer          libghostty renders into this
            │   ├── ghostty_surface_t     one per process
            │   ├── isHidden = true/false  switching is O(1) show/hide
            │   ├── Keyboard → ghostty_surface_key() → daemon socket → PTY stdin
            │   ├── Mouse   → ghostty_surface_mouse_*()
            │   ├── Resize  → ghostty_surface_set_size() + daemon TIOCSWINSZ
            │   └── NSTextInputClient     CJK / emoji / dead-key composition
            │
            └── switchTo(name):
                    currentSurface.isHidden = true
                    surfaces[name].isHidden = false
                    surfaces[name].becomeFirstResponder()

Output routing (all surfaces receive output regardless of visibility):
    DaemonClient receives output_chunk(processName, bytes)
    → ghostty_surface_write(surfaces[processName], bytes)
    → libghostty VT-parses and updates Metal render state
    → next CADisplayLink tick renders frame (only if surface is visible)
```

**Resource bundle** — Ghostty walks up from the executable path looking for `terminfo/78/xterm-ghostty` as a sentinel. The app copies Ghostty's resource tree into `Contents/Resources/ghostty/` at build time via a build phase script, so the sentinel is always found. Shell integration scripts are included in the same bundle, enabling Starship and OSC integration without any user configuration.

### 17.5 Persistence State Machine

```
                    ┌─────────────────────────────────┐
                    │        launchd (login)           │
                    │  reads ~/Library/LaunchAgents/   │
                    │  com.yourapp.soload.plist        │
                    └──────────────┬──────────────────┘
                                   │ spawn soload
                                   ▼
                    ┌─────────────────────────────────┐
          ┌────────▶│     Daemon: reading state        │
          │         │  ~/.solo/state/{id}.json         │
          │         │  respawn wasRunning processes     │
          │         └──────────────┬──────────────────┘
          │                        │ processes running
          │                        ▼
          │         ┌─────────────────────────────────┐
          │         │      Daemon: running             │◀──── GUI connects
          │         │  accepting socket connections    │────▶ GUI disconnects
          │         │  PTYs alive, buffers in memory   │      (daemon stays)
          │         └──────────────┬──────────────────┘
          │                        │
          │              ┌─────────┴──────────┐
          │              │                    │
          │         SIGTERM               machine sleep
          │         (user quit)           (no action, OS suspends)
          │              │                    │
          │              ▼                wake
          │   ┌──────────────────────┐         │
          │   │  Daemon: shutting    │         │ (processes may have died
          │   │  flush state.json    │         │  if sleep was long — SIGCHLD
          │   │  delete lockfile     │         │  fires on wake, handled normally)
          └───│  exit                │
              └──────────────────────┘
```

### 17.6 Worktree and File Review Architecture  (Phase 2)

#### Design principle

The daemon owns all worktree creation for every agent. Unlike the previous version of this doc which special-cased Claude Code's `--worktree` flag, this architecture treats all agents identically: the daemon creates the worktree, runs setup, copies skills, and launches the agent inside it. Claude Code works fine when launched inside a pre-existing worktree — it detects the git context automatically.

This avoids two code paths, two worktree locations, two cleanup semantics, and the confusion of letting one agent manage its own worktree while the daemon manages others.

#### solo.yml agent configuration

```yaml
agents:
  feature-auth:
    command: claude
    task: "implement JWT auth in src/auth/"
    setup:
      - "cp $SOLO_ROOT/.env .env"
      - "bun install"
    teardown:
      - "docker compose down"

  fix-login:
    command: codex
    task: "fix the login redirect bug in src/pages/login.tsx"
    setup:
      - "cp $SOLO_ROOT/.env .env"
      - "npm install"

  research:
    command: claude
    worktree: false    # no isolation, runs in main repo
```

`$SOLO_ROOT` is an env var the daemon injects pointing to the main repo root. `$SOLO_MCP_PORT` is injected with the MCP server port.

#### Agent launch sequence

```
user clicks "Start agent" for feature-auth
│
├── daemon runs:
│   git worktree add .solo/worktrees/feature-auth -b solo/feature-auth
│
├── daemon runs setup[] commands sequentially in worktree CWD:
│   SOLO_ROOT=/path/to/project
│   SOLO_MCP_PORT=7842
│   cp $SOLO_ROOT/.env .env
│   bun install
│
├── daemon spawns agent process in worktree CWD:
│   cd .solo/worktrees/feature-auth
│   claude   # soload is already on PATH, agent uses it via bash
│
└── if task: is defined:
    daemon sends task string to agent PTY stdin after process starts
```

First use: the daemon adds `.solo/worktrees/` to `.gitignore` automatically.

#### Watching the worktree

The daemon watches the worktree path using `FSEventStream` (same as config watching). On any file change:

```
FSEventStream fires
└── daemon runs: git diff main...HEAD --name-only  (in worktreePath)
    └── broadcasts worktree_changed(agentName, changedFiles[]) to GUI
        └── FileReviewPanel updates changed files list
```

This gives the file review panel a live, updating list of changed files as the agent works — not a snapshot you have to manually refresh.

#### File review panel — data flow

```
GUI — FileReviewPanel
│
├── Changed files list (live, FSEvent-driven):
│   git -C {worktreePath} diff main...HEAD --name-status
│   → sorted by most recently modified
│
├── Per-file view (on file selection):
│   ├── Full content:  read {worktreePath}/{file}
│   ├── Diff:          git -C {worktreePath} diff main...HEAD -- {file}
│   └── Merge into DiffLine[]:
│       ├── .unchanged(text, lineNum)   syntax highlighted via tree-sitter
│       ├── .added(text, lineNum)       green left border + background tint
│       └── .removed(text)             red left border + tint, shown inline
│
├── Annotation flow:
│   ├── user selects lines → popover
│   ├── user types note → Enter
│   └── DaemonClient.send(input:
│           "[Review — {file} lines {start}–{end}]:\n{note}\n",
│           to: agentName)
│       → daemon writes to agent PTY stdin
│
└── Summary bar:
    {branch}  ·  {N} files changed  ·  +{adds}  −{dels}
    [Discard]  [Open in Zed]  [Push & Create PR]  [Merge locally]
```

#### Agent exit handling

When the agent process exits (clean finish, crash, or user stop):

```
agent process exits
│
├── daemon runs teardown[] commands in worktreePath (if configured)
│
├── daemon checks: git -C {worktreePath} status --porcelain
│
├── No changes:
│   └── daemon runs: git worktree remove {worktreePath}
│       daemon runs: git branch -d solo/{agent-name}
│       GUI: agent moves to "finished" state, entry removed
│
└── Changes exist:
    └── daemon broadcasts worktree_finished(agentName, hasChanges: true)
        GUI: agent moves to "review" state with yellow badge
        FileReviewPanel stays open for review
        User action required: Merge, Discard, or Open in editor
```

#### Merge, push, and discard

```
[Merge locally]:
    git -C {project_root} merge solo/{branch}
    IF no conflict: git worktree remove {worktreePath}
                    git branch -d solo/{branch}
    IF conflict:    "Open in Zed/VS Code" passes worktreePath to editor
                    (defer resolution to the editor the user knows)

[Push & Create PR]:
    git -C {worktreePath} push origin solo/{branch}
    open "https://github.com/{owner}/{repo}/compare/solo/{branch}"
    (PR creation stays in GitHub, app does not build a PR form)

[Discard]:
    confirmation dialog if changes exist
    git worktree remove {worktreePath} --force
    git branch -D solo/{branch}
```

#### PR view (after push, via GitHub API)

```
Poll: GET /repos/{owner}/{repo}/pulls?head=solo/{branch}&state=open
      (triggered on push, then every 30s while review panel is open)

On PR found:
    GET /repos/{owner}/{repo}/pulls/{number}/files
    → same DiffLine[] pipeline, same renderer
    → review comments shown as annotation badges on affected lines
    → panel header shows PR number, title, CI status
```

#### Orphan cleanup

On daemon startup, run `git worktree list --porcelain` in each registered project root. Any worktree path under `.solo/worktrees/` with no corresponding agent entry in daemon state is presented to the user as "orphaned — remove or keep?" `git worktree prune` handles the git metadata side. The daemon handles the state side.

### 17.7 CLI Architecture  (Milestone 7)

```
soload CLI (same Bun/TypeScript package as daemon)
│
├── Connection
│   ├── Reads lockfile at {cwd}/.solo.lock (walks up directory tree)
│   ├── Connects to Unix socket at socketPath from lockfile
│   └── If no daemon found → error: "No Solo daemon running. Run soload init"
│
├── Commands → Socket Messages
│   ├── soload status          → { type: "get_status" }
│   │   ← { processes: [{ name, status, port, healthy, uptime, restarts }] }
│   │   Renders as table or JSON (--json)
│   │
│   ├── soload status <name>   → { type: "get_status", name }
│   │   ← { name, status, pid, port, healthy, uptime, restarts, lastError }
│   │
│   ├── soload logs <name>     → { type: "get_logs", name, lines: 50, filter: null }
│   │   ← { name, lines: string[] }
│   │   Flags: -n <count> (max 200), --errors (filter error/warning/fatal)
│   │
│   ├── soload search <query>  → { type: "search_logs", query, process: null, limit: 10 }
│   │   ← { matches: [{ process, line }] }
│   │   Optional: soload search <query> <process>
│   │
│   ├── soload health          → { type: "get_health" }
│   │   ← { ports: [{ process, port, healthy, latencyMs }] }
│   │
│   ├── soload start <name>    → { type: "start_process", name }
│   ├── soload stop <name>     → { type: "stop_process", name }
│   ├── soload restart <name>  → { type: "restart_process", name }
│   │   restart waits for port health before reporting
│   │
│   ├── soload add <name> <cmd> → writes to SQLite, notifies daemon to reload
│   │   Flags: --port, --autostart, --restart-on-crash
│   ├── soload remove <name>    → writes to SQLite, stops process, notifies daemon
│   └── soload edit <name>      → writes to SQLite, notifies daemon
│
├── Output
│   ├── Default: human-readable tables/text (like docker ps, git status)
│   ├── --json: structured JSON for scripting
│   └── Exit codes: 0 success, 1 error, 2 daemon not found
│
└── Agent integration (Phase 2)
    Daemon appends to CLAUDE.md / .codex/instructions.md on worktree creation:
    "Run `soload status` to check processes.
     Run `soload logs <n> --errors` to see errors.
     Run `soload restart <n>` to fix a crashed service."
    ~30 tokens. Agent uses soload like any other CLI tool via bash.
```

The CLI and GUI are peers — both connect to the same daemon socket, both see the same state. A developer can use the GUI to monitor visually and the CLI to act quickly from a terminal. An agent uses the CLI exclusively. All three share one daemon, one socket, one source of truth.