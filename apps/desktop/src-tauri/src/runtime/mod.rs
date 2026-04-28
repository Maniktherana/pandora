//! In-process terminal runtime: PTY lifecycle, output batching, restart
//! policy, port detection, and the wire types the renderer consumes.
//!
//! Module map:
//!
//! ```text
//!   types          — Wire enums (RuntimeCommand / RuntimeEvent) + helpers.
//!                    Wire shape is preserved across the renderer boundary.
//!   agent_signal   — Pure-function vendor signal → AgentActivityState.
//!   pty            — portable-pty wrapper (spawn / read / write / signal).
//!   port_manager   — lsof-based per-session listening-port scanner.
//!   seed           — Idempotent dormant-terminal seeding for new runtimes.
//!   process_manager— Session lifecycle, restart policy, output coalescing.
//!   registry       — Runtime + RuntimeRegistry (per-workspace top-level
//!                    facades; each Runtime owns one ProcessManager).
//! ```
//!
//! [`crate::runtime_ipc`] is the renderer-facing IPC boundary for commands
//! and runtime events.

pub mod agent_signal;
pub mod editor_io;
pub mod file_tree;
pub mod port_manager;
pub mod process_manager;
pub mod pty;
pub mod registry;
pub mod scm;
pub mod seed;
pub mod types;
