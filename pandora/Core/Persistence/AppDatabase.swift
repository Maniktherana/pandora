import Foundation
import SQLite3

private let SQLITE_TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

struct PersistedWorkspaceLayout: Codable {
    let root: WorkspaceLayoutNode
    let focusedPaneID: UUID?
}

@MainActor
final class AppDatabase {
    static let shared = AppDatabase()

    private static let schemaVersion = 2

    private var db: OpaquePointer?
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()
    private let iso8601 = ISO8601DateFormatter()

    private init() {
        encoder.dateEncodingStrategy = .iso8601
        decoder.dateDecodingStrategy = .iso8601
        resetLegacyIfNeeded()
        openDatabase()
        createSchemaIfNeeded()
    }

    deinit {
        if let db {
            sqlite3_close(db)
        }
    }

    func loadProjects() -> [ProjectRecord] {
        guard let db else { return [] }
        let sql = """
        SELECT id, display_path, git_root_path, git_context_subpath, display_name, git_remote_owner, is_expanded, created_at, updated_at
        FROM projects
        ORDER BY created_at ASC;
        """
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else {
            sqlite3_finalize(statement)
            return []
        }
        defer { sqlite3_finalize(statement) }

        var rows: [ProjectRecord] = []
        while sqlite3_step(statement) == SQLITE_ROW {
            guard
                let id = string(at: 0, statement: statement),
                let displayPath = string(at: 1, statement: statement),
                let gitRootPath = string(at: 2, statement: statement),
                let displayName = string(at: 4, statement: statement),
                let createdAt = date(at: 7, statement: statement),
                let updatedAt = date(at: 8, statement: statement)
            else {
                continue
            }

            rows.append(
                ProjectRecord(
                    id: id,
                    displayPath: displayPath,
                    gitRootPath: gitRootPath,
                    gitContextSubpath: string(at: 3, statement: statement),
                    displayName: displayName,
                    gitRemoteOwner: string(at: 5, statement: statement),
                    isExpanded: sqlite3_column_int(statement, 6) == 1,
                    createdAt: createdAt,
                    updatedAt: updatedAt
                )
            )
        }

        return rows
    }

    func upsert(project: ProjectRecord) {
        guard let db else { return }
        let sql = """
        INSERT INTO projects (id, display_path, git_root_path, git_context_subpath, display_name, git_remote_owner, is_expanded, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          display_path = excluded.display_path,
          git_root_path = excluded.git_root_path,
          git_context_subpath = excluded.git_context_subpath,
          display_name = excluded.display_name,
          git_remote_owner = excluded.git_remote_owner,
          is_expanded = excluded.is_expanded,
          updated_at = excluded.updated_at;
        """
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else {
            sqlite3_finalize(statement)
            return
        }
        defer { sqlite3_finalize(statement) }

        bind(project.id, at: 1, statement: statement)
        bind(project.displayPath, at: 2, statement: statement)
        bind(project.gitRootPath, at: 3, statement: statement)
        bind(project.gitContextSubpath, at: 4, statement: statement)
        bind(project.displayName, at: 5, statement: statement)
        bind(project.gitRemoteOwner, at: 6, statement: statement)
        sqlite3_bind_int(statement, 7, project.isExpanded ? 1 : 0)
        bind(dateString(project.createdAt), at: 8, statement: statement)
        bind(dateString(project.updatedAt), at: 9, statement: statement)
        _ = sqlite3_step(statement)
    }

    func project(matchingDisplayPath path: String) -> ProjectRecord? {
        loadProjects().first { $0.displayPath == path }
    }

    func loadWorkspaces(projectID: String? = nil) -> [WorkspaceRecord] {
        guard let db else { return [] }
        let sql: String
        if projectID == nil {
            sql = """
            SELECT id, project_id, name, git_branch_name, git_worktree_owner, git_worktree_slug, worktree_path, workspace_context_subpath, status, failure_message, created_at, updated_at, last_opened_at
            FROM workspaces
            ORDER BY created_at ASC;
            """
        } else {
            sql = """
            SELECT id, project_id, name, git_branch_name, git_worktree_owner, git_worktree_slug, worktree_path, workspace_context_subpath, status, failure_message, created_at, updated_at, last_opened_at
            FROM workspaces
            WHERE project_id = ?
            ORDER BY created_at ASC;
            """
        }

        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else {
            sqlite3_finalize(statement)
            return []
        }
        defer { sqlite3_finalize(statement) }

        if let projectID {
            bind(projectID, at: 1, statement: statement)
        }

        var rows: [WorkspaceRecord] = []
        while sqlite3_step(statement) == SQLITE_ROW {
            guard
                let id = string(at: 0, statement: statement),
                let projectID = string(at: 1, statement: statement),
                let name = string(at: 2, statement: statement),
                let gitBranchName = string(at: 3, statement: statement),
                let gitWorktreeOwner = string(at: 4, statement: statement),
                let gitWorktreeSlug = string(at: 5, statement: statement),
                let worktreePath = string(at: 6, statement: statement),
                let statusRaw = string(at: 8, statement: statement),
                let status = WorkspaceStatus(rawValue: statusRaw),
                let createdAt = date(at: 10, statement: statement),
                let updatedAt = date(at: 11, statement: statement)
            else {
                continue
            }

            rows.append(
                WorkspaceRecord(
                    id: id,
                    projectID: projectID,
                    name: name,
                    gitBranchName: gitBranchName,
                    gitWorktreeOwner: gitWorktreeOwner,
                    gitWorktreeSlug: gitWorktreeSlug,
                    worktreePath: worktreePath,
                    workspaceContextSubpath: string(at: 7, statement: statement),
                    status: status,
                    failureMessage: string(at: 9, statement: statement),
                    createdAt: createdAt,
                    updatedAt: updatedAt,
                    lastOpenedAt: date(at: 12, statement: statement)
                )
            )
        }
        return rows
    }

