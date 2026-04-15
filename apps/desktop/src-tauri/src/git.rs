use crate::database::now_iso8601;
use crate::models::*;
use rand::seq::SliceRandom;
use std::collections::BTreeSet;
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
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
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

const WORKTREE_NAMES: &[&str] = &[
    "achilles",
    "aether",
    "aphrodite",
    "apollo",
    "ares",
    "artemis",
    "asclepius",
    "asteria",
    "astraeus",
    "atalanta",
    "athena",
    "atlas",
    "bellerophon",
    "chaos",
    "coeus",
    "crius",
    "cronus",
    "demeter",
    "deucalion",
    "dione",
    "dionysus",
    "eos",
    "epimetheus",
    "erebus",
    "eris",
    "eros",
    "gaia",
    "hades",
    "hebe",
    "hecate",
    "helios",
    "hephaestus",
    "hera",
    "heracles",
    "hermes",
    "hestia",
    "hippolyta",
    "hyperion",
    "hypnos",
    "iapetus",
    "iris",
    "leto",
    "metis",
    "mnemosyne",
    "nemesis",
    "nike",
    "nyx",
    "oceanus",
    "orpheus",
    "pallas",
    "pan",
    "persephone",
    "perseus",
    "phoebe",
    "pontus",
    "poseidon",
    "prometheus",
    "rhea",
    "selene",
    "tartarus",
    "tethys",
    "thanatos",
    "theia",
    "themis",
    "theseus",
    "triton",
    "uranus",
    "zeus",
];

#[derive(Debug, Clone, PartialEq, Eq)]
struct WorkspaceIdentity {
    name: String,
    slug: String,
}

fn build_workspace_name(parts: &[&str]) -> String {
    parts.join(" ")
}

fn build_workspace_slug(parts: &[&str]) -> String {
    parts.join("-")
}

fn build_branch_name(owner: &str, slug: &str) -> String {
    if owner.trim().is_empty() {
        slug.to_string()
    } else {
        format!("{owner}/{slug}")
    }
}

fn normalize_branch_prefix(raw: &str) -> String {
    raw.trim()
        .trim_matches('/')
        .split('/')
        .map(slugify)
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("/")
}

fn display_path_slug(raw: &str, fallback: &str) -> String {
    let slug = slugify(raw);
    if slug.is_empty() {
        fallback.to_string()
    } else {
        slug
    }
}

fn existing_workspace_names(existing_workspaces: &[WorkspaceRecord]) -> BTreeSet<String> {
    existing_workspaces
        .iter()
        .map(|workspace| workspace.name.trim().to_lowercase())
        .collect()
}

fn pick_workspace_name_part<'a, R: rand::Rng + ?Sized>(
    rng: &mut R,
    current_parts: &[&'a str],
) -> &'a str {
    let mut available_parts: Vec<&str> = WORKTREE_NAMES
        .iter()
        .copied()
        .filter(|candidate| !current_parts.contains(candidate))
        .collect();
    if available_parts.is_empty() {
        available_parts = WORKTREE_NAMES.to_vec();
    }
    available_parts
        .choose(rng)
        .copied()
        .unwrap_or(WORKTREE_NAMES[0])
}

fn select_workspace_identity<R, F>(
    rng: &mut R,
    taken_names: &BTreeSet<String>,
    mut slug_available: F,
) -> WorkspaceIdentity
where
    R: rand::Rng + ?Sized,
    F: FnMut(&str) -> bool,
{
    let mut parts = vec![pick_workspace_name_part(rng, &[])];
    loop {
        let name = build_workspace_name(&parts);
        let slug = build_workspace_slug(&parts);
        if !taken_names.contains(&name) && slug_available(&slug) {
            return WorkspaceIdentity { name, slug };
        }
        parts.push(pick_workspace_name_part(rng, &parts));
    }
}

fn local_branch_exists(git_root_path: &str, branch: &str) -> bool {
    Command::new("git")
        .args([
            "-C",
            git_root_path,
            "show-ref",
            "--verify",
            "--quiet",
            &format!("refs/heads/{}", branch),
        ])
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn generate_linked_workspace_identity(
    existing_workspaces: &[WorkspaceRecord],
) -> WorkspaceIdentity {
    let mut rng = rand::thread_rng();
    let taken_names = existing_workspace_names(existing_workspaces);
    let taken_slugs: BTreeSet<String> = existing_workspaces
        .iter()
        .map(|workspace| workspace.git_worktree_slug.clone())
        .collect();

    select_workspace_identity(&mut rng, &taken_names, |slug| !taken_slugs.contains(slug))
}

fn generate_worktree_identity(
    project: &ProjectRecord,
    owner: &str,
    settings: Option<&ProjectSettingsRow>,
    existing_workspaces: &[WorkspaceRecord],
) -> WorkspaceIdentity {
    let mut rng = rand::thread_rng();
    let taken_names = existing_workspace_names(existing_workspaces);
    let taken_slugs: BTreeSet<String> = existing_workspaces
        .iter()
        .map(|workspace| workspace.git_worktree_slug.clone())
        .collect();

    select_workspace_identity(&mut rng, &taken_names, |slug| {
        if taken_slugs.contains(slug) {
            return false;
        }
        if Path::new(&worktree_path(project, slug, settings)).exists() {
            return false;
        }
        let branch = build_branch_name(owner, slug);
        !local_branch_exists(&project.git_root_path, &branch)
    })
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

fn expand_home(path: &str) -> PathBuf {
    if path == "~" {
        return user_home();
    }
    if let Some(rest) = path.strip_prefix("~/") {
        return user_home().join(rest);
    }
    PathBuf::from(path)
}

fn user_home() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| "/tmp".into()))
}

fn worktree_root(settings: Option<&ProjectSettingsRow>) -> PathBuf {
    if let Some(root) = settings
        .and_then(|settings| settings.worktree_root.as_deref())
        .map(str::trim)
        .filter(|root| !root.is_empty())
    {
        return expand_home(root);
    }

    user_home().join("workspaces")
}

pub fn worktree_path(
    project: &ProjectRecord,
    slug: &str,
    settings: Option<&ProjectSettingsRow>,
) -> String {
    worktree_root(settings)
        .join(display_path_slug(&project.display_name, "project"))
        .join(display_path_slug(slug, "workspace"))
        .to_string_lossy()
        .to_string()
}

