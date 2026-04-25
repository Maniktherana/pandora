use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum WorkspaceStatus {
    #[serde(rename = "creating")]
    Creating,
    #[serde(rename = "ready")]
    Ready,
    #[serde(rename = "failed")]
    Failed,
    #[serde(rename = "deleting")]
    Deleting,
    #[serde(rename = "archived")]
    Archived,
}

impl WorkspaceStatus {
    pub fn as_str(&self) -> &str {
        match self {
            Self::Creating => "creating",
            Self::Ready => "ready",
            Self::Failed => "failed",
            Self::Deleting => "deleting",
            Self::Archived => "archived",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "creating" => Some(Self::Creating),
            "ready" => Some(Self::Ready),
            "failed" => Some(Self::Failed),
            "deleting" => Some(Self::Deleting),
            "archived" => Some(Self::Archived),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum WorkspaceKind {
    #[serde(rename = "linked")]
    Linked,
    #[default]
    #[serde(rename = "worktree")]
    Worktree,
}

impl WorkspaceKind {
    pub fn as_str(&self) -> &str {
        match self {
            Self::Linked => "linked",
            Self::Worktree => "worktree",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "linked" => Some(Self::Linked),
            "worktree" => Some(Self::Worktree),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRecord {
    pub id: String,
    pub display_path: String,
    pub git_root_path: String,
    pub git_context_subpath: Option<String>,
    pub display_name: String,
    pub git_remote_owner: Option<String>,
    pub is_expanded: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRecord {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub git_branch_name: String,
    pub git_worktree_owner: String,
    pub git_worktree_slug: String,
    pub worktree_path: String,
    pub workspace_context_subpath: Option<String>,
    #[serde(default)]
    pub workspace_kind: WorkspaceKind,
    pub status: WorkspaceStatus,
    pub failure_message: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub last_opened_at: Option<String>,
    pub pr_url: Option<String>,
    pub pr_number: Option<i64>,
    pub pr_state: Option<String>,
    pub deleting_at: Option<String>,
    pub created_by_pandora: bool,
    pub target_branch: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckRun {
    pub name: String,
    pub status: String,
    pub conclusion: Option<String>,
    pub html_url: String,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorInfo {
    pub id: String,
    pub display_name: String,
    pub category: String, // "finder", "ide", "terminal"
}

// ---------------------------------------------------------------------------
// Runtime models: slot / session definitions + supporting enums.
//
// Runtime models: slot / session definitions + supporting enums.
// Field renames preserve the camelCase-with-uppercase-ID style
// (slotID, primarySessionDefID, sessionDefIDs) the renderer expects rather
// than serde's stock camelCase (slotId, primarySessionDefId, …).
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SlotKind {
    ProcessSlot,
    AgentSlot,
    TerminalSlot,
}

impl SlotKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::ProcessSlot => "process_slot",
            Self::AgentSlot => "agent_slot",
            Self::TerminalSlot => "terminal_slot",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "process_slot" => Some(Self::ProcessSlot),
            "agent_slot" => Some(Self::AgentSlot),
            "terminal_slot" => Some(Self::TerminalSlot),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionKind {
    Process,
    Agent,
    Terminal,
}

impl SessionKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Process => "process",
            Self::Agent => "agent",
            Self::Terminal => "terminal",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "process" => Some(Self::Process),
            "agent" => Some(Self::Agent),
            "terminal" => Some(Self::Terminal),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PresentationMode {
    Single,
    Tabs,
    Split,
}

impl PresentationMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Single => "single",
            Self::Tabs => "tabs",
            Self::Split => "split",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "single" => Some(Self::Single),
            "tabs" => Some(Self::Tabs),
            "split" => Some(Self::Split),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RestartPolicy {
    Manual,
    Always,
}

impl RestartPolicy {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Manual => "manual",
            Self::Always => "always",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "manual" => Some(Self::Manual),
            "always" => Some(Self::Always),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SlotDefinition {
    pub id: String,
    pub kind: SlotKind,
    pub name: String,
    pub autostart: bool,
    pub presentation_mode: PresentationMode,
    #[serde(rename = "primarySessionDefID")]
    pub primary_session_def_id: Option<String>,
    /// Populated by the DB layer (joined from `session_definitions`); never
    /// stored directly on the slot row.
    #[serde(rename = "sessionDefIDs", default)]
    pub session_def_ids: Vec<String>,
    pub persisted: bool,
    pub sort_order: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionDefinition {
    pub id: String,
    #[serde(rename = "slotID")]
    pub slot_id: String,
    pub kind: SessionKind,
    pub name: String,
    pub command: String,
    pub cwd: Option<String>,
    pub port: Option<i64>,
    pub env_overrides: std::collections::BTreeMap<String, String>,
    pub restart_policy: RestartPolicy,
    pub pause_supported: bool,
    pub resume_supported: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSettingsRow {
    pub project_id: String,
    pub default_branch: String,
    pub worktree_root: Option<String>,
    pub setup_scripts: String,    // JSON array string
    pub run_scripts: String,      // JSON array string
    pub teardown_scripts: String, // JSON array string
    pub env_vars: String,         // JSON object string
    pub auto_run_setup: bool,
    pub updated_at: String,
}