    func upsert(workspace: WorkspaceRecord) {
        guard let db else { return }
        let sql = """
        INSERT INTO workspaces (id, project_id, name, git_branch_name, git_worktree_owner, git_worktree_slug, worktree_path, workspace_context_subpath, status, failure_message, created_at, updated_at, last_opened_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          last_opened_at = excluded.last_opened_at;
        """
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else {
            sqlite3_finalize(statement)
            return
        }
        defer { sqlite3_finalize(statement) }

        bind(workspace.id, at: 1, statement: statement)
        bind(workspace.projectID, at: 2, statement: statement)
        bind(workspace.name, at: 3, statement: statement)
        bind(workspace.gitBranchName, at: 4, statement: statement)
        bind(workspace.gitWorktreeOwner, at: 5, statement: statement)
        bind(workspace.gitWorktreeSlug, at: 6, statement: statement)
        bind(workspace.worktreePath, at: 7, statement: statement)
        bind(workspace.workspaceContextSubpath, at: 8, statement: statement)
        bind(workspace.status.rawValue, at: 9, statement: statement)
        bind(workspace.failureMessage, at: 10, statement: statement)
        bind(dateString(workspace.createdAt), at: 11, statement: statement)
        bind(dateString(workspace.updatedAt), at: 12, statement: statement)
        bind(workspace.lastOpenedAt.map(dateString), at: 13, statement: statement)
        _ = sqlite3_step(statement)
    }

    func removeWorkspace(id: String) {
        guard let db else { return }
        delete(from: "workspace_layouts", key: "workspace_id", value: id, db: db)
        delete(from: "workspaces", key: "id", value: id, db: db)
    }

    func loadSelectedWorkspaceID() -> String? {
        loadUIStateValue(key: "selected_workspace_id")
    }

    func loadSelectedProjectID() -> String? {
        loadUIStateValue(key: "selected_project_id")
    }

    func saveSelection(projectID: String?, workspaceID: String?) {
        saveUIStateValue(key: "selected_project_id", value: projectID)
        saveUIStateValue(key: "selected_workspace_id", value: workspaceID)
    }

    func saveLayout(workspaceID: String, root: WorkspaceLayoutNode, focusedPaneID: UUID?) {
        guard let db, let payload = try? encoder.encode(PersistedWorkspaceLayout(root: root, focusedPaneID: focusedPaneID)) else {
            return
        }

        let sql = """
        INSERT INTO workspace_layouts (workspace_id, payload, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(workspace_id) DO UPDATE SET
          payload = excluded.payload,
          updated_at = excluded.updated_at;
        """
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else {
            sqlite3_finalize(statement)
            return
        }
        defer { sqlite3_finalize(statement) }

        bind(workspaceID, at: 1, statement: statement)
        _ = payload.withUnsafeBytes { bytes in
            sqlite3_bind_blob(statement, 2, bytes.baseAddress, Int32(payload.count), SQLITE_TRANSIENT)
        }
        bind(dateString(Date()), at: 3, statement: statement)
        _ = sqlite3_step(statement)
    }

    func loadLayout(workspaceID: String) -> PersistedWorkspaceLayout? {
        guard let db else { return nil }
        let sql = "SELECT payload FROM workspace_layouts WHERE workspace_id = ? LIMIT 1;"
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else {
            sqlite3_finalize(statement)
            return nil
        }
        defer { sqlite3_finalize(statement) }

        bind(workspaceID, at: 1, statement: statement)
        guard sqlite3_step(statement) == SQLITE_ROW,
              let blobPointer = sqlite3_column_blob(statement, 0) else {
            return nil
        }
        let count = Int(sqlite3_column_bytes(statement, 0))
        let data = Data(bytes: blobPointer, count: count)
        return try? decoder.decode(PersistedWorkspaceLayout.self, from: data)
    }

