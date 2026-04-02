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
}