fn unique_slug_for_rename(
    project: &ProjectRecord,
    workspace: &WorkspaceRecord,
    requested_name: &str,
    settings: Option<&ProjectSettingsRow>,
    existing_workspaces: &[WorkspaceRecord],
) -> String {
    let base = display_path_slug(requested_name, "workspace");
    let taken_slugs: BTreeSet<String> = existing_workspaces
        .iter()
        .filter(|entry| entry.id != workspace.id)
        .map(|entry| entry.git_worktree_slug.clone())
        .collect();

    for suffix in 0..10_000 {
        let candidate = if suffix == 0 {
            base.clone()
        } else {
            format!("{base}-{suffix}")
        };
        if taken_slugs.contains(&candidate) {
            continue;
        }
        let candidate_path = worktree_path(project, &candidate, settings);
        if Path::new(&candidate_path).exists() && candidate_path != workspace.worktree_path {
            continue;
        }
        let candidate_branch = build_branch_name(&workspace.git_worktree_owner, &candidate);
        if candidate_branch != workspace.git_branch_name
            && local_branch_exists(&project.git_root_path, &candidate_branch)
        {
            continue;
        }
        return candidate;
    }

    format!("{base}-{}", uuid::Uuid::new_v4())
}

pub fn current_branch(git_root_path: &str) -> Result<String, String> {
    let b = run_git(&["-C", git_root_path, "rev-parse", "--abbrev-ref", "HEAD"])?
        .trim()
        .to_string();
    if b.is_empty() {
        return Err("Could not resolve current branch".into());
    }
    Ok(b)
}

/// Linked workspace: uses the project git checkout at `git_root_path` (no `git worktree add`).
pub fn make_linked_workspace(
    project: &ProjectRecord,
    existing_workspaces: &[WorkspaceRecord],
) -> Result<WorkspaceRecord, String> {
    let branch = current_branch(&project.git_root_path)?;
    let target_branch = default_branch(&project.git_root_path);
    let identity = generate_linked_workspace_identity(existing_workspaces);
    let now = now_iso8601();

    Ok(WorkspaceRecord {
        id: uuid::Uuid::new_v4().to_string(),
        project_id: project.id.clone(),
        name: identity.name,
        git_branch_name: branch,
        git_worktree_owner: "linked".into(),
        git_worktree_slug: identity.slug,
        worktree_path: project.git_root_path.clone(),
        workspace_context_subpath: project.git_context_subpath.clone(),
        workspace_kind: WorkspaceKind::Linked,
        status: WorkspaceStatus::Ready,
        failure_message: None,
        created_at: now.clone(),
        updated_at: now,
        last_opened_at: None,
        pr_url: None,
        pr_number: None,
        pr_state: None,
        deleting_at: None,
        created_by_pandora: true,
        target_branch: Some(target_branch),
    })
}

pub fn make_optimistic_workspace(
    project: &ProjectRecord,
    settings: Option<&ProjectSettingsRow>,
    existing_workspaces: &[WorkspaceRecord],
    branch_prefix: Option<String>,
) -> Result<WorkspaceRecord, String> {
    let owner = branch_prefix
        .map(|prefix| normalize_branch_prefix(&prefix))
        .unwrap_or_else(|| resolve_remote_owner(&project.git_root_path).unwrap_or_default());
    let identity = generate_worktree_identity(project, &owner, settings, existing_workspaces);
    let branch = build_branch_name(&owner, &identity.slug);
    let target_branch = current_branch(&project.git_root_path).ok();
    let wt_path = worktree_path(project, &identity.slug, settings);
    let now = now_iso8601();

    Ok(WorkspaceRecord {
        id: uuid::Uuid::new_v4().to_string(),
        project_id: project.id.clone(),
        name: identity.name,
        git_branch_name: branch,
        git_worktree_owner: owner,
        git_worktree_slug: identity.slug,
        worktree_path: wt_path,
        workspace_context_subpath: project.git_context_subpath.clone(),
        workspace_kind: WorkspaceKind::Worktree,
        status: WorkspaceStatus::Creating,
        failure_message: None,
        created_at: now.clone(),
        updated_at: now,
        last_opened_at: None,
        pr_url: None,
        pr_number: None,
        pr_state: None,
        deleting_at: None,
        created_by_pandora: true,
        target_branch,
    })
}

