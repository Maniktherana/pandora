import Foundation
import SQLite3

private let SQLITE_TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

struct CachedSidebarState: Codable {
    let slots: [SlotState]
    let sessions: [SessionState]
}

struct CachedDefinitionsState: Codable {
    let slots: [SlotDefinition]
    let sessions: [SessionDefinition]
}

@MainActor
final class AppStateCache {
    static let shared = AppStateCache()

    private var db: OpaquePointer?

    private init() {
        openDatabase()
        createSchemaIfNeeded()
    }

    deinit {
        if let db {
            sqlite3_close(db)
        }
    }

    func load(namespace: String) -> CachedSidebarState? {
        guard let db else { return nil }
        let key = "sidebar:\(namespace)"
        let sql = "SELECT value_blob FROM app_state_cache WHERE key = ? LIMIT 1;"
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else {
            sqlite3_finalize(statement)
            return nil
        }
        defer { sqlite3_finalize(statement) }
        sqlite3_bind_text(statement, 1, key, -1, SQLITE_TRANSIENT)
        guard sqlite3_step(statement) == SQLITE_ROW,
              let blobPtr = sqlite3_column_blob(statement, 0) else {
            return nil
        }
        let byteCount = Int(sqlite3_column_bytes(statement, 0))
        let data = Data(bytes: blobPtr, count: byteCount)
        return try? JSONDecoder().decode(CachedSidebarState.self, from: data)
    }

    func save(namespace: String, slots: [SlotState], sessions: [SessionState]) {
        guard let db,
              let payload = try? JSONEncoder().encode(CachedSidebarState(slots: slots, sessions: sessions)) else {
            return
        }

        let key = "sidebar:\(namespace)"
        let sql = """
        INSERT INTO app_state_cache (key, value_blob, updated_at)
        VALUES (?, ?, strftime('%s','now'))
        ON CONFLICT(key) DO UPDATE SET
          value_blob=excluded.value_blob,
          updated_at=excluded.updated_at;
        """

        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else {
            sqlite3_finalize(statement)
            return
        }
        defer { sqlite3_finalize(statement) }
        sqlite3_bind_text(statement, 1, key, -1, SQLITE_TRANSIENT)
        _ = payload.withUnsafeBytes { rawBuffer in
            sqlite3_bind_blob(statement, 2, rawBuffer.baseAddress, Int32(payload.count), SQLITE_TRANSIENT)
        }
        _ = sqlite3_step(statement)
    }

    func loadDefinitions(namespace: String) -> CachedDefinitionsState? {
        guard let db else { return nil }
        let key = "definitions:\(namespace)"
        let sql = "SELECT value_blob FROM app_state_cache WHERE key = ? LIMIT 1;"
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else {
            sqlite3_finalize(statement)
            return nil
        }
        defer { sqlite3_finalize(statement) }
        sqlite3_bind_text(statement, 1, key, -1, SQLITE_TRANSIENT)
        guard sqlite3_step(statement) == SQLITE_ROW,
              let blobPtr = sqlite3_column_blob(statement, 0) else {
            return nil
        }
        let byteCount = Int(sqlite3_column_bytes(statement, 0))
        let data = Data(bytes: blobPtr, count: byteCount)
        return try? JSONDecoder().decode(CachedDefinitionsState.self, from: data)
    }

    func saveDefinitions(namespace: String, slots: [SlotDefinition], sessions: [SessionDefinition]) {
        guard let db,
              let payload = try? JSONEncoder().encode(CachedDefinitionsState(slots: slots, sessions: sessions)) else {
            return
        }

        let key = "definitions:\(namespace)"
        let sql = """
        INSERT INTO app_state_cache (key, value_blob, updated_at)
        VALUES (?, ?, strftime('%s','now'))
        ON CONFLICT(key) DO UPDATE SET
          value_blob=excluded.value_blob,
          updated_at=excluded.updated_at;
        """

        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else {
            sqlite3_finalize(statement)
            return
        }
        defer { sqlite3_finalize(statement) }
        sqlite3_bind_text(statement, 1, key, -1, SQLITE_TRANSIENT)
        _ = payload.withUnsafeBytes { rawBuffer in
            sqlite3_bind_blob(statement, 2, rawBuffer.baseAddress, Int32(payload.count), SQLITE_TRANSIENT)
        }
        _ = sqlite3_step(statement)
    }

    private func openDatabase() {
        let fileManager = FileManager.default
        let appSupport = (try? fileManager.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true))
            ?? URL(fileURLWithPath: NSTemporaryDirectory())
        let directory = appSupport.appendingPathComponent("pandora", isDirectory: true)
        try? fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        let dbURL = directory.appendingPathComponent("app-state.db")
        if sqlite3_open(dbURL.path, &db) != SQLITE_OK {
            db = nil
            return
        }
        _ = sqlite3_exec(db, "PRAGMA journal_mode=WAL;", nil, nil, nil)
    }

    private func createSchemaIfNeeded() {
        guard let db else { return }
        let sql = """
        CREATE TABLE IF NOT EXISTS app_state_cache (
          key TEXT PRIMARY KEY,
          value_blob BLOB NOT NULL,
          updated_at INTEGER NOT NULL
        );
        """
        _ = sqlite3_exec(db, sql, nil, nil, nil)
    }
}