    private func resetLegacyIfNeeded() {
        let fileManager = FileManager.default
        let dbURL = appDatabaseURL()
        if fileManager.fileExists(atPath: dbURL.path) {
            var existing: OpaquePointer?
            if sqlite3_open(dbURL.path, &existing) == SQLITE_OK {
                let version = userVersion(for: existing)
                sqlite3_close(existing)
                if version >= Self.schemaVersion {
                    removeLegacyGlobalDaemonDB()
                    return
                }
            } else if let existing {
                sqlite3_close(existing)
            }

            removeDatabaseFiles(baseURL: dbURL)
        }

        removeLegacyGlobalDaemonDB()
    }

    private func removeLegacyGlobalDaemonDB() {
        let base = pandoraHomeDirectory().appendingPathComponent("pandora.db")
        removeDatabaseFiles(baseURL: base)
    }

    private func openDatabase() {
        let fileManager = FileManager.default
        let url = appDatabaseURL()
        try? fileManager.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        guard sqlite3_open(url.path, &db) == SQLITE_OK else {
            db = nil
            return
        }
        _ = sqlite3_exec(db, "PRAGMA journal_mode=WAL;", nil, nil, nil)
    }

    private func createSchemaIfNeeded() {
        guard let db else { return }
        let sql = """
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
          payload BLOB NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
        );
        """
        _ = sqlite3_exec(db, sql, nil, nil, nil)
        _ = sqlite3_exec(db, "PRAGMA user_version = 2;", nil, nil, nil)
    }

    private func loadUIStateValue(key: String) -> String? {
        guard let db else { return nil }
        let sql = "SELECT value FROM workspace_ui_state WHERE key = ? LIMIT 1;"
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else {
            sqlite3_finalize(statement)
            return nil
        }
        defer { sqlite3_finalize(statement) }
        bind(key, at: 1, statement: statement)
        guard sqlite3_step(statement) == SQLITE_ROW else { return nil }
        return string(at: 0, statement: statement)
    }

    private func saveUIStateValue(key: String, value: String?) {
        guard let db else { return }
        let sql = """
        INSERT INTO workspace_ui_state (key, value)
        VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value;
        """
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else {
            sqlite3_finalize(statement)
            return
        }
        defer { sqlite3_finalize(statement) }
        bind(key, at: 1, statement: statement)
        bind(value, at: 2, statement: statement)
        _ = sqlite3_step(statement)
    }

    private func delete(from table: String, key: String, value: String, db: OpaquePointer) {
        let sql = "DELETE FROM \(table) WHERE \(key) = ?;"
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else {
            sqlite3_finalize(statement)
            return
        }
        defer { sqlite3_finalize(statement) }
        bind(value, at: 1, statement: statement)
        _ = sqlite3_step(statement)
    }

    private func bind(_ value: String?, at index: Int32, statement: OpaquePointer?) {
        guard let value else {
            sqlite3_bind_null(statement, index)
            return
        }
        sqlite3_bind_text(statement, index, value, -1, SQLITE_TRANSIENT)
    }

    private func string(at index: Int32, statement: OpaquePointer?) -> String? {
        guard let cString = sqlite3_column_text(statement, index) else { return nil }
        return String(cString: cString)
    }

    private func date(at index: Int32, statement: OpaquePointer?) -> Date? {
        guard let raw = string(at: index, statement: statement) else { return nil }
        return iso8601.date(from: raw)
    }

    private func dateString(_ date: Date) -> String {
        iso8601.string(from: date)
    }

    private func userVersion(for db: OpaquePointer?) -> Int {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, "PRAGMA user_version;", -1, &statement, nil) == SQLITE_OK else {
            sqlite3_finalize(statement)
            return 0
        }
        defer { sqlite3_finalize(statement) }
        guard sqlite3_step(statement) == SQLITE_ROW else { return 0 }
        return Int(sqlite3_column_int(statement, 0))
    }

    private func appDatabaseURL() -> URL {
        let fileManager = FileManager.default
        let support = (try? fileManager.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true))
            ?? URL(fileURLWithPath: NSTemporaryDirectory())
        return support.appendingPathComponent("pandora", isDirectory: true).appendingPathComponent("app-state.db")
    }

    private func pandoraHomeDirectory() -> URL {
        if let override = ProcessInfo.processInfo.environment["PANDORA_HOME"], override.isEmpty == false {
            return URL(fileURLWithPath: override, isDirectory: true)
        }
        return FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".pandora", isDirectory: true)
    }

    private func removeDatabaseFiles(baseURL: URL) {
        let fileManager = FileManager.default
        let urls = [
            baseURL,
            baseURL.appendingPathExtension("wal"),
            baseURL.appendingPathExtension("shm")
        ]
        for url in urls {
            if fileManager.fileExists(atPath: url.path) {
                try? fileManager.removeItem(at: url)
            }
        }
    }
}