pub fn create_worktree(
    workspace: &WorkspaceRecord,
    project: &ProjectRecord,
) -> Result<WorkspaceRecord, String> {
    if let Some(parent) = Path::new(&workspace.worktree_path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

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
    settings: Option<&ProjectSettingsRow>,
    existing_workspaces: &[WorkspaceRecord],
) -> Result<WorkspaceRecord, String> {
    if workspace.workspace_kind != WorkspaceKind::Worktree {
        return Err("Only worktree workspaces can be retried.".into());
    }
    // Remove partial leftovers
    let _ = std::fs::remove_dir_all(&workspace.worktree_path);

    let owner = &workspace.git_worktree_owner;
    let identity = generate_worktree_identity(project, owner, settings, existing_workspaces);
    let new_path = worktree_path(project, &identity.slug, settings);
    let new_branch = build_branch_name(owner, &identity.slug);
    if let Some(parent) = Path::new(&new_path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

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
    refreshed.name = identity.name;
    refreshed.workspace_kind = WorkspaceKind::Worktree;
    refreshed.git_branch_name = new_branch;
    refreshed.git_worktree_slug = identity.slug;
    refreshed.worktree_path = new_path;
    refreshed.status = WorkspaceStatus::Ready;
    refreshed.failure_message = None;
    refreshed.updated_at = now_iso8601();
    Ok(refreshed)
}

pub fn rename_workspace(
    workspace: &WorkspaceRecord,
    project: &ProjectRecord,
    settings: Option<&ProjectSettingsRow>,
    existing_workspaces: &[WorkspaceRecord],
    new_name: &str,
) -> Result<WorkspaceRecord, String> {
    let normalized_name = new_name.trim();
    if normalized_name.is_empty() {
        return Err("Workspace name cannot be empty.".into());
    }

    let mut renamed = workspace.clone();
    let new_slug = unique_slug_for_rename(
        project,
        workspace,
        normalized_name,
        settings,
        existing_workspaces,
    );

    if workspace.workspace_kind == WorkspaceKind::Worktree {
        let new_path = worktree_path(project, &new_slug, settings);
        let new_branch = build_branch_name(&workspace.git_worktree_owner, &new_slug);
        let current_branch = current_branch(&workspace.worktree_path)?;
        if new_branch != current_branch && local_branch_exists(&project.git_root_path, &new_branch)
        {
            return Err(format!(
                "Cannot rename workspace because branch '{new_branch}' already exists."
            ));
        }

        let mut moved_path = false;
        if workspace.worktree_path != new_path {
            if !Path::new(&workspace.worktree_path).exists() {
                return Err(format!(
                    "Cannot rename worktree because the path does not exist: {}",
                    workspace.worktree_path
                ));
            }
            if let Some(parent) = Path::new(&new_path).parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            run_git(&[
                "-C",
                &project.git_root_path,
                "worktree",
                "move",
                &workspace.worktree_path,
                &new_path,
            ])?;
            renamed.worktree_path = new_path;
            moved_path = true;
        }

        if new_branch != current_branch {
            if let Err(error) =
                run_git(&["-C", &renamed.worktree_path, "branch", "-m", &new_branch])
            {
                if moved_path {
                    let _ = run_git(&[
                        "-C",
                        &project.git_root_path,
                        "worktree",
                        "move",
                        &renamed.worktree_path,
                        &workspace.worktree_path,
                    ]);
                }
                return Err(error);
            }
        }

        renamed.git_branch_name = new_branch;
    }

    renamed.name = normalized_name.to_string();
    renamed.git_worktree_slug = new_slug;
    renamed.updated_at = now_iso8601();
    Ok(renamed)
}

pub fn remove_worktree(workspace: &WorkspaceRecord, project: &ProjectRecord) -> Result<(), String> {
    if workspace.workspace_kind == WorkspaceKind::Linked {
        return Ok(());
    }

    // Safety: refuse to delete worktrees not created by pandora.
    if !workspace.created_by_pandora {
        return Err(format!(
            "Refusing to delete worktree '{}': not created by Pandora",
            workspace.worktree_path
        ));
    }

    let wt = std::path::Path::new(&workspace.worktree_path);
    if !wt.exists() {
        // Already gone — just prune stale git metadata.
        let _ = run_git(&["-C", &project.git_root_path, "worktree", "prune"]);
        return Ok(());
    }

    // Non-blocking removal: rename to a temp sibling, then prune, then background rm.
    let parent = wt
        .parent()
        .ok_or_else(|| "Cannot determine parent directory for worktree".to_string())?;
    let temp_name = format!(".pandora-delete-{}", uuid::Uuid::new_v4());
    let temp_path = parent.join(&temp_name);

    match std::fs::rename(wt, &temp_path) {
        Ok(()) => {
            // Prune git worktree metadata (fast, no disk IO on the tree itself).
            let _ = run_git(&["-C", &project.git_root_path, "worktree", "prune"]);

            // Background rm — non-blocking.
            let temp_str = temp_path.to_string_lossy().into_owned();
            std::thread::spawn(move || {
                let _ = std::process::Command::new("/bin/rm")
                    .args(["-rf", &temp_str])
                    .stdout(std::process::Stdio::null())
                    .stderr(std::process::Stdio::null())
                    .status();
            });
            Ok(())
        }
        Err(e) if e.raw_os_error() == Some(18 /* EXDEV */) => {
            // Cross-filesystem: fall back to synchronous removal.
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
        Err(e) => {
            // Rename failed for another reason — fall back.
            eprintln!(
                "Worktree rename failed ({}), falling back to synchronous removal",
                e
            );
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
    }
}

fn run_git_in_dir(worktree_path: &str, args: &[&str]) -> Result<String, String> {
    let mut git_args = Vec::with_capacity(args.len() + 2);
    git_args.push("-C");
    git_args.push(worktree_path);
    git_args.extend_from_slice(args);
    run_git(&git_args)
}

fn remote_ref_exists(worktree_path: &str, remote_ref: &str) -> bool {
    let ref_name = format!("refs/remotes/{remote_ref}");
    run_git_in_dir(worktree_path, &["rev-parse", "--verify", &ref_name]).is_ok()
}

fn branch_upstream(worktree_path: &str, branch: &str) -> Option<String> {
    let upstream_spec = format!("{branch}@{{u}}");
    run_git_in_dir(
        worktree_path,
        &[
            "rev-parse",
            "--abbrev-ref",
            "--symbolic-full-name",
            &upstream_spec,
        ],
    )
    .ok()
    .map(|out| out.trim().to_string())
    .filter(|out| !out.is_empty())
}

fn restore_source_ref(worktree_path: &str, branch: &str) -> Result<String, String> {
    let _ = run_git_in_dir(worktree_path, &["fetch", "--all", "--prune"]);
    if let Some(upstream) = branch_upstream(worktree_path, branch) {
        if remote_ref_exists(worktree_path, &upstream) {
            return Ok(upstream);
        }
    }

    let origin_ref = format!("origin/{branch}");
    if remote_ref_exists(worktree_path, &origin_ref) {
        return Ok(origin_ref);
    }

    Err(format!("Push branch '{branch}' before archiving."))
}

pub fn archive_safety(workspace: &WorkspaceRecord, _project: &ProjectRecord) -> ArchiveSafety {
    if workspace.workspace_kind == WorkspaceKind::Linked {
        return ArchiveSafety {
            can_archive: true,
            message: None,
            has_uncommitted_changes: false,
            has_untracked_files: false,
            has_unpushed_commits: false,
            has_remote_branch: true,
        };
    }

    if !workspace.created_by_pandora {
        return ArchiveSafety {
            can_archive: false,
            message: Some("Pandora can only archive worktrees it created.".into()),
            has_uncommitted_changes: false,
            has_untracked_files: false,
            has_unpushed_commits: false,
            has_remote_branch: false,
        };
    }

    let status = run_git_in_dir(
        &workspace.worktree_path,
        &["status", "--porcelain=v1", "--untracked-files=all"],
    )
    .unwrap_or_default();
    let has_untracked_files = status.lines().any(|line| line.starts_with("??"));
    let has_uncommitted_changes = status.lines().any(|line| !line.starts_with("??"));
    if has_uncommitted_changes || has_untracked_files {
        return ArchiveSafety {
            can_archive: false,
            message: Some("Commit, discard, or stash changes before archiving.".into()),
            has_uncommitted_changes,
            has_untracked_files,
            has_unpushed_commits: false,
            has_remote_branch: false,
        };
    }

    let branch =
        current_branch(&workspace.worktree_path).unwrap_or_else(|_| workspace.git_branch_name.clone());
    if branch != workspace.git_branch_name {
        return ArchiveSafety {
            can_archive: false,
            message: Some(format!(
                "Workspace is on branch '{branch}', but Pandora expected '{}'. Rename or refresh the workspace before archiving.",
                workspace.git_branch_name
            )),
            has_uncommitted_changes: false,
            has_untracked_files: false,
            has_unpushed_commits: false,
            has_remote_branch: false,
        };
    }
    let remote_ref = match restore_source_ref(&workspace.worktree_path, &branch) {
        Ok(remote_ref) => remote_ref,
        Err(message) => {
            return ArchiveSafety {
                can_archive: false,
                message: Some(message),
                has_uncommitted_changes: false,
                has_untracked_files: false,
                has_unpushed_commits: false,
                has_remote_branch: false,
            };
        }
    };

    let ahead = run_git_in_dir(
        &workspace.worktree_path,
        &["rev-list", "--count", &format!("{remote_ref}..HEAD")],
    )
    .ok()
    .and_then(|out| out.trim().parse::<u64>().ok())
    .unwrap_or(0);
    if ahead > 0 {
        return ArchiveSafety {
            can_archive: false,
            message: Some("Push commits before archiving.".into()),
            has_uncommitted_changes: false,
            has_untracked_files: false,
            has_unpushed_commits: true,
            has_remote_branch: true,
        };
    }

    ArchiveSafety {
        can_archive: true,
        message: None,
        has_uncommitted_changes: false,
        has_untracked_files: false,
        has_unpushed_commits: false,
        has_remote_branch: true,
    }
}

pub fn recreate_worktree_from_remote(
    workspace: &WorkspaceRecord,
    project: &ProjectRecord,
) -> Result<(), String> {
    if let Some(parent) = Path::new(&workspace.worktree_path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let source_ref = restore_source_ref(&project.git_root_path, &workspace.git_branch_name)?;
    if local_branch_exists(&project.git_root_path, &workspace.git_branch_name) {
        run_git(&[
            "-C",
            &project.git_root_path,
            "worktree",
            "add",
            &workspace.worktree_path,
            &workspace.git_branch_name,
        ])?;
        run_git(&[
            "-C",
            &workspace.worktree_path,
            "merge",
            "--ff-only",
            &source_ref,
        ])?;
    } else {
        run_git(&[
            "-C",
            &project.git_root_path,
            "worktree",
            "add",
            "-b",
            &workspace.git_branch_name,
            &workspace.worktree_path,
            &source_ref,
        ])?;
    }
    Ok(())
}

fn run_git(args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .args(args)
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "Git command failed".into()
        } else {
            stderr
        });
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn run_git_without_optional_locks(args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .args(args)
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "Git command failed".into()
        } else {
            stderr
        });
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Max bytes returned for `scm_git_diff` (avoids huge binary / generated blobs in the UI).
pub const SCM_DIFF_MAX_BYTES: usize = 512 * 1024;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScmDiffResult {
    pub diff: String,
    pub truncated: bool,
}

/// Reject absolute paths and `..` segments (paths are relative to the workspace / git work tree).
pub fn sanitize_repo_relative_path(path: &str) -> Result<(), String> {
    let p = Path::new(path);
    if p.is_absolute() {
        return Err("Path must be relative to the workspace".into());
    }
    for c in p.components() {
        if matches!(c, std::path::Component::ParentDir) {
            return Err("Invalid path".into());
        }
        if matches!(c, std::path::Component::RootDir) {
            return Err("Invalid path".into());
        }
    }
    Ok(())
}

fn run_git_stdout_bytes(args: &[&str]) -> Result<Vec<u8>, String> {
    let output = Command::new("git")
        .args(args)
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "Git command failed".into()
        } else {
            stderr
        });
    }

    Ok(output.stdout)
}

