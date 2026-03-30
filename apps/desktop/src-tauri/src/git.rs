use crate::database::now_iso8601;
use crate::models::*;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Clone)]
pub struct ResolvedProject {
    pub selected_path: String,
    pub git_root_path: String,
    pub git_context_subpath: Option<String>,
    pub display_name: String,
    pub git_remote_owner: Option<String>,
}

pub fn resolve_project(selected_path: &str) -> Result<ResolvedProject, String> {
    let canonical = std::fs::canonicalize(selected_path)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| selected_path.to_string());

    let git_root = run_git(&["-C", &canonical, "rev-parse", "--show-toplevel"])?
        .trim()
        .to_string();

    if git_root.is_empty() {
        return Err("The selected folder is not inside a Git repository.".into());
    }

    let normalized_root = std::fs::canonicalize(&git_root)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| git_root.clone());

    let context_subpath = if canonical == normalized_root {
        None
    } else if canonical.starts_with(&format!("{}/", normalized_root)) {
        Some(canonical[normalized_root.len() + 1..].to_string())
    } else {
        None
    };

    let display_name = Path::new(&canonical)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "project".into());

    let remote_owner = resolve_remote_owner(&normalized_root);

    Ok(ResolvedProject {
        selected_path: canonical,
        git_root_path: normalized_root,
        git_context_subpath: context_subpath,
        display_name,
        git_remote_owner: remote_owner,
    })
}

pub fn resolve_remote_owner(git_root_path: &str) -> Option<String> {
    // Try origin URL
    if let Ok(url) = run_git(&["-C", git_root_path, "config", "--get", "remote.origin.url"]) {
        if let Some(owner) = parse_github_owner(url.trim()) {
            return Some(owner);
        }
    }

    // Try remote -v
    if let Ok(remotes) = run_git(&["-C", git_root_path, "remote", "-v"]) {
        for line in remotes.lines() {
            if let Some(owner) = parse_github_owner(line) {
                return Some(owner);
            }
        }
    }

    // Try git email
    if let Ok(email) = run_git(&["-C", git_root_path, "config", "--get", "user.email"]) {
        let email = email.trim();
        if let Some(local) = email.split('@').next() {
            if !local.is_empty() {
                return Some(slugify(local));
            }
        }
    }

    // Try git user.name
    if let Ok(name) = run_git(&["-C", git_root_path, "config", "--get", "user.name"]) {
        let name = name.trim();
        if !name.is_empty() {
            return Some(slugify(name));
        }
    }

    None
}

fn parse_github_owner(text: &str) -> Option<String> {
    for line in text.lines() {
        let line = line.trim();
        if !line.contains("github.com") {
            continue;
        }
        // SSH: github.com:owner/repo
        if let Some(pos) = line.find("github.com:") {
            let after = &line[pos + 11..];
            let repo_path = after.split_whitespace().next().unwrap_or(after);
            if let Some(owner) = repo_path.split('/').next() {
                let s = slugify(owner);
                if !s.is_empty() {
                    return Some(s);
                }
            }
        }
        // HTTPS: github.com/owner/repo
        if let Some(pos) = line.find("github.com/") {
            let after = &line[pos + 11..];
            let repo_path = after.split_whitespace().next().unwrap_or(after);
            if let Some(owner) = repo_path.split('/').next() {
                let s = slugify(owner);
                if !s.is_empty() {
                    return Some(s);
                }
            }
        }
    }
    None
}

fn slugify(raw: &str) -> String {
    let lower = raw.to_lowercase();
    let slugged: String = lower
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c
            } else {
                '-'
            }
        })
        .collect();
    // Collapse multiple dashes
    let mut result = String::new();
    let mut prev_dash = false;
    for c in slugged.chars() {
        if c == '-' {
            if !prev_dash {
                result.push(c);
            }
            prev_dash = true;
        } else {
            result.push(c);
            prev_dash = false;
        }
    }
    result.trim_matches('-').to_string()
}

