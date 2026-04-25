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
        // WAL + a generous busy_timeout keeps reads and writes from
        // blocking each other under concurrent access. Defence in depth
        // even now that there is only one writer.
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=10000;")
            .map_err(|e| e.to_string())?;

        let db = Self {
            conn: Mutex::new(conn),
        };
        db.create_schema()?;
        db.migrate_schema()?;
        db.runtime_open_fixups()?;
        Ok(db)
    }

    /// Idempotent fix-ups run on every open. Specifically:
    ///   * rename legacy "Local Terminal" rows to "Terminal"
    ///   * disable autostart on `terminal_slot` rows (we don't auto-spawn the
    ///     dormant terminal on workspace open).
    fn runtime_open_fixups(&self) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE slot_definitions SET name = 'Terminal' WHERE name = 'Local Terminal'",
            [],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE session_definitions SET name = 'Terminal' WHERE name = 'Local Terminal'",
            [],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE slot_definitions SET autostart = 0 WHERE kind = 'terminal_slot' AND autostart != 0",
            [],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
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
            conn.execute("ALTER TABLE workspaces ADD COLUMN deleting_at TEXT", [])
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
        conn.execute(
            "UPDATE workspaces SET deleting_at = NULL WHERE deleting_at IS NOT NULL",
            [],
        )
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

    /// Returns the path to the global app-state.db file.
    #[allow(dead_code)]
    pub fn db_path(pandora_home: &str) -> PathBuf {
        PathBuf::from(pandora_home).join("app").join("app-state.db")
    }

    // ---------------------------------------------------------------------
    // Runtime metadata (key/value scoped by runtime_id).
    // ---------------------------------------------------------------------

    #[allow(dead_code)]
    pub fn get_runtime_metadata(&self, runtime_id: &str, key: &str) -> Option<String> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT value FROM runtime_metadata WHERE runtime_id = ?1 AND key = ?2",
            params![runtime_id, key],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .ok()
        .flatten()
    }

    #[allow(dead_code)]
    pub fn set_runtime_metadata(
        &self,
        runtime_id: &str,
        key: &str,
        value: &str,
    ) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO runtime_metadata (runtime_id, key, value) VALUES (?1, ?2, ?3)
             ON CONFLICT(runtime_id, key) DO UPDATE SET value = excluded.value",
            params![runtime_id, key, value],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    // ---------------------------------------------------------------------
    // Slot definitions (CRUD scoped to runtime_id).
    //
    // `sessionDefIDs` is computed by joining session_definitions and is
    // not stored on the slot row itself.
    // ---------------------------------------------------------------------

    pub fn list_slot_definitions(&self, runtime_id: &str) -> Vec<SlotDefinition> {
        let conn = self.conn.lock().unwrap();

        // Build slotID -> [sessionID] in one pass, ordered by rowid so the
        // session order is stable across reads.
        let mut sessions_by_slot: std::collections::HashMap<String, Vec<String>> =
            std::collections::HashMap::new();
        if let Ok(mut stmt) = conn.prepare(
            "SELECT id, slot_id FROM session_definitions WHERE runtime_id = ?1 ORDER BY rowid",
        ) {
            if let Ok(rows) =
                stmt.query_map(params![runtime_id], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
            {
                for r in rows.flatten() {
                    sessions_by_slot.entry(r.1).or_default().push(r.0);
                }
            }
        }

        let mut stmt = match conn.prepare(
            "SELECT id, kind, name, autostart, presentation_mode, primary_session_def_id, persisted, sort_order
             FROM slot_definitions WHERE runtime_id = ?1
             ORDER BY sort_order ASC, rowid ASC",
        ) {
            Ok(s) => s,
            Err(_) => return vec![],
        };

        let rows = stmt.query_map(params![runtime_id], |row| {
            let kind_str: String = row.get(1)?;
            let pres_str: String = row.get(4)?;
            Ok(SlotDefinition {
                id: row.get(0)?,
                kind: SlotKind::from_str(&kind_str).unwrap_or(SlotKind::TerminalSlot),
                name: row.get(2)?,
                autostart: row.get::<_, i32>(3)? == 1,
                presentation_mode: PresentationMode::from_str(&pres_str)
                    .unwrap_or(PresentationMode::Single),
                primary_session_def_id: row.get(5)?,
                session_def_ids: Vec::new(),
                persisted: row.get::<_, i32>(6)? == 1,
                sort_order: row.get::<_, i64>(7)?,
            })
        });

        match rows {
            Ok(iter) => iter
                .filter_map(|r| r.ok())
                .map(|mut slot| {
                    slot.session_def_ids =
                        sessions_by_slot.remove(&slot.id).unwrap_or_default();
                    slot
                })
                .collect(),
            Err(_) => vec![],
        }
    }

    pub fn create_slot_definition(
        &self,
        runtime_id: &str,
        slot: &SlotDefinition,
    ) -> Result<(), String> {
        {
            let conn = self.conn.lock().unwrap();
            conn.execute(
                "INSERT INTO slot_definitions
                 (id, runtime_id, kind, name, autostart, presentation_mode, primary_session_def_id, persisted, sort_order)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    slot.id,
                    runtime_id,
                    slot.kind.as_str(),
                    slot.name,
                    slot.autostart as i32,
                    slot.presentation_mode.as_str(),
                    slot.primary_session_def_id,
                    slot.persisted as i32,
                    slot.sort_order,
                ],
            )
            .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    /// Partial update — only fields supplied as `Some` are written.
    #[allow(dead_code)]
    pub fn update_slot_definition(
        &self,
        runtime_id: &str,
        id: &str,
        patch: SlotDefinitionPatch,
    ) -> Result<(), String> {
        let mut sets: Vec<&'static str> = Vec::new();
        let mut values: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

        if let Some(v) = patch.kind {
            sets.push("kind = ?");
            values.push(Box::new(v.as_str().to_string()));
        }
        if let Some(v) = patch.name {
            sets.push("name = ?");
            values.push(Box::new(v));
        }
        if let Some(v) = patch.autostart {
            sets.push("autostart = ?");
            values.push(Box::new(v as i32));
        }
        if let Some(v) = patch.presentation_mode {
            sets.push("presentation_mode = ?");
            values.push(Box::new(v.as_str().to_string()));
        }
        if let Some(v) = patch.primary_session_def_id {
            sets.push("primary_session_def_id = ?");
            values.push(Box::new(v));
        }
        if let Some(v) = patch.persisted {
            sets.push("persisted = ?");
            values.push(Box::new(v as i32));
        }
        if let Some(v) = patch.sort_order {
            sets.push("sort_order = ?");
            values.push(Box::new(v));
        }

        if sets.is_empty() {
            return Ok(());
        }

        let sql = format!(
            "UPDATE slot_definitions SET {} WHERE id = ? AND runtime_id = ?",
            sets.join(", ")
        );
        values.push(Box::new(id.to_string()));
        values.push(Box::new(runtime_id.to_string()));

        let conn = self.conn.lock().unwrap();
        let params: Vec<&dyn rusqlite::ToSql> = values.iter().map(|b| b.as_ref()).collect();
        conn.execute(&sql, params.as_slice())
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    #[allow(dead_code)]
    pub fn remove_slot_definition(&self, runtime_id: &str, slot_id: &str) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM session_definitions WHERE slot_id = ?1 AND runtime_id = ?2",
            params![slot_id, runtime_id],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM slot_definitions WHERE id = ?1 AND runtime_id = ?2",
            params![slot_id, runtime_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    // ---------------------------------------------------------------------
    // Session definitions (CRUD scoped to runtime_id).
    //
    // Session definitions (CRUD scoped to runtime_id).
    // ---------------------------------------------------------------------

    pub fn list_session_definitions(&self, runtime_id: &str) -> Vec<SessionDefinition> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = match conn.prepare(
            "SELECT id, slot_id, kind, name, command, cwd, port, env_overrides, restart_policy, pause_supported, resume_supported
             FROM session_definitions WHERE runtime_id = ?1
             ORDER BY rowid ASC",
        ) {
            Ok(s) => s,
            Err(_) => return vec![],
        };

        let rows = stmt.query_map(params![runtime_id], |row| {
            let kind_str: String = row.get(2)?;
            let restart_str: String = row.get(8)?;
            let env_raw: Option<String> = row.get(7)?;
            Ok(SessionDefinition {
                id: row.get(0)?,
                slot_id: row.get(1)?,
                kind: SessionKind::from_str(&kind_str).unwrap_or(SessionKind::Process),
                name: row.get(3)?,
                command: row.get(4)?,
                cwd: row.get(5)?,
                port: row.get(6)?,
                env_overrides: decode_env_overrides(env_raw.as_deref()),
                restart_policy: RestartPolicy::from_str(&restart_str)
                    .unwrap_or(RestartPolicy::Manual),
                pause_supported: row.get::<_, i32>(9)? == 1,
                resume_supported: row.get::<_, i32>(10)? == 1,
            })
        });

        match rows {
            Ok(iter) => iter.filter_map(|r| r.ok()).collect(),
            Err(_) => vec![],
        }
    }

    pub fn create_session_definition(
        &self,
        runtime_id: &str,
        session: &SessionDefinition,
    ) -> Result<(), String> {
        let env_json = encode_env_overrides(&session.env_overrides);
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO session_definitions
             (id, runtime_id, slot_id, kind, name, command, cwd, port, env_overrides, restart_policy, pause_supported, resume_supported)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                session.id,
                runtime_id,
                session.slot_id,
                session.kind.as_str(),
                session.name,
                session.command,
                session.cwd,
                session.port,
                env_json,
                session.restart_policy.as_str(),
                session.pause_supported as i32,
                session.resume_supported as i32,
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    #[allow(dead_code)]
    pub fn update_session_definition(
        &self,
        runtime_id: &str,
        id: &str,
        patch: SessionDefinitionPatch,
    ) -> Result<(), String> {
        let mut sets: Vec<&'static str> = Vec::new();
        let mut values: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

        if let Some(v) = patch.slot_id {
            sets.push("slot_id = ?");
            values.push(Box::new(v));
        }
        if let Some(v) = patch.kind {
            sets.push("kind = ?");
            values.push(Box::new(v.as_str().to_string()));
        }
        if let Some(v) = patch.name {
            sets.push("name = ?");
            values.push(Box::new(v));
        }
        if let Some(v) = patch.command {
            sets.push("command = ?");
            values.push(Box::new(v));
        }
        if let Some(v) = patch.cwd {
            sets.push("cwd = ?");
            values.push(Box::new(v));
        }
        if let Some(v) = patch.port {
            sets.push("port = ?");
            values.push(Box::new(v));
        }
        if let Some(v) = patch.env_overrides {
            sets.push("env_overrides = ?");
            values.push(Box::new(encode_env_overrides(&v)));
        }
        if let Some(v) = patch.restart_policy {
            sets.push("restart_policy = ?");
            values.push(Box::new(v.as_str().to_string()));
        }
        if let Some(v) = patch.pause_supported {
            sets.push("pause_supported = ?");
            values.push(Box::new(v as i32));
        }
        if let Some(v) = patch.resume_supported {
            sets.push("resume_supported = ?");
            values.push(Box::new(v as i32));
        }

        if sets.is_empty() {
            return Ok(());
        }

        let sql = format!(
            "UPDATE session_definitions SET {} WHERE id = ? AND runtime_id = ?",
            sets.join(", ")
        );
        values.push(Box::new(id.to_string()));
        values.push(Box::new(runtime_id.to_string()));

        let conn = self.conn.lock().unwrap();
        let params: Vec<&dyn rusqlite::ToSql> = values.iter().map(|b| b.as_ref()).collect();
        conn.execute(&sql, params.as_slice())
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    #[allow(dead_code)]
    pub fn remove_session_definition(
        &self,
        runtime_id: &str,
        session_def_id: &str,
    ) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM session_definitions WHERE id = ?1 AND runtime_id = ?2",
            params![session_def_id, runtime_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    // ---------------------------------------------------------------------
    // Seed data — creates the dormant "Terminal" slot+session for a fresh
    // runtime that has no slot definitions yet.
    // ---------------------------------------------------------------------

    /// Create a dormant "Terminal" slot+session for a fresh runtime that has
    /// no slot definitions yet. Idempotent — if any slot already exists for
    /// this runtime_id, this is a no-op.
    pub fn ensure_seed_data(&self, runtime_id: &str, default_cwd: &str) -> Result<(), String> {
        let slot_count: i64 = {
            let conn = self.conn.lock().unwrap();
            conn.query_row(
                "SELECT COUNT(*) FROM slot_definitions WHERE runtime_id = ?1",
                params![runtime_id],
                |row| row.get(0),
            )
            .unwrap_or(0)
        };
        if slot_count > 0 {
            return Ok(());
        }

        let slot_id = uuid::Uuid::new_v4().to_string();
        let session_id = uuid::Uuid::new_v4().to_string();

        let slot = SlotDefinition {
            id: slot_id.clone(),
            kind: SlotKind::TerminalSlot,
            name: "Terminal".to_string(),
            autostart: false,
            presentation_mode: PresentationMode::Single,
            primary_session_def_id: Some(session_id.clone()),
            session_def_ids: vec![],
            persisted: true,
            sort_order: 0,
        };
        self.create_slot_definition(runtime_id, &slot)?;

        let session = SessionDefinition {
            id: session_id,
            slot_id,
            kind: SessionKind::Terminal,
            name: "Terminal".to_string(),
            command: "exec ${SHELL:-/bin/zsh} -i".to_string(),
            cwd: Some(default_cwd.to_string()),
            port: None,
            env_overrides: std::collections::BTreeMap::new(),
            restart_policy: RestartPolicy::Manual,
            pause_supported: true,
            resume_supported: true,
        };
        self.create_session_definition(runtime_id, &session)?;

        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Patch types for partial updates. Using explicit structs keeps each call site
// self-documenting and avoids the trap of passing default-zero fields by
// accident the way a `..Default::default()` literal would.
// ---------------------------------------------------------------------------

#[allow(dead_code)]
#[derive(Debug, Default, Clone)]
pub struct SlotDefinitionPatch {
    pub kind: Option<SlotKind>,
    pub name: Option<String>,
    pub autostart: Option<bool>,
    pub presentation_mode: Option<PresentationMode>,
    /// Outer Option = "field present in patch", inner Option = "set to NULL".
    pub primary_session_def_id: Option<Option<String>>,
    pub persisted: Option<bool>,
    pub sort_order: Option<i64>,
}

#[allow(dead_code)]
#[derive(Debug, Default, Clone)]
pub struct SessionDefinitionPatch {
    pub slot_id: Option<String>,
    pub kind: Option<SessionKind>,
    pub name: Option<String>,
    pub command: Option<String>,
    pub cwd: Option<Option<String>>,
    pub port: Option<Option<i64>>,
    pub env_overrides: Option<std::collections::BTreeMap<String, String>>,
    pub restart_policy: Option<RestartPolicy>,
    pub pause_supported: Option<bool>,
    pub resume_supported: Option<bool>,
}

fn encode_env_overrides(env: &std::collections::BTreeMap<String, String>) -> String {
    serde_json::to_string(env).unwrap_or_else(|_| "{}".to_string())
}

fn decode_env_overrides(raw: Option<&str>) -> std::collections::BTreeMap<String, String> {
    let Some(text) = raw else {
        return std::collections::BTreeMap::new();
    };
    serde_json::from_str(text).unwrap_or_default()
}

pub fn now_iso8601() -> String {
    chrono::Utc::now().to_rfc3339()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_pandora_home(prefix: &str) -> String {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("pandora-db-{prefix}-{nanos}"));
        std::fs::create_dir_all(&dir).expect("create temp pandora_home");
        dir.to_string_lossy().into_owned()
    }

    fn sample_slot(id: &str) -> SlotDefinition {
        SlotDefinition {
            id: id.to_string(),
            kind: SlotKind::ProcessSlot,
            name: "backend".to_string(),
            autostart: true,
            presentation_mode: PresentationMode::Single,
            primary_session_def_id: None,
            session_def_ids: vec![],
            persisted: true,
            sort_order: 10,
        }
    }

    fn sample_session(id: &str, slot_id: &str) -> SessionDefinition {
        let mut env = std::collections::BTreeMap::new();
        env.insert("NODE_ENV".to_string(), "development".to_string());
        SessionDefinition {
            id: id.to_string(),
            slot_id: slot_id.to_string(),
            kind: SessionKind::Process,
            name: "backend".to_string(),
            command: "echo hello".to_string(),
            cwd: Some("/tmp/pandora-project".to_string()),
            port: Some(3000),
            env_overrides: env,
            restart_policy: RestartPolicy::Manual,
            pause_supported: true,
            resume_supported: true,
        }
    }

    #[test]
    fn persists_slot_and_session_definitions() {
        let home = temp_pandora_home("persist");
        let db = AppDatabase::open(&home).expect("open db");
        let runtime = "test-runtime-1";

        let slot = sample_slot("slot-1");
        db.create_slot_definition(runtime, &slot).expect("create slot");

        let session = sample_session("session-1", &slot.id);
        db.create_session_definition(runtime, &session)
            .expect("create session");

        db.update_slot_definition(
            runtime,
            &slot.id,
            SlotDefinitionPatch {
                primary_session_def_id: Some(Some(session.id.clone())),
                ..Default::default()
            },
        )
        .expect("update slot");

        let slots = db.list_slot_definitions(runtime);
        assert_eq!(slots.len(), 1);
        assert_eq!(slots[0].primary_session_def_id.as_deref(), Some("session-1"));
        assert_eq!(slots[0].session_def_ids, vec!["session-1".to_string()]);

        let sessions = db.list_session_definitions(runtime);
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].env_overrides.get("NODE_ENV").map(|s| s.as_str()), Some("development"));
        assert_eq!(sessions[0].port, Some(3000));

        db.remove_session_definition(runtime, &session.id)
            .expect("remove session");
        db.remove_slot_definition(runtime, &slot.id)
            .expect("remove slot");
        assert!(db.list_slot_definitions(runtime).is_empty());
        assert!(db.list_session_definitions(runtime).is_empty());

        let _ = std::fs::remove_dir_all(&home);
    }

    /// terminal_slot autostart is forced off on reopen so a workspace open
    /// never auto-spawns the dormant terminal, while non-terminal slots
    /// keep their autostart flag.
    #[test]
    fn terminal_slot_autostart_is_disabled_on_open() {
        let home = temp_pandora_home("autostart");
        let runtime = "test-runtime-2";

        {
            let db = AppDatabase::open(&home).expect("open db");
            let mut term = sample_slot("terminal-slot");
            term.kind = SlotKind::TerminalSlot;
            term.name = "Terminal".to_string();
            term.autostart = true;
            db.create_slot_definition(runtime, &term).expect("create term slot");

            let mut proc = sample_slot("process-slot");
            proc.kind = SlotKind::ProcessSlot;
            proc.name = "Server".to_string();
            proc.autostart = true;
            proc.sort_order = 2;
            db.create_slot_definition(runtime, &proc).expect("create proc slot");
        }

        let db = AppDatabase::open(&home).expect("reopen db");
        let slots = db.list_slot_definitions(runtime);
        let term = slots.iter().find(|s| s.id == "terminal-slot").expect("term");
        let proc = slots.iter().find(|s| s.id == "process-slot").expect("proc");
        assert!(!term.autostart, "terminal_slot autostart should be cleared on open");
        assert!(proc.autostart, "process_slot autostart should be preserved");

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn seeds_dormant_terminal_when_runtime_is_empty() {
        let home = temp_pandora_home("seed");
        let db = AppDatabase::open(&home).expect("open db");
        let runtime = "test-runtime-3";

        db.ensure_seed_data(runtime, "/tmp/pandora-project")
            .expect("seed");

        let slots = db.list_slot_definitions(runtime);
        assert_eq!(slots.len(), 1);
        let slot = &slots[0];
        assert_eq!(slot.kind, SlotKind::TerminalSlot);
        assert_eq!(slot.name, "Terminal");
        assert!(!slot.autostart);
        assert_eq!(slot.session_def_ids.len(), 1);

        let sessions = db.list_session_definitions(runtime);
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].cwd.as_deref(), Some("/tmp/pandora-project"));
        assert_eq!(sessions[0].command, "exec ${SHELL:-/bin/zsh} -i");
        assert_eq!(sessions[0].kind, SessionKind::Terminal);

        db.ensure_seed_data(runtime, "/tmp/pandora-project")
            .expect("seed (idempotent)");
        assert_eq!(db.list_slot_definitions(runtime).len(), 1);

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn removing_last_slot_allows_reseed() {
        let home = temp_pandora_home("rearm");
        let db = AppDatabase::open(&home).expect("open db");
        let runtime = "test-runtime-4";

        let slot = sample_slot("only-slot");
        db.create_slot_definition(runtime, &slot).expect("create slot");

        db.remove_slot_definition(runtime, &slot.id)
            .expect("remove slot");

        // After removing the last slot, ensure_seed_data should re-create one.
        db.ensure_seed_data(runtime, "/tmp").expect("re-seed");
        assert_eq!(db.list_slot_definitions(runtime).len(), 1);

        let _ = std::fs::remove_dir_all(&home);
    }

    /// Two runtimes sharing the global DB don't see each other's data.
    #[test]
    fn runtime_id_scoping_isolates_rows() {
        let home = temp_pandora_home("scope");
        let db = AppDatabase::open(&home).expect("open db");

        db.create_slot_definition("runtime-a", &sample_slot("slot-a"))
            .expect("create a");
        db.create_slot_definition("runtime-b", &sample_slot("slot-b"))
            .expect("create b");

        let a = db.list_slot_definitions("runtime-a");
        let b = db.list_slot_definitions("runtime-b");
        assert_eq!(a.len(), 1);
        assert_eq!(b.len(), 1);
        assert_eq!(a[0].id, "slot-a");
        assert_eq!(b[0].id, "slot-b");

        let _ = std::fs::remove_dir_all(&home);
    }

    /// Partial updates: SET clauses only emitted for fields supplied as Some.
    #[test]
    fn partial_session_update_only_writes_supplied_fields() {
        let home = temp_pandora_home("patch");
        let db = AppDatabase::open(&home).expect("open db");
        let runtime = "test-runtime-5";

        let slot = sample_slot("slot-1");
        db.create_slot_definition(runtime, &slot).expect("slot");
        let session = sample_session("session-1", &slot.id);
        db.create_session_definition(runtime, &session).expect("session");

        db.update_session_definition(
            runtime,
            &session.id,
            SessionDefinitionPatch {
                command: Some("echo updated".to_string()),
                ..Default::default()
            },
        )
        .expect("update");

        let sessions = db.list_session_definitions(runtime);
        assert_eq!(sessions[0].command, "echo updated");
        // Untouched fields preserved.
        assert_eq!(sessions[0].port, Some(3000));
        assert_eq!(sessions[0].name, "backend");
        assert_eq!(
            sessions[0].env_overrides.get("NODE_ENV").map(|s| s.as_str()),
            Some("development")
        );

        let _ = std::fs::remove_dir_all(&home);
    }

    /// Verify serde emits the exact field names the renderer expects:
    /// slotID, primarySessionDefID, sessionDefIDs (uppercase ID, not
    /// serde's stock camelCase slotId / sessionDefId).
    #[test]
    fn slot_definition_json_uses_daemon_field_names() {
        let slot = SlotDefinition {
            id: "s1".into(),
            kind: SlotKind::ProcessSlot,
            name: "n".into(),
            autostart: false,
            presentation_mode: PresentationMode::Tabs,
            primary_session_def_id: Some("sd1".into()),
            session_def_ids: vec!["sd1".into()],
            persisted: true,
            sort_order: 0,
        };
        let json = serde_json::to_value(&slot).unwrap();
        assert!(json.get("primarySessionDefID").is_some());
        assert!(json.get("sessionDefIDs").is_some());
        assert_eq!(json["kind"], "process_slot");
        assert_eq!(json["presentationMode"], "tabs");

        let session = SessionDefinition {
            id: "sd1".into(),
            slot_id: "s1".into(),
            kind: SessionKind::Terminal,
            name: "n".into(),
            command: "c".into(),
            cwd: None,
            port: None,
            env_overrides: std::collections::BTreeMap::new(),
            restart_policy: RestartPolicy::Always,
            pause_supported: false,
            resume_supported: false,
        };
        let json = serde_json::to_value(&session).unwrap();
        assert!(json.get("slotID").is_some());
        assert_eq!(json["kind"], "terminal");
        assert_eq!(json["restartPolicy"], "always");
    }
}