fn truncate_utf8_bytes(bytes: &[u8], max: usize) -> (String, bool) {
    if bytes.len() <= max {
        return (String::from_utf8_lossy(bytes).to_string(), false);
    }
    let mut end = max;
    while end > 0 && (bytes[end - 1] & 0b1100_0000) == 0b1000_0000 {
        end -= 1;
    }
    (String::from_utf8_lossy(&bytes[..end]).to_string(), true)
}

fn run_git_diff_limited(args: &[&str], max_bytes: usize) -> Result<ScmDiffResult, String> {
    let stdout = run_git_stdout_bytes(args)?;
    let (diff, truncated) = truncate_utf8_bytes(&stdout, max_bytes);
    Ok(ScmDiffResult { diff, truncated })
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::SeedableRng;

    #[test]
    fn select_workspace_identity_returns_lowercase_single_name_when_available() {
        let mut rng = rand::rngs::StdRng::seed_from_u64(7);
        let identity = select_workspace_identity(&mut rng, &BTreeSet::new(), |_| true);

        assert_eq!(identity.name, identity.name.to_lowercase());
        assert_eq!(identity.slug, identity.slug.to_lowercase());
        assert!(!identity.name.contains(' '));
        assert_eq!(identity.slug, identity.name);
    }

    #[test]
    fn select_workspace_identity_appends_another_name_when_all_single_names_are_taken() {
        let mut rng = rand::rngs::StdRng::seed_from_u64(13);
        let taken_names = WORKTREE_NAMES
            .iter()
            .map(|name| (*name).to_string())
            .collect::<BTreeSet<_>>();

        let identity = select_workspace_identity(&mut rng, &taken_names, |_| true);

        assert!(identity.name.contains(' '));
        assert!(identity.slug.contains('-'));
        assert_eq!(identity.slug, identity.name.replace(' ', "-"));
        assert!(!taken_names.contains(&identity.name));
    }
}

/// `git diff` for a single path under `worktree_path`. `staged` uses `--cached`.
/// Untracked files (working only): `git diff --no-index` against an empty tree ref.
pub fn git_file_diff(
    worktree_path: &str,
    relative_path: &str,
    staged: bool,
) -> Result<ScmDiffResult, String> {
    sanitize_repo_relative_path(relative_path)?;
    let wt = Path::new(worktree_path);
    if !wt.is_dir() {
        return Err("Workspace path is not a directory".into());
    }

    if staged {
        return run_git_diff_limited(
            &["-C", worktree_path, "diff", "--cached", "--", relative_path],
            SCM_DIFF_MAX_BYTES,
        );
    }

    let unstaged = run_git_diff_limited(
        &["-C", worktree_path, "diff", "--", relative_path],
        SCM_DIFF_MAX_BYTES,
    )?;
    if !unstaged.diff.is_empty() {
        return Ok(unstaged);
    }

    // Tracked file with no unstaged changes → empty diff is correct.
    let tracked = Command::new("git")
        .args([
            "-C",
            worktree_path,
            "ls-files",
            "--error-unmatch",
            "--",
            relative_path,
        ])
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;
    if tracked.status.success() {
        return Ok(unstaged);
    }

    let full_path = wt.join(relative_path);
    if !full_path.is_file() {
        return Ok(unstaged);
    }

    #[cfg(unix)]
    let empty_ref: &str = "/dev/null";
    #[cfg(not(unix))]
    let empty_ref: &str = "NUL";

    run_git_diff_limited(
        &[
            "-C",
            worktree_path,
            "diff",
            "--no-index",
            "--",
            empty_ref,
            relative_path,
        ],
        SCM_DIFF_MAX_BYTES,
    )
}

