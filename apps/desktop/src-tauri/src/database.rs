use crate::models::*;
use rusqlite::{params, Connection, OptionalExtension};
use std::path::PathBuf;
use std::sync::Mutex;

pub struct AppDatabase {
    conn: Mutex<Connection>,
}

impl AppDatabase {
    pub fn open(pandora_home: &str) -> Result<Self, String> {
        let db_dir = PathBuf::from(pandora_home).join("app");
        std::fs::create_dir_all(&db_dir).map_err(|e| e.to_string())?;
        let db_path = db_dir.join("app-state.db");

        let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
        conn.execute_batch("PRAGMA journal_mode=WAL;")
            .map_err(|e| e.to_string())?;

        let db = Self {
            conn: Mutex::new(conn),
        };
        db.create_schema()?;
        db.migrate_schema()?;
        Ok(db)
    }

    fn create_schema(&self) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS projects (
              id TEXT PRIMARY KEY,
              display_path TEXT NOT NULL UNIQUE,
              git_root_path TEXT NOT NULL,
              git_context_subpath TEXT,
              display_name TEXT NOT NULL,
              git_remote_owner TEXT,
              is_expanded INTEGER NOT NULL DEFAULT 1,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS workspaces (
              id TEXT PRIMARY KEY,
              project_id TEXT NOT NULL,
              name TEXT NOT NULL,
              git_branch_name TEXT NOT NULL,
              git_worktree_owner TEXT NOT NULL,
              git_worktree_slug TEXT NOT NULL,
              worktree_path TEXT NOT NULL,
              workspace_context_subpath TEXT,
              workspace_kind TEXT NOT NULL DEFAULT 'worktree',
              status TEXT NOT NULL,
              failure_message TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              last_opened_at TEXT,
              target_branch TEXT,
              FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS workspace_ui_state (
              key TEXT PRIMARY KEY,
              value TEXT
            );

            CREATE TABLE IF NOT EXISTS workspace_layouts (
              workspace_id TEXT PRIMARY KEY,
              payload TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS project_settings (
              project_id TEXT PRIMARY KEY,
              default_branch TEXT NOT NULL DEFAULT 'main',
              worktree_root TEXT,
              setup_scripts TEXT NOT NULL DEFAULT '[]',
              run_scripts TEXT NOT NULL DEFAULT '[]',
              teardown_scripts TEXT NOT NULL DEFAULT '[]',
              env_vars TEXT NOT NULL DEFAULT '{}',
              auto_run_setup INTEGER NOT NULL DEFAULT 1,
              updated_at TEXT NOT NULL DEFAULT '',
              FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS slot_definitions (
              id TEXT PRIMARY KEY,
              runtime_id TEXT NOT NULL,
              kind TEXT NOT NULL,
              name TEXT NOT NULL,
              autostart INTEGER NOT NULL DEFAULT 0,
              presentation_mode TEXT NOT NULL DEFAULT 'single',
              primary_session_def_id TEXT,
              persisted INTEGER NOT NULL DEFAULT 1,
              sort_order INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS session_definitions (
              id TEXT PRIMARY KEY,
              runtime_id TEXT NOT NULL,
              slot_id TEXT NOT NULL,
              kind TEXT NOT NULL,
              name TEXT NOT NULL,
              command TEXT NOT NULL,
              cwd TEXT,
              port INTEGER,
              env_overrides TEXT NOT NULL DEFAULT '{}',
              restart_policy TEXT NOT NULL DEFAULT 'manual',
              pause_supported INTEGER NOT NULL DEFAULT 0,
              resume_supported INTEGER NOT NULL DEFAULT 0,
              FOREIGN KEY(slot_id) REFERENCES slot_definitions(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS runtime_metadata (
              runtime_id TEXT NOT NULL,
              key TEXT NOT NULL,
              value TEXT NOT NULL,
              PRIMARY KEY (runtime_id, key)
            );

            CREATE INDEX IF NOT EXISTS idx_slots_runtime ON slot_definitions(runtime_id);
            CREATE INDEX IF NOT EXISTS idx_sessions_runtime ON session_definitions(runtime_id);
            ",
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Adds columns introduced after first app release (existing DBs keep old CREATE TABLE shape).
    fn migrate_schema(&self) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT name FROM pragma_table_info('workspaces')")
            .map_err(|e| e.to_string())?;
        let cols: Vec<String> = stmt
            .query_map([], |row| row.get(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        if !cols.iter().any(|c| c == "workspace_kind") {
            conn.execute(
                "ALTER TABLE workspaces ADD COLUMN workspace_kind TEXT NOT NULL DEFAULT 'worktree'",
                [],
            )
            .map_err(|e| e.to_string())?;
        }
        if !cols.iter().any(|c| c == "worktree_deleted") {
            conn.execute(
                "ALTER TABLE workspaces ADD COLUMN worktree_deleted INTEGER NOT NULL DEFAULT 0",
                [],
            )
            .map_err(|e| e.to_string())?;
        }
        if !cols.iter().any(|c| c == "pr_url") {
            conn.execute_batch(
                "ALTER TABLE workspaces ADD COLUMN pr_url TEXT;
                 ALTER TABLE workspaces ADD COLUMN pr_number INTEGER;
                 ALTER TABLE workspaces ADD COLUMN pr_state TEXT;",
            )
            .map_err(|e| e.to_string())?;
        }
        if !cols.iter().any(|c| c == "deleting_at") {
            conn.execute(
                "ALTER TABLE workspaces ADD COLUMN deleting_at TEXT",
                [],
            )
            .map_err(|e| e.to_string())?;
        }
        if !cols.iter().any(|c| c == "created_by_pandora") {
            conn.execute(
                "ALTER TABLE workspaces ADD COLUMN created_by_pandora INTEGER NOT NULL DEFAULT 1",
                [],
            )
            .map_err(|e| e.to_string())?;
        }
        if !cols.iter().any(|c| c == "target_branch") {
            conn.execute("ALTER TABLE workspaces ADD COLUMN target_branch TEXT", [])
                .map_err(|e| e.to_string())?;
        }
        // Startup sweep: clear stale deleting_at from interrupted operations (crash recovery).
        conn.execute("UPDATE workspaces SET deleting_at = NULL WHERE deleting_at IS NOT NULL", [])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn load_projects(&self) -> Vec<ProjectRecord> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = match conn.prepare(
            "SELECT id, display_path, git_root_path, git_context_subpath, display_name, git_remote_owner, is_expanded, created_at, updated_at
             FROM projects ORDER BY created_at DESC",
        ) {
            Ok(s) => s,
            Err(_) => return vec![],
        };

        let rows = stmt
            .query_map([], |row| {
                Ok(ProjectRecord {
                    id: row.get(0)?,
                    display_path: row.get(1)?,
                    git_root_path: row.get(2)?,
                    git_context_subpath: row.get(3)?,
                    display_name: row.get(4)?,
                    git_remote_owner: row.get(5)?,
                    is_expanded: row.get::<_, i32>(6)? == 1,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                })
            })
            .unwrap_or_else(|_| panic!("query failed"));

        rows.filter_map(|r| r.ok()).collect()
    }

    pub fn upsert_project(&self, p: &ProjectRecord) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO projects (id, display_path, git_root_path, git_context_subpath, display_name, git_remote_owner, is_expanded, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(id) DO UPDATE SET
               display_path = excluded.display_path,
               git_root_path = excluded.git_root_path,
               git_context_subpath = excluded.git_context_subpath,
               display_name = excluded.display_name,
               git_remote_owner = excluded.git_remote_owner,
               is_expanded = excluded.is_expanded,
               updated_at = excluded.updated_at",
            params![
                p.id,
                p.display_path,
                p.git_root_path,
                p.git_context_subpath,
                p.display_name,
                p.git_remote_owner,
                if p.is_expanded { 1 } else { 0 },
                p.created_at,
                p.updated_at,
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn project_by_display_path(&self, path: &str) -> Option<ProjectRecord> {
        self.load_projects()
            .into_iter()
            .find(|p| p.display_path == path)
    }

    pub fn remove_project(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM workspaces WHERE project_id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM projects WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn load_workspaces(&self, project_id: Option<&str>) -> Vec<WorkspaceRecord> {
        let conn = self.conn.lock().unwrap();
        let sql = if project_id.is_some() {
            "SELECT id, project_id, name, git_branch_name, git_worktree_owner, git_worktree_slug, worktree_path, workspace_context_subpath, workspace_kind, status, failure_message, created_at, updated_at, last_opened_at, pr_url, pr_number, pr_state, deleting_at, created_by_pandora, target_branch
             FROM workspaces WHERE project_id = ?1 AND deleting_at IS NULL ORDER BY created_at DESC"
        } else {
            "SELECT id, project_id, name, git_branch_name, git_worktree_owner, git_worktree_slug, worktree_path, workspace_context_subpath, workspace_kind, status, failure_message, created_at, updated_at, last_opened_at, pr_url, pr_number, pr_state, deleting_at, created_by_pandora, target_branch
             FROM workspaces WHERE deleting_at IS NULL ORDER BY created_at DESC"
        };

        let mut stmt = match conn.prepare(sql) {
            Ok(s) => s,
            Err(_) => return vec![],
        };

        let mapper = |row: &rusqlite::Row| {
            let kind_str: String = row.get(8)?;
            let workspace_kind =
                WorkspaceKind::from_str(&kind_str).unwrap_or(WorkspaceKind::Worktree);
            let status_str: String = row.get(9)?;
            let status = WorkspaceStatus::from_str(&status_str).unwrap_or(WorkspaceStatus::Failed);
            Ok(WorkspaceRecord {
                id: row.get(0)?,
                project_id: row.get(1)?,
                name: row.get(2)?,
                git_branch_name: row.get(3)?,
                git_worktree_owner: row.get(4)?,
                git_worktree_slug: row.get(5)?,
                worktree_path: row.get(6)?,
                workspace_context_subpath: row.get(7)?,
                workspace_kind,
                status,
                failure_message: row.get(10)?,
                created_at: row.get(11)?,
                updated_at: row.get(12)?,
                last_opened_at: row.get(13)?,
                pr_url: row.get(14)?,
                pr_number: row.get(15)?,
                pr_state: row.get(16)?,
                deleting_at: row.get(17)?,
                created_by_pandora: row.get::<_, i32>(18).unwrap_or(1) == 1,
                target_branch: row.get(19)?,
            })
        };

        let rows = if let Some(pid) = project_id {
            stmt.query_map(params![pid], mapper)
        } else {
            stmt.query_map([], mapper)
        };

        match rows {
            Ok(r) => r.filter_map(|r| r.ok()).collect(),
            Err(_) => vec![],
        }
    }

    pub fn upsert_workspace(&self, w: &WorkspaceRecord) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO workspaces (id, project_id, name, git_branch_name, git_worktree_owner, git_worktree_slug, worktree_path, workspace_context_subpath, workspace_kind, status, failure_message, created_at, updated_at, last_opened_at, pr_url, pr_number, pr_state, deleting_at, created_by_pandora, target_branch)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20)
             ON CONFLICT(id) DO UPDATE SET
               project_id = excluded.project_id,
               name = excluded.name,
               git_branch_name = excluded.git_branch_name,
               git_worktree_owner = excluded.git_worktree_owner,
               git_worktree_slug = excluded.git_worktree_slug,
               worktree_path = excluded.worktree_path,
               workspace_context_subpath = excluded.workspace_context_subpath,
               workspace_kind = excluded.workspace_kind,
               status = excluded.status,
               failure_message = excluded.failure_message,
               updated_at = excluded.updated_at,
               last_opened_at = excluded.last_opened_at,
               pr_url = excluded.pr_url,
               pr_number = excluded.pr_number,
               pr_state = excluded.pr_state,
               created_by_pandora = excluded.created_by_pandora,
               target_branch = excluded.target_branch",
            params![
                w.id,
                w.project_id,
                w.name,
                w.git_branch_name,
                w.git_worktree_owner,
                w.git_worktree_slug,
                w.worktree_path,
                w.workspace_context_subpath,
                w.workspace_kind.as_str(),
                w.status.as_str(),
                w.failure_message,
                w.created_at,
                w.updated_at,
                w.last_opened_at,
                w.pr_url,
                w.pr_number,
                w.pr_state,
                w.deleting_at,
                if w.created_by_pandora { 1 } else { 0 },
                w.target_branch,
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn update_workspace_target_branch(
        &self,
        id: &str,
        target_branch: Option<&str>,
    ) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE workspaces SET target_branch = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, target_branch, now_iso8601()],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn update_workspace_pr(
        &self,
        id: &str,
        pr_url: Option<&str>,
        pr_number: Option<i64>,
        pr_state: Option<&str>,
    ) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE workspaces SET pr_url = ?2, pr_number = ?3, pr_state = ?4, updated_at = ?5 WHERE id = ?1",
            params![id, pr_url, pr_number, pr_state, now_iso8601()],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn update_workspace_status(&self, id: &str, status: &str) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE workspaces SET status = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, status, now_iso8601()],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn update_worktree_deleted(&self, id: &str, deleted: bool) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE workspaces SET worktree_deleted = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, deleted as i32, now_iso8601()],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn mark_workspace_deleting(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE workspaces SET deleting_at = ?2 WHERE id = ?1",
            params![id, now_iso8601()],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn clear_workspace_deleting(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE workspaces SET deleting_at = NULL WHERE id = ?1",
            params![id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn workspaces_with_open_prs(&self) -> Vec<WorkspaceRecord> {
        self.load_workspaces(None)
            .into_iter()
            .filter(|w| w.pr_state.as_deref() == Some("open") && w.pr_number.is_some())
            .collect()
    }

    pub fn remove_workspace(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM workspace_layouts WHERE workspace_id = ?1",
            params![id],
        )
        .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM workspaces WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn load_ui_state(&self, key: &str) -> Option<String> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT value FROM workspace_ui_state WHERE key = ?1 LIMIT 1",
            params![key],
            |row| row.get(0),
        )
        .optional()
        .ok()
        .flatten()
    }

    pub fn save_ui_state(&self, key: &str, value: Option<&str>) {
        let conn = self.conn.lock().unwrap();
        let _ = conn.execute(
            "INSERT INTO workspace_ui_state (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        );
    }

    pub fn load_selected_project_id(&self) -> Option<String> {
        self.load_ui_state("selected_project_id")
    }

    pub fn load_selected_workspace_id(&self) -> Option<String> {
        self.load_ui_state("selected_workspace_id")
    }

    pub fn save_selection(&self, project_id: Option<&str>, workspace_id: Option<&str>) {
        self.save_ui_state("selected_project_id", project_id);
        self.save_ui_state("selected_workspace_id", workspace_id);
    }

    pub fn save_layout(&self, workspace_id: &str, payload: &str) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO workspace_layouts (workspace_id, payload, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(workspace_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at",
            params![workspace_id, payload, now_iso8601()],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn load_layout(&self, workspace_id: &str) -> Option<String> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT payload FROM workspace_layouts WHERE workspace_id = ?1 LIMIT 1",
            params![workspace_id],
            |row| row.get(0),
        )
        .optional()
        .ok()
        .flatten()
    }

    pub fn load_project_settings(&self, project_id: &str) -> Option<ProjectSettingsRow> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT project_id, default_branch, worktree_root, setup_scripts, run_scripts, teardown_scripts, env_vars, auto_run_setup, updated_at
             FROM project_settings WHERE project_id = ?1 LIMIT 1",
            params![project_id],
            |row| {
                Ok(ProjectSettingsRow {
                    project_id: row.get(0)?,
                    default_branch: row.get(1)?,
                    worktree_root: row.get(2)?,
                    setup_scripts: row.get(3)?,
                    run_scripts: row.get(4)?,
                    teardown_scripts: row.get(5)?,
                    env_vars: row.get(6)?,
                    auto_run_setup: row.get::<_, i32>(7)? == 1,
                    updated_at: row.get(8)?,
                })
            },
        )
        .optional()
        .ok()
        .flatten()
    }

    pub fn upsert_project_settings(&self, s: &ProjectSettingsRow) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO project_settings (project_id, default_branch, worktree_root, setup_scripts, run_scripts, teardown_scripts, env_vars, auto_run_setup, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(project_id) DO UPDATE SET
               default_branch = excluded.default_branch,
               worktree_root = excluded.worktree_root,
               setup_scripts = excluded.setup_scripts,
               run_scripts = excluded.run_scripts,
               teardown_scripts = excluded.teardown_scripts,
               env_vars = excluded.env_vars,
               auto_run_setup = excluded.auto_run_setup,
               updated_at = excluded.updated_at",
            params![
                s.project_id,
                s.default_branch,
                s.worktree_root,
                s.setup_scripts,
                s.run_scripts,
                s.teardown_scripts,
                s.env_vars,
                if s.auto_run_setup { 1 } else { 0 },
                s.updated_at,
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Delete all slot_definitions, session_definitions, and runtime_metadata for a runtime_id.
    pub fn remove_runtime_data(&self, runtime_id: &str) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM session_definitions WHERE runtime_id = ?1",
            params![runtime_id],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM slot_definitions WHERE runtime_id = ?1",
            params![runtime_id],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM runtime_metadata WHERE runtime_id = ?1",
            params![runtime_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Migrate data from old per-runtime DB files into the global schema.
    /// Runs once — skips if already migrated.
    pub fn migrate_runtime_dbs(&self, pandora_home: &str) -> Result<(), String> {
        if self.load_ui_state("runtime_dbs_migrated").is_some() {
            return Ok(());
        }

        let runtime_dir = PathBuf::from(pandora_home).join("runtime");
        if !runtime_dir.exists() {
            self.save_ui_state("runtime_dbs_migrated", Some("1"));
            return Ok(());
        }

        let entries = std::fs::read_dir(&runtime_dir).map_err(|e| e.to_string())?;
        for entry in entries {
            let entry = match entry {
                Ok(e) => e,
                Err(_) => continue,
            };
            let name = entry.file_name().to_string_lossy().into_owned();
            if !name.starts_with("runtime-") || !name.ends_with(".db") {
                continue;
            }
            let runtime_id = name
                .strip_prefix("runtime-")
                .and_then(|s| s.strip_suffix(".db"))
                .unwrap_or("")
                .to_string();
            if runtime_id.is_empty() {
                continue;
            }

            let old_db_path = entry.path();
            let old_conn = match Connection::open(&old_db_path) {
                Ok(c) => c,
                Err(_) => continue,
            };

            // Migrate slot_definitions
            if let Ok(mut stmt) = old_conn.prepare(
                "SELECT id, kind, name, autostart, presentation_mode, primary_session_def_id, persisted, sort_order FROM slot_definitions",
            ) {
                let conn = self.conn.lock().unwrap();
                let rows: Vec<_> = stmt
                    .query_map([], |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, i32>(3)?,
                            row.get::<_, String>(4)?,
                            row.get::<_, Option<String>>(5)?,
                            row.get::<_, i32>(6)?,
                            row.get::<_, i32>(7)?,
                        ))
                    })
                    .map(|r| r.filter_map(|r| r.ok()).collect())
                    .unwrap_or_default();
                for (id, kind, name, autostart, pres_mode, primary_sid, persisted, sort_order) in rows {
                    let _ = conn.execute(
                        "INSERT OR IGNORE INTO slot_definitions (id, runtime_id, kind, name, autostart, presentation_mode, primary_session_def_id, persisted, sort_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                        params![id, runtime_id, kind, name, autostart, pres_mode, primary_sid, persisted, sort_order],
                    );
                }
            }

            // Migrate session_definitions
            if let Ok(mut stmt) = old_conn.prepare(
                "SELECT id, slot_id, kind, name, command, cwd, port, env_overrides, restart_policy, pause_supported, resume_supported FROM session_definitions",
            ) {
                let conn = self.conn.lock().unwrap();
                let rows: Vec<_> = stmt
                    .query_map([], |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, String>(3)?,
                            row.get::<_, String>(4)?,
                            row.get::<_, Option<String>>(5)?,
                            row.get::<_, Option<i32>>(6)?,
                            row.get::<_, String>(7)?,
                            row.get::<_, String>(8)?,
                            row.get::<_, i32>(9)?,
                            row.get::<_, i32>(10)?,
                        ))
                    })
                    .map(|r| r.filter_map(|r| r.ok()).collect())
                    .unwrap_or_default();
                for (id, slot_id, kind, name, command, cwd, port, env_overrides, restart_policy, pause_sup, resume_sup) in rows {
                    let _ = conn.execute(
                        "INSERT OR IGNORE INTO session_definitions (id, runtime_id, slot_id, kind, name, command, cwd, port, env_overrides, restart_policy, pause_supported, resume_supported) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                        params![id, runtime_id, slot_id, kind, name, command, cwd, port, env_overrides, restart_policy, pause_sup, resume_sup],
                    );
                }
            }

            // Migrate runtime_metadata
            if let Ok(mut stmt) = old_conn.prepare("SELECT key, value FROM runtime_metadata") {
                let conn = self.conn.lock().unwrap();
                let rows: Vec<_> = stmt
                    .query_map([], |row| {
                        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                    })
                    .map(|r| r.filter_map(|r| r.ok()).collect())
                    .unwrap_or_default();
                for (key, value) in rows {
                    let _ = conn.execute(
                        "INSERT OR IGNORE INTO runtime_metadata (runtime_id, key, value) VALUES (?1, ?2, ?3)",
                        params![runtime_id, key, value],
                    );
                }
            }

            drop(old_conn);

            // Remove old DB files
            let _ = std::fs::remove_file(&old_db_path);
            let _ = std::fs::remove_file(old_db_path.with_extension("db-wal"));
            let _ = std::fs::remove_file(old_db_path.with_extension("db-shm"));
        }

        // Clean up runtime directory if empty
        if let Ok(mut remaining) = std::fs::read_dir(&runtime_dir) {
            if remaining.next().is_none() {
                let _ = std::fs::remove_dir(&runtime_dir);
            }
        }

        self.save_ui_state("runtime_dbs_migrated", Some("1"));
        Ok(())
    }

    /// Returns the path to the global app-state.db file.
    pub fn db_path(pandora_home: &str) -> PathBuf {
        PathBuf::from(pandora_home).join("app").join("app-state.db")
    }
}

pub fn now_iso8601() -> String {
    chrono::Utc::now().to_rfc3339()
}
