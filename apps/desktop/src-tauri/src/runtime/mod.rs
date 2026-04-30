//! Domain registry modules.
//!
//! Module map:
//!
//! ```text
//!   types        — Wire enums (IpcCommand / ScopeEvent / ScopeEventEnvelope)
//!                  and state carriers. Wire shape is preserved across the
//!                  renderer boundary.
//!   terminal/    — ProcessManager, PTY, port detection, seeding, TerminalRegistry.
//!   file_tree/   — FileTreeService + FileTreeRegistry.
//!   scm/         — ScmService + ScmRegistry.
//!   editor_io/   — EditorIoService + EditorIoRegistry.
//! ```
//!
//! [`crate::runtime_ipc`] is the renderer-facing IPC boundary that holds all
//! four domain registries as Tauri state and routes incoming `IpcCommand`s.

pub mod editor_io;
pub mod file_tree;
pub mod scm;
pub mod terminal;
pub mod types;