// ─── SCM status / index (porcelain v1) ───

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScmStatusEntry {
    pub path: String,
    pub orig_path: Option<String>,
    pub staged_kind: Option<String>,
    pub worktree_kind: Option<String>,
    pub untracked: bool,
}

#[derive(Debug, Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScmLineStats {
    pub added: u64,
    pub removed: u64,
}

#[derive(Debug, Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScmPathLineStats {
    pub path: String,
    pub added: u64,
    pub removed: u64,
}

#[derive(Debug, Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScmBranchChange {
    pub path: String,
    pub orig_path: Option<String>,
    pub staged_kind: Option<String>,
    pub worktree_kind: Option<String>,
    pub untracked: bool,
    pub added: u64,
    pub removed: u64,
}

#[derive(Debug, Clone)]
pub struct ArchiveSafety {
    pub can_archive: bool,
    pub message: Option<String>,
    pub has_uncommitted_changes: bool,
    pub has_untracked_files: bool,
    pub has_unpushed_commits: bool,
    pub has_remote_branch: bool,
}

const EMPTY_TREE_SHA: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

fn parse_numstat(raw: &str) -> ScmLineStats {
    let mut stats = ScmLineStats::default();
    for line in raw.lines() {
        let mut parts = line.splitn(3, '\t');
        let Some(added) = parts.next() else {
            continue;
        };
        let Some(removed) = parts.next() else {
            continue;
        };
        if let Ok(value) = added.parse::<u64>() {
            stats.added += value;
        }
        if let Ok(value) = removed.parse::<u64>() {
            stats.removed += value;
        }
    }
    stats
}

fn parse_numstat_by_path(raw: &str) -> Vec<ScmPathLineStats> {
    let mut stats = Vec::new();
    for line in raw.lines() {
        let mut parts = line.splitn(3, '\t');
        let Some(added) = parts.next() else {
            continue;
        };
        let Some(removed) = parts.next() else {
            continue;
        };
        let Some(path) = parts.next() else {
            continue;
        };

        let added = added.parse::<u64>().unwrap_or(0);
        let removed = removed.parse::<u64>().unwrap_or(0);
        let path = path.rsplit('\t').next().unwrap_or(path).to_string();
        stats.push(ScmPathLineStats {
            path,
            added,
            removed,
        });
    }
    stats
}

fn count_text_lines(path: &Path) -> u64 {
    let Ok(bytes) = std::fs::read(path) else {
        return 0;
    };
    if bytes.is_empty() || bytes.contains(&0) {
        return 0;
    }
    let newline_count = bytes.iter().filter(|&&byte| byte == b'\n').count() as u64;
    if bytes.last() == Some(&b'\n') {
        newline_count
    } else {
        newline_count + 1
    }
}

fn count_untracked_added_lines(worktree_path: &str) -> Result<u64, String> {
    let output = Command::new("git")
        .args([
            "-C",
            worktree_path,
            "ls-files",
            "--others",
            "--exclude-standard",
            "-z",
        ])
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "Git command failed".into()
        } else {
            stderr
        });
    }

    let mut added = 0;
    for raw_path in output.stdout.split(|byte| *byte == 0) {
        if raw_path.is_empty() {
            continue;
        }
        let relative_path = String::from_utf8_lossy(raw_path);
        let full_path = Path::new(worktree_path).join(relative_path.as_ref());
        if !full_path.is_file() {
            continue;
        }
        added += count_text_lines(&full_path);
    }

    Ok(added)
}

pub fn git_line_stats(worktree_path: &str) -> Result<ScmLineStats, String> {
    verify_git_worktree(worktree_path)?;

    let diff_base = if run_git(&["-C", worktree_path, "rev-parse", "--verify", "HEAD"]).is_ok() {
        "HEAD"
    } else {
        EMPTY_TREE_SHA
    };

    let mut stats = parse_numstat(
        &run_git(&["-C", worktree_path, "diff", "--numstat", diff_base, "--"]).unwrap_or_default(),
    );
    stats.added += count_untracked_added_lines(worktree_path)?;
    Ok(stats)
}

pub fn git_path_line_stats(
    worktree_path: &str,
    relative_path: &str,
    staged: bool,
) -> Result<ScmLineStats, String> {
    verify_git_worktree(worktree_path)?;
    sanitize_repo_relative_path(relative_path)?;

    if staged {
        return Ok(parse_numstat(
            &run_git(&[
                "-C",
                worktree_path,
                "diff",
                "--cached",
                "--numstat",
                "--",
                relative_path,
            ])
            .unwrap_or_default(),
        ));
    }

    let stats = parse_numstat(
        &run_git(&[
            "-C",
            worktree_path,
            "diff",
            "--numstat",
            "--",
            relative_path,
        ])
        .unwrap_or_default(),
    );
    if stats.added > 0 || stats.removed > 0 {
        return Ok(stats);
    }

    let tracked = Command::new("git")
        .args([
            "-C",
            worktree_path,
            "ls-files",
            "--error-unmatch",
            "--",
            relative_path,
        ])
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;
    if tracked.status.success() {
        return Ok(stats);
    }

    let full_path = Path::new(worktree_path).join(relative_path);
    if !full_path.is_file() {
        return Ok(stats);
    }

    Ok(ScmLineStats {
        added: count_text_lines(&full_path),
        removed: 0,
    })
}

pub fn git_path_line_stats_bulk(
    worktree_path: &str,
    relative_paths: &[String],
    staged: bool,
    untracked_paths: &[String],
) -> Result<Vec<ScmPathLineStats>, String> {
    verify_git_worktree(worktree_path)?;
    for path in relative_paths {
        sanitize_repo_relative_path(path)?;
    }
    for path in untracked_paths {
        sanitize_repo_relative_path(path)?;
    }

    if relative_paths.is_empty() && untracked_paths.is_empty() {
        return Ok(Vec::new());
    }

    let mut results = if relative_paths.is_empty() {
        Vec::new()
    } else {
        let mut args = vec!["-C", worktree_path, "diff"];
        if staged {
            args.push("--cached");
        }
        args.push("--numstat");
        args.push("--");
        for path in relative_paths {
            args.push(path.as_str());
        }
        parse_numstat_by_path(&run_git(&args).unwrap_or_default())
    };

    if !staged {
        for path in untracked_paths {
            let full_path = Path::new(worktree_path).join(path);
            if !full_path.is_file() {
                continue;
            }
            results.push(ScmPathLineStats {
                path: path.clone(),
                added: count_text_lines(&full_path),
                removed: 0,
            });
        }
    }

    Ok(results)
}