fn generate_slug() -> String {
    use rand::Rng;
    let chars: Vec<char> = "abcdefghijklmnopqrstuvwxyz0123456789".chars().collect();
    let mut rng = rand::thread_rng();
    (0..8).map(|_| chars[rng.gen_range(0..chars.len())]).collect()
}

pub fn pandora_home() -> String {
    if let Ok(home) = std::env::var("PANDORA_HOME") {
        if !home.is_empty() {
            return home;
        }
    }
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
    format!("{}/.pandora", home)
}

pub fn worktree_path(project_id: &str, owner: &str, slug: &str) -> String {
    PathBuf::from(pandora_home())
        .join("workspaces")
        .join(project_id)
        .join(owner)
        .join(slug)
        .to_string_lossy()
        .to_string()
}

pub fn make_optimistic_workspace(
    project: &ProjectRecord,
    existing_count: usize,
) -> WorkspaceRecord {
    let owner = resolve_remote_owner(&project.git_root_path).unwrap_or_else(|| "workspace".into());
    let slug = generate_slug();
    let branch = format!("{}/{}", owner, slug);
    let wt_path = worktree_path(&project.id, &owner, &slug);
    let now = now_iso8601();

    WorkspaceRecord {
        id: uuid::Uuid::new_v4().to_string(),
        project_id: project.id.clone(),
        name: format!("Workspace {}", existing_count + 1),
        git_branch_name: branch,
        git_worktree_owner: owner,
        git_worktree_slug: slug,
        worktree_path: wt_path,
        workspace_context_subpath: project.git_context_subpath.clone(),
        status: WorkspaceStatus::Creating,
        failure_message: None,
        created_at: now.clone(),
        updated_at: now,
        last_opened_at: None,
    }
}

pub fn create_worktree(
    workspace: &WorkspaceRecord,
    project: &ProjectRecord,
) -> Result<WorkspaceRecord, String> {
    run_git(&[
        "-C",
        &project.git_root_path,
        "worktree",
        "add",
        "-b",
        &workspace.git_branch_name,
        &workspace.worktree_path,
    ])?;

    let mut ready = workspace.clone();
    ready.status = WorkspaceStatus::Ready;
    ready.failure_message = None;
    ready.updated_at = now_iso8601();
    Ok(ready)
}

pub fn retry_worktree(
    workspace: &WorkspaceRecord,
    project: &ProjectRecord,
) -> Result<WorkspaceRecord, String> {
    // Remove partial leftovers
    let _ = std::fs::remove_dir_all(&workspace.worktree_path);

    let slug = generate_slug();
    let owner = &workspace.git_worktree_owner;
    let new_path = worktree_path(&project.id, owner, &slug);
    let new_branch = format!("{}/{}", owner, slug);

    run_git(&[
        "-C",
        &project.git_root_path,
        "worktree",
        "add",
        "-b",
        &new_branch,
        &new_path,
    ])?;

    let mut refreshed = workspace.clone();
    refreshed.git_branch_name = new_branch;
    refreshed.git_worktree_slug = slug;
    refreshed.worktree_path = new_path;
    refreshed.status = WorkspaceStatus::Ready;
    refreshed.failure_message = None;
    refreshed.updated_at = now_iso8601();
    Ok(refreshed)
}

pub fn remove_worktree(
    workspace: &WorkspaceRecord,
    project: &ProjectRecord,
) -> Result<(), String> {
    let _ = run_git(&[
        "-C",
        &project.git_root_path,
        "worktree",
        "remove",
        "--force",
        &workspace.worktree_path,
    ]);
    let _ = std::fs::remove_dir_all(&workspace.worktree_path);
    Ok(())
}

fn run_git(args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .args(args)
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr)
            .trim()
            .to_string();
        return Err(if stderr.is_empty() {
            "Git command failed".into()
        } else {
            stderr
        });
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}
