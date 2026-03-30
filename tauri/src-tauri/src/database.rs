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
              status TEXT NOT NULL,
              failure_message TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              last_opened_at TEXT,
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
            ",
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn load_projects(&self) -> Vec<ProjectRecord> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = match conn.prepare(
            "SELECT id, display_path, git_root_path, git_context_subpath, display_name, git_remote_owner, is_expanded, created_at, updated_at
             FROM projects ORDER BY created_at ASC",
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
            "SELECT id, project_id, name, git_branch_name, git_worktree_owner, git_worktree_slug, worktree_path, workspace_context_subpath, status, failure_message, created_at, updated_at, last_opened_at
             FROM workspaces WHERE project_id = ?1 ORDER BY created_at ASC"
        } else {
            "SELECT id, project_id, name, git_branch_name, git_worktree_owner, git_worktree_slug, worktree_path, workspace_context_subpath, status, failure_message, created_at, updated_at, last_opened_at
             FROM workspaces ORDER BY created_at ASC"
        };

        let mut stmt = match conn.prepare(sql) {
            Ok(s) => s,
            Err(_) => return vec![],
        };

        let mapper = |row: &rusqlite::Row| {
            let status_str: String = row.get(8)?;
            let status =
                WorkspaceStatus::from_str(&status_str).unwrap_or(WorkspaceStatus::Failed);
            Ok(WorkspaceRecord {
                id: row.get(0)?,
                project_id: row.get(1)?,
                name: row.get(2)?,
                git_branch_name: row.get(3)?,
                git_worktree_owner: row.get(4)?,
                git_worktree_slug: row.get(5)?,
                worktree_path: row.get(6)?,
                workspace_context_subpath: row.get(7)?,
                status,
                failure_message: row.get(9)?,
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
                last_opened_at: row.get(12)?,
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
            "INSERT INTO workspaces (id, project_id, name, git_branch_name, git_worktree_owner, git_worktree_slug, worktree_path, workspace_context_subpath, status, failure_message, created_at, updated_at, last_opened_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
             ON CONFLICT(id) DO UPDATE SET
               project_id = excluded.project_id,
               name = excluded.name,
               git_branch_name = excluded.git_branch_name,
               git_worktree_owner = excluded.git_worktree_owner,
               git_worktree_slug = excluded.git_worktree_slug,
               worktree_path = excluded.worktree_path,
               workspace_context_subpath = excluded.workspace_context_subpath,
               status = excluded.status,
               failure_message = excluded.failure_message,
               updated_at = excluded.updated_at,
               last_opened_at = excluded.last_opened_at",
            params![
                w.id,
                w.project_id,
                w.name,
                w.git_branch_name,
                w.git_worktree_owner,
                w.git_worktree_slug,
                w.worktree_path,
                w.workspace_context_subpath,
                w.status.as_str(),
                w.failure_message,
                w.created_at,
                w.updated_at,
                w.last_opened_at,
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
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

    pub fn save_layout(&self, workspace_id: &str, layout: &PersistedWorkspaceLayout) -> Result<(), String> {
        let payload = serde_json::to_string(layout).map_err(|e| e.to_string())?;
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO workspace_layouts (workspace_id, payload, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(workspace_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at",
            params![workspace_id, payload, now_iso8601()],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn load_layout(&self, workspace_id: &str) -> Option<PersistedWorkspaceLayout> {
        let conn = self.conn.lock().unwrap();
        let payload: Option<String> = conn
            .query_row(
                "SELECT payload FROM workspace_layouts WHERE workspace_id = ?1 LIMIT 1",
                params![workspace_id],
                |row| row.get(0),
            )
            .optional()
            .ok()
            .flatten();
        payload.and_then(|p| serde_json::from_str(&p).ok())
    }
}

pub fn now_iso8601() -> String {
    chrono::Utc::now().to_rfc3339()
}