pub fn git_branch_changes(
    worktree_path: &str,
    target_branch: &str,
) -> Result<Vec<ScmBranchChange>, String> {
    verify_git_worktree(worktree_path)?;
    let base_ref = compare_ref_for_branch(worktree_path, target_branch);
    let range = format!("{base_ref}...HEAD");

    let name_status = run_git(&[
        "-C",
        worktree_path,
        "-c",
        "core.quotepath=false",
        "diff",
        "--name-status",
        "-M",
        &range,
        "--",
    ])
    .unwrap_or_default();

    let stats = parse_numstat_by_path(
        &run_git(&["-C", worktree_path, "diff", "--numstat", &range, "--"]).unwrap_or_default(),
    );
    let stats_by_path: std::collections::HashMap<String, ScmPathLineStats> = stats
        .into_iter()
        .map(|stat| (stat.path.clone(), stat))
        .collect();

    let mut changes = Vec::new();
    for line in name_status.lines() {
        let mut parts = line.split('\t');
        let Some(status_raw) = parts.next() else {
            continue;
        };
        let status = status_raw.chars().next().unwrap_or('M').to_string();
        let (orig_path, path) = if status_raw.starts_with('R') || status_raw.starts_with('C') {
            let Some(orig) = parts.next() else {
                continue;
            };
            let Some(path) = parts.next() else {
                continue;
            };
            (Some(orig.to_string()), path.to_string())
        } else {
            let Some(path) = parts.next() else {
                continue;
            };
            (None, path.to_string())
        };
        let stat = stats_by_path.get(&path);
        changes.push(ScmBranchChange {
            path,
            orig_path,
            staged_kind: Some(status),
            worktree_kind: None,
            untracked: false,
            added: stat.map(|s| s.added).unwrap_or(0),
            removed: stat.map(|s| s.removed).unwrap_or(0),
        });
    }
    Ok(changes)
}

fn dequote_git_path(raw: &str) -> String {
    let s = raw.trim();
    if !(s.starts_with('"') && s.ends_with('"') && s.len() >= 2) {
        return s.to_string();
    }
    let inner = &s[1..s.len() - 1];
    let mut out = String::with_capacity(inner.len());
    let mut it = inner.chars();
    while let Some(c) = it.next() {
        if c == '\\' {
            match it.next() {
                Some('n') => out.push('\n'),
                Some('t') => out.push('\t'),
                Some('"') => out.push('"'),
                Some('\\') => out.push('\\'),
                Some(o) => out.push(o),
                None => {}
            }
        } else {
            out.push(c);
        }
    }
    out
}

fn parse_porcelain_status_line(line: &str) -> Option<ScmStatusEntry> {
    let line = line.trim_end();
    if line.is_empty() {
        return None;
    }
    if line.starts_with("!!") {
        return None;
    }
    if line.starts_with("??") {
        if line.len() < 4 {
            return None;
        }
        let path = dequote_git_path(&line[3..]);
        return Some(ScmStatusEntry {
            path,
            orig_path: None,
            staged_kind: None,
            worktree_kind: Some("?".into()),
            untracked: true,
        });
    }
    let chars: Vec<char> = line.chars().collect();
    if chars.len() < 3 {
        return None;
    }
    let x = chars[0];
    let y = chars[1];
    let sep = chars[2];
    if sep != ' ' && sep != '\t' {
        return None;
    }
    let rest: String = chars[3..].iter().collect();
    let rest = rest.trim_start();
    if rest.is_empty() {
        return None;
    }

    let (orig_path, path) = if let Some((a, b)) = rest.split_once('\t') {
        (Some(dequote_git_path(a)), dequote_git_path(b))
    } else {
        (None, dequote_git_path(rest))
    };

    let staged_kind = if x != ' ' { Some(x.to_string()) } else { None };
    let worktree_kind = if y != ' ' { Some(y.to_string()) } else { None };

    Some(ScmStatusEntry {
        path,
        orig_path,
        staged_kind,
        worktree_kind,
        untracked: false,
    })
}

fn verify_git_worktree(worktree_path: &str) -> Result<(), String> {
    let wt = Path::new(worktree_path);
    if !wt.is_dir() {
        return Err("Workspace path is not a directory".into());
    }
    let inside = Command::new("git")
        .args(["-C", worktree_path, "rev-parse", "--is-inside-work-tree"])
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;
    if !inside.status.success() {
        return Err("Not a git repository".into());
    }
    Ok(())
}

/// Max bytes loaded for diff viewer panes (aligned with workspace text editor cap).
pub const SCM_DIFF_VIEW_MAX_BYTES: usize = 4 * 1024 * 1024;

/// Read a UTF-8 text blob via `git show <object_spec>` (`HEAD:path` or `:path` for stage-0 index).
/// Returns an empty string when the object does not exist (e.g. file not yet in `HEAD`).
pub fn git_read_blob_text(worktree_path: &str, object_spec: &str) -> Result<String, String> {
    verify_git_worktree(worktree_path)?;
    let exists = Command::new("git")
        .args(["-C", worktree_path, "cat-file", "-e", object_spec])
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;
    if !exists.status.success() {
        return Ok(String::new());
    }
    let output = Command::new("git")
        .args(["-C", worktree_path, "show", object_spec])
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "git show failed".into()
        } else {
            stderr
        });
    }
    let bytes = output.stdout;
    if bytes.len() > SCM_DIFF_VIEW_MAX_BYTES {
        return Err(format!(
            "File is too large for the diff viewer (max {} MB)",
            SCM_DIFF_VIEW_MAX_BYTES / (1024 * 1024)
        ));
    }
    String::from_utf8(bytes)
        .map_err(|_| "File is binary or not valid UTF-8 — use the terminal for a raw diff".into())
}

pub fn git_compare_blob_text(
    worktree_path: &str,
    relative_path: &str,
    target_branch: &str,
    side: &str,
) -> Result<String, String> {
    sanitize_repo_relative_path(relative_path)?;
    let object_ref = match side {
        "base" => compare_ref_for_branch(worktree_path, target_branch),
        "head" => "HEAD".to_string(),
        _ => return Err(r#"Invalid side: use "base" or "head""#.into()),
    };
    git_read_blob_text(worktree_path, &format!("{object_ref}:{relative_path}"))
}

pub fn git_status(worktree_path: &str) -> Result<Vec<ScmStatusEntry>, String> {
    verify_git_worktree(worktree_path)?;
    // Always enumerate files inside untracked dirs. Without this, `status.showUntrackedFiles=normal`
    // (a common default / user setting) yields a single `?? folder/` line — the Changes UI would show
    // one row per folder instead of per file.
    let out = run_git_without_optional_locks(&[
        "-C",
        worktree_path,
        "-c",
        "core.quotepath=false",
        "status",
        "--porcelain=v1",
        "--untracked-files=all",
    ])?;
    let mut entries = Vec::new();
    for line in out.lines() {
        if let Some(e) = parse_porcelain_status_line(line) {
            entries.push(e);
        }
    }
    Ok(entries)
}

fn git_cmd_result(mut cmd: Command) -> Result<(), String> {
    let output = cmd
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "Git command failed".into()
        } else {
            stderr
        });
    }
    Ok(())
}

pub fn git_add_paths(worktree_path: &str, paths: &[String]) -> Result<(), String> {
    verify_git_worktree(worktree_path)?;
    if paths.is_empty() {
        return Ok(());
    }
    for p in paths {
        sanitize_repo_relative_path(p)?;
    }
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(worktree_path).arg("add").arg("--");
    for p in paths {
        cmd.arg(p);
    }
    git_cmd_result(cmd)
}

pub fn git_add_all(worktree_path: &str) -> Result<(), String> {
    verify_git_worktree(worktree_path)?;
    run_git(&["-C", worktree_path, "add", "-A"])?;
    Ok(())
}

pub fn git_restore_staged_paths(worktree_path: &str, paths: &[String]) -> Result<(), String> {
    verify_git_worktree(worktree_path)?;
    if paths.is_empty() {
        return Ok(());
    }
    for p in paths {
        sanitize_repo_relative_path(p)?;
    }
    let mut cmd = Command::new("git");
    cmd.arg("-C")
        .arg(worktree_path)
        .args(["restore", "--staged", "--"]);
    for p in paths {
        cmd.arg(p);
    }
    git_cmd_result(cmd)
}

pub fn git_restore_staged_all(worktree_path: &str) -> Result<(), String> {
    verify_git_worktree(worktree_path)?;
    run_git(&["-C", worktree_path, "restore", "--staged", "."])?;
    Ok(())
}

pub fn git_restore_worktree_path(worktree_path: &str, path: &str) -> Result<(), String> {
    verify_git_worktree(worktree_path)?;
    sanitize_repo_relative_path(path)?;
    run_git(&["-C", worktree_path, "restore", "--", path])?;
    Ok(())
}

pub fn git_clean_untracked_path(worktree_path: &str, path: &str) -> Result<(), String> {
    verify_git_worktree(worktree_path)?;
    sanitize_repo_relative_path(path)?;
    run_git(&["-C", worktree_path, "clean", "-fd", "--", path])?;
    Ok(())
}

// ─── PR context ───

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrContext {
    pub branch_name: String,
    pub base_branch: String,
    pub commit_log: String,
    pub diff_stat: String,
    pub is_default_branch: bool,
    pub has_commits: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HeaderBranchContext {
    pub owner: Option<String>,
    pub current_branch: String,
    pub default_target_branch: String,
    pub available_branches: Vec<String>,
}

/// Determine the default branch (main or master) for a repository.
fn default_branch(worktree_path: &str) -> String {
    // Check remote HEAD first
    if let Ok(out) = run_git(&[
        "-C",
        worktree_path,
        "symbolic-ref",
        "refs/remotes/origin/HEAD",
    ]) {
        let trimmed = out.trim();
        if let Some(branch) = trimmed.strip_prefix("refs/remotes/origin/") {
            return branch.to_string();
        }
    }
    // Fallback: check common local defaults, then the current branch.
    if run_git(&[
        "-C",
        worktree_path,
        "rev-parse",
        "--verify",
        "refs/heads/main",
    ])
    .is_ok()
    {
        return "main".into();
    }
    if run_git(&[
        "-C",
        worktree_path,
        "rev-parse",
        "--verify",
        "refs/heads/master",
    ])
    .is_ok()
    {
        return "master".into();
    }
    current_branch(worktree_path).unwrap_or_else(|_| "main".into())
}

fn normalize_target_branch(raw: &str) -> Option<String> {
    let branch = normalize_branch_name(raw)?;
    if branch == "origin" {
        return None;
    }
    Some(branch)
}

fn compare_ref_for_branch(worktree_path: &str, branch: &str) -> String {
    let normalized =
        normalize_target_branch(branch).unwrap_or_else(|| default_branch(worktree_path));
    let remote_ref = format!("refs/remotes/origin/{normalized}");
    if run_git(&["-C", worktree_path, "rev-parse", "--verify", &remote_ref]).is_ok() {
        return format!("origin/{normalized}");
    }
    normalized
}

fn normalize_branch_name(raw: &str) -> Option<String> {
    let branch = raw.trim();
    if branch.is_empty() || branch == "HEAD" || branch == "origin/HEAD" {
        return None;
    }
    let branch = branch.strip_prefix("origin/").unwrap_or(branch).trim();
    if branch.is_empty() || branch == "HEAD" {
        return None;
    }
    Some(branch.to_string())
}

fn list_available_branches(
    worktree_path: &str,
    default_target_branch: &str,
) -> Result<Vec<String>, String> {
    verify_git_worktree(worktree_path)?;

    let mut branches = BTreeSet::new();

    let local_refs = run_git(&[
        "-C",
        worktree_path,
        "for-each-ref",
        "refs/heads",
        "--format=%(refname:short)",
    ])?;
    for branch in local_refs.lines().filter_map(normalize_branch_name) {
        branches.insert(branch);
    }

    let remote_refs = run_git(&[
        "-C",
        worktree_path,
        "for-each-ref",
        "refs/remotes/origin",
        "--format=%(refname:short)",
    ])
    .unwrap_or_default();
    for branch in remote_refs.lines().filter_map(normalize_branch_name) {
        branches.insert(branch);
    }

    if !default_target_branch.trim().is_empty() {
        branches.insert(default_target_branch.trim().to_string());
    }

    Ok(branches.into_iter().collect())
}

pub fn gather_pr_context(
    worktree_path: &str,
    target_branch: Option<String>,
) -> Result<PrContext, String> {
    verify_git_worktree(worktree_path)?;
    let branch_name = current_branch(worktree_path)?;
    let base_branch = target_branch
        .as_deref()
        .and_then(normalize_target_branch)
        .unwrap_or_else(|| default_branch(worktree_path));
    let base_ref = compare_ref_for_branch(worktree_path, &base_branch);
    let is_default_branch = branch_name == base_branch;

    let commit_log = run_git(&[
        "-C",
        worktree_path,
        "log",
        &format!("{}..HEAD", base_ref),
        "--oneline",
    ])
    .unwrap_or_default()
    .trim()
    .to_string();

    let has_commits = !commit_log.is_empty();

    let diff_stat = run_git(&[
        "-C",
        worktree_path,
        "diff",
        &format!("{}...HEAD", base_ref),
        "--stat",
        "--stat-count=50",
    ])
    .unwrap_or_default()
    .trim()
    .to_string();

    Ok(PrContext {
        branch_name,
        base_branch,
        commit_log,
        diff_stat,
        is_default_branch,
        has_commits,
    })
}

pub fn gather_header_branch_context(
    worktree_path: &str,
    owner: Option<String>,
    target_branch: Option<String>,
) -> Result<HeaderBranchContext, String> {
    verify_git_worktree(worktree_path)?;
    let current_branch = current_branch(worktree_path)?;
    let default_target_branch = target_branch
        .as_deref()
        .and_then(normalize_target_branch)
        .unwrap_or_else(|| default_branch(worktree_path));
    let available_branches = list_available_branches(worktree_path, &default_target_branch)?;

    Ok(HeaderBranchContext {
        owner,
        current_branch,
        default_target_branch,
        available_branches,
    })
}

/// Check whether `gh` CLI is available on PATH.
pub fn gh_cli_available() -> bool {
    Command::new("gh")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GhPrInfo {
    pub state: String,
}

/// Query the PR state via `gh pr view`.
pub fn gh_pr_status(worktree_path: &str, pr_number: i64) -> Result<GhPrInfo, String> {
    let output = Command::new("gh")
        .args([
            "pr",
            "view",
            &pr_number.to_string(),
            "--json",
            "state",
            "-q",
            ".state",
        ])
        .current_dir(worktree_path)
        .output()
        .map_err(|e| format!("Failed to run gh: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(stderr);
    }

    let state = String::from_utf8_lossy(&output.stdout)
        .trim()
        .to_lowercase();
    Ok(GhPrInfo { state })
}

pub fn git_push(worktree_path: &str) -> Result<String, String> {
    verify_git_worktree(worktree_path)?;
    run_git(&["-C", worktree_path, "push", "-u", "origin", "HEAD"])
}

pub fn git_fetch(worktree_path: &str) -> Result<String, String> {
    verify_git_worktree(worktree_path)?;
    run_git(&["-C", worktree_path, "fetch"])
}

pub fn git_pull(worktree_path: &str) -> Result<String, String> {
    verify_git_worktree(worktree_path)?;
    run_git(&["-C", worktree_path, "pull"])
}

pub fn check_runs(worktree_path: &str) -> Result<Vec<CheckRun>, String> {
    verify_git_worktree(worktree_path)?;

    // Get HEAD sha
    let sha = run_git(&["-C", worktree_path, "rev-parse", "HEAD"])?
        .trim()
        .to_string();
    if sha.is_empty() {
        return Err("Could not determine HEAD commit".into());
    }

    // Get remote URL
    let remote_url = run_git(&["-C", worktree_path, "remote", "get-url", "origin"])?
        .trim()
        .to_string();
    if remote_url.is_empty() {
        return Err("No origin remote configured".into());
    }

    // Parse owner/repo from URL
    let (owner, repo) = parse_owner_repo(&remote_url)?;

    // Run gh api
    let output = Command::new("gh")
        .args([
            "api",
            &format!("repos/{owner}/{repo}/commits/{sha}/check-runs"),
        ])
        .current_dir(worktree_path)
        .output()
        .map_err(|e| format!("Failed to run gh: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "gh api call failed".into()
        } else {
            stderr
        });
    }

    let json_str = String::from_utf8_lossy(&output.stdout);
    let parsed: serde_json::Value =
        serde_json::from_str(&json_str).map_err(|e| format!("Failed to parse JSON: {}", e))?;

    let runs = parsed
        .get("check_runs")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "No check_runs array in response".to_string())?;

    let mut result = Vec::new();
    for run in runs {
        result.push(CheckRun {
            name: run
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            status: run
                .get("status")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            conclusion: run
                .get("conclusion")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            html_url: run
                .get("html_url")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            started_at: run
                .get("started_at")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            completed_at: run
                .get("completed_at")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
        });
    }

    Ok(result)
}

/// Parse `owner/repo` from a GitHub remote URL (supports HTTPS and SSH formats).
fn parse_owner_repo(url: &str) -> Result<(String, String), String> {
    let url = url.trim();
    // SSH: git@github.com:owner/repo.git
    if let Some(pos) = url.find("github.com:") {
        let after = &url[pos + 11..];
        let path = after.trim_end_matches(".git");
        let parts: Vec<&str> = path.splitn(2, '/').collect();
        if parts.len() == 2 && !parts[0].is_empty() && !parts[1].is_empty() {
            return Ok((parts[0].to_string(), parts[1].to_string()));
        }
    }
    // HTTPS: https://github.com/owner/repo.git
    if let Some(pos) = url.find("github.com/") {
        let after = &url[pos + 11..];
        let path = after.trim_end_matches(".git");
        let parts: Vec<&str> = path.splitn(2, '/').collect();
        if parts.len() == 2 && !parts[0].is_empty() && !parts[1].is_empty() {
            return Ok((parts[0].to_string(), parts[1].to_string()));
        }
    }
    Err(format!(
        "Could not parse owner/repo from remote URL: {}",
        url
    ))
}

pub fn git_commit_message(worktree_path: &str, message: &str) -> Result<(), String> {
    verify_git_worktree(worktree_path)?;
    let msg = message.trim();
    if msg.is_empty() {
        return Err("Commit message cannot be empty".into());
    }
    let output = Command::new("git")
        .arg("-C")
        .arg(worktree_path)
        .args(["commit", "-m", msg])
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "git commit failed".into()
        } else {
            stderr
        });
    }
    Ok(())
}
