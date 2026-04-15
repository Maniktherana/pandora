import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

import type { PresentationMode, SessionDefinition, SlotDefinition, SlotKind } from "./types";

type StatementResult = {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): unknown;
};

type BetterSqlite3Module = {
  new (path: string): {
    exec(sql: string): void;
    close(): void;
    prepare(sql: string): {
      get(...params: unknown[]): unknown;
      all(...params: unknown[]): unknown[];
      run(...params: unknown[]): unknown;
    };
  };
};

type BunSqliteModule = {
  Database: new (path: string) => {
    exec(sql: string): void;
    close(): void;
    query(sql: string): {
      get(...params: unknown[]): unknown;
      all(...params: unknown[]): unknown[];
      run(...params: unknown[]): unknown;
    };
  };
};

export interface Database {
  exec(sql: string): void;
  close(): void;
  query(sql: string): StatementResult;
  /** When set, all queries are scoped to this runtime ID (shared DB mode). */
  runtimeId: string | null;
}

class WrappedDatabase implements Database {
  runtimeId: string | null = null;

  constructor(
    private readonly db: {
      exec(sql: string): void;
      close(): void;
      prepare(sql: string): {
        get(...params: unknown[]): unknown;
        all(...params: unknown[]): unknown[];
        run(...params: unknown[]): unknown;
      };
    },
  ) {}

  exec(sql: string): void {
    this.db.exec(sql);
  }

  close(): void {
    this.db.close();
  }

  query(sql: string): StatementResult {
    const statement = this.db.prepare(sql);
    return {
      get: (...params: unknown[]) => statement.get(...params),
      all: (...params: unknown[]) => statement.all(...params),
      run: (...params: unknown[]) => statement.run(...params),
    };
  }
}

class WrappedBunDatabase implements Database {
  runtimeId: string | null = null;

  constructor(
    private readonly db: {
      exec(sql: string): void;
      close(): void;
      query(sql: string): {
        get(...params: unknown[]): unknown;
        all(...params: unknown[]): unknown[];
        run(...params: unknown[]): unknown;
      };
    },
  ) {}

  exec(sql: string): void {
    this.db.exec(sql);
  }

  close(): void {
    this.db.close();
  }

  query(sql: string): StatementResult {
    const q = this.db.query(sql);
    return {
      get: (...params: unknown[]) => q.get(...params),
      all: (...params: unknown[]) => q.all(...params),
      run: (...params: unknown[]) => q.run(...params),
    };
  }
}

function pandoraDirectory(): string {
  return process.env.PANDORA_HOME || join(homedir(), ".pandora");
}

function ensureDirectory(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

function encodeEnv(envOverrides: Record<string, string>): string {
  return JSON.stringify(envOverrides);
}

function decodeEnv(raw: string | null): Record<string, string> {
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function sanitizeRuntimeIdForFilename(runtimeId: string): string {
  return runtimeId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 96);
}

/** Legacy: one DB file per daemon runtime, stored globally. */
function legacyRuntimeDatabasePath(runtimeId: string): string {
  const safe = sanitizeRuntimeIdForFilename(runtimeId);
  return join(pandoraDirectory(), "runtime", `runtime-${safe}.db`);
}

function removeDatabaseFiles(dbPath: string): void {
  for (const candidate of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    if (existsSync(candidate)) {
      rmSync(candidate, { force: true });
    }
  }
}

function openBetterSqlite(dbPath: string): WrappedDatabase {
  const require = createRequire(import.meta.url);
  const BetterSqlite3 = require("better-sqlite3") as BetterSqlite3Module;
  return new WrappedDatabase(new BetterSqlite3(dbPath));
}

function openBunSqlite(dbPath: string): WrappedBunDatabase {
  const require = createRequire(import.meta.url);
  const bunSqlite = require("bun:sqlite") as BunSqliteModule;
  return new WrappedBunDatabase(new bunSqlite.Database(dbPath));
}

function databaseUserVersion(db: Database): number {
  const row = db.query("PRAGMA user_version;").get() as { user_version?: number } | null;
  return row?.user_version ?? 0;
}

function getRuntimeMetadata(db: Database, runtimeId: string | null, key: string): string | null {
  if (runtimeId) {
    const row = db.query("SELECT value FROM runtime_metadata WHERE runtime_id = ? AND key = ?").get(runtimeId, key) as {
      value?: string;
    } | null;
    return row?.value ?? null;
  }
  const row = db.query("SELECT value FROM runtime_metadata WHERE key = ?").get(key) as {
    value?: string;
  } | null;
  return row?.value ?? null;
}

function setRuntimeMetadata(db: Database, runtimeId: string | null, key: string, value: string): void {
  if (runtimeId) {
    db.query(
      `INSERT INTO runtime_metadata (runtime_id, key, value)
       VALUES (?, ?, ?)
       ON CONFLICT(runtime_id, key) DO UPDATE SET value = excluded.value`,
    ).run(runtimeId, key, value);
  } else {
    db.query(
      `INSERT INTO runtime_metadata (key, value)
       VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(key, value);
  }
}

function disableTerminalSlotAutostart(db: Database, runtimeId: string | null): void {
  if (runtimeId) {
    db.query(
      "UPDATE slot_definitions SET autostart = 0 WHERE runtime_id = ? AND kind = 'terminal_slot' AND autostart != 0",
    ).run(runtimeId);
  } else {
    db.query(
      "UPDATE slot_definitions SET autostart = 0 WHERE kind = 'terminal_slot' AND autostart != 0",
    ).run();
  }
}

/**
 * Open the database. Supports two modes:
 * 1. Shared mode: PANDORA_DB_PATH env is set → open the global app-state.db and scope by runtimeId.
 * 2. Legacy mode: per-runtime DB file (old behavior, for backward compat).
 */
export function openDatabase(options?: {
  dbPath?: string;
  workspacePath?: string;
  defaultCwd?: string;
  runtimeId?: string;
}): Database {
  const runtimeId = options?.runtimeId ?? "legacy";

  // Check for shared DB mode (set by Tauri host via env).
  const sharedDbPath = process.env.PANDORA_DB_PATH ?? options?.dbPath;
  const isSharedMode = !!process.env.PANDORA_DB_PATH;

  if (isSharedMode && sharedDbPath) {
    // Shared mode: open the global DB. Tables already exist (created by Rust side).
    const db = process.versions.bun ? openBunSqlite(sharedDbPath) : openBetterSqlite(sharedDbPath);
    db.runtimeId = runtimeId;
    db.exec("PRAGMA busy_timeout = 10000;");
    db.exec("PRAGMA journal_mode = WAL;");

    // Rename legacy slot/session names
    if (runtimeId) {
      db.query(`UPDATE slot_definitions SET name = 'Terminal' WHERE runtime_id = ? AND name = 'Local Terminal'`).run(runtimeId);
      db.query(`UPDATE session_definitions SET name = 'Terminal' WHERE runtime_id = ? AND name = 'Local Terminal'`).run(runtimeId);
    }
    disableTerminalSlotAutostart(db, runtimeId);

    if (options?.workspacePath !== undefined || options?.defaultCwd !== undefined) {
      ensureSeedData(db, runtimeId, options?.defaultCwd ?? options?.workspacePath ?? homedir());
    }
    return db;
  }

  // Legacy mode: per-runtime DB file.
  const dbPath =
    options?.dbPath ??
    legacyRuntimeDatabasePath(runtimeId);
  ensureDirectory(dirname(dbPath));

  let db = process.versions.bun ? openBunSqlite(dbPath) : openBetterSqlite(dbPath);
  db.runtimeId = null; // No scoping in legacy mode.
  db.exec("PRAGMA busy_timeout = 10000;");
  if (databaseUserVersion(db) < 2) {
    db.close();
    removeDatabaseFiles(dbPath);
    ensureDirectory(dirname(dbPath));
    db = process.versions.bun ? openBunSqlite(dbPath) : openBetterSqlite(dbPath);
    db.runtimeId = null;
    db.exec("PRAGMA busy_timeout = 10000;");
  }
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS slot_definitions (
      id TEXT PRIMARY KEY,
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
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  db.query(`UPDATE slot_definitions SET name = 'Terminal' WHERE name = 'Local Terminal'`).run();
  db.query(`UPDATE session_definitions SET name = 'Terminal' WHERE name = 'Local Terminal'`).run();
  disableTerminalSlotAutostart(db, null);
  db.exec("PRAGMA user_version = 3;");
  if (
    options?.dbPath === undefined ||
    options?.workspacePath !== undefined ||
    options?.defaultCwd !== undefined
  ) {
    ensureSeedData(db, null, options?.defaultCwd ?? options?.workspacePath ?? homedir());
  }
  return db;
}

function ensureSeedData(db: Database, runtimeId: string | null, defaultCwd: string): void {
  const countQuery = runtimeId
    ? "SELECT COUNT(*) AS count FROM slot_definitions WHERE runtime_id = ?"
    : "SELECT COUNT(*) AS count FROM slot_definitions";
  const slotCount = (runtimeId
    ? db.query(countQuery).get(runtimeId)
    : db.query(countQuery).get()) as { count: number };
  if (slotCount.count > 0) {
    return;
  }
  if (getRuntimeMetadata(db, runtimeId, "seed_terminal_when_empty") !== "1") {
    return;
  }

  const slotID = randomUUID();
  const sessionID = randomUUID();

  if (runtimeId) {
    db.query(
      `INSERT INTO slot_definitions (id, runtime_id, kind, name, autostart, presentation_mode, primary_session_def_id, persisted, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(slotID, runtimeId, "terminal_slot", "Terminal", 0, "single", sessionID, 1, 0);

    db.query(
      `INSERT INTO session_definitions
       (id, runtime_id, slot_id, kind, name, command, cwd, port, env_overrides, restart_policy, pause_supported, resume_supported)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      sessionID,
      runtimeId,
      slotID,
      "terminal",
      "Terminal",
      "exec ${SHELL:-/bin/zsh} -i",
      defaultCwd,
      null,
      "{}",
      "manual",
      1,
      1,
    );
  } else {
    db.query(
      `INSERT INTO slot_definitions (id, kind, name, autostart, presentation_mode, primary_session_def_id, persisted, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(slotID, "terminal_slot", "Terminal", 0, "single", sessionID, 1, 0);

    db.query(
      `INSERT INTO session_definitions
       (id, slot_id, kind, name, command, cwd, port, env_overrides, restart_policy, pause_supported, resume_supported)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      sessionID,
      slotID,
      "terminal",
      "Terminal",
      "exec ${SHELL:-/bin/zsh} -i",
      defaultCwd,
      null,
      "{}",
      "manual",
      1,
      1,
    );
  }
  setRuntimeMetadata(db, runtimeId, "seed_terminal_when_empty", "0");
}

export function listSlotDefinitions(db: Database): SlotDefinition[] {
  const rid = db.runtimeId;

  const sessionIDsBySlot = new Map<string, string[]>();
  const sessionQuery = rid
    ? "SELECT id, slot_id FROM session_definitions WHERE runtime_id = ? ORDER BY rowid"
    : "SELECT id, slot_id FROM session_definitions ORDER BY rowid";
  const sessionRows = (rid
    ? db.query(sessionQuery).all(rid)
    : db.query(sessionQuery).all()) as Array<{ id: string; slot_id: string }>;

  for (const row of sessionRows) {
    const existing = sessionIDsBySlot.get(row.slot_id) ?? [];
    existing.push(row.id);
    sessionIDsBySlot.set(row.slot_id, existing);
  }

  const slotQuery = rid
    ? `SELECT id, kind, name, autostart, presentation_mode, primary_session_def_id, persisted, sort_order
       FROM slot_definitions WHERE runtime_id = ?
       ORDER BY sort_order ASC, rowid ASC`
    : `SELECT id, kind, name, autostart, presentation_mode, primary_session_def_id, persisted, sort_order
       FROM slot_definitions
       ORDER BY sort_order ASC, rowid ASC`;
  const rows = (rid
    ? db.query(slotQuery).all(rid)
    : db.query(slotQuery).all()) as Array<{
    id: string;
    kind: SlotKind;
    name: string;
    autostart: number;
    presentation_mode: PresentationMode;
    primary_session_def_id: string | null;
    persisted: number;
    sort_order: number;
  }>;

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    name: row.name,
    autostart: row.autostart === 1,
    presentationMode: row.presentation_mode,
    primarySessionDefID: row.primary_session_def_id,
    sessionDefIDs: sessionIDsBySlot.get(row.id) ?? [],
    persisted: row.persisted === 1,
    sortOrder: row.sort_order,
  }));
}

export function listSessionDefinitions(db: Database): SessionDefinition[] {
  const rid = db.runtimeId;

  const sessionQuery = rid
    ? `SELECT id, slot_id, kind, name, command, cwd, port, env_overrides, restart_policy, pause_supported, resume_supported
       FROM session_definitions WHERE runtime_id = ?
       ORDER BY rowid ASC`
    : `SELECT id, slot_id, kind, name, command, cwd, port, env_overrides, restart_policy, pause_supported, resume_supported
       FROM session_definitions
       ORDER BY rowid ASC`;
  const rows = (rid
    ? db.query(sessionQuery).all(rid)
    : db.query(sessionQuery).all()) as Array<{
    id: string;
    slot_id: string;
    kind: SessionDefinition["kind"];
    name: string;
    command: string;
    cwd: string | null;
    port: number | null;
    env_overrides: string | null;
    restart_policy: "manual" | "always";
    pause_supported: number;
    resume_supported: number;
  }>;

  return rows.map((row) => ({
    id: row.id,
    slotID: row.slot_id,
    kind: row.kind,
    name: row.name,
    command: row.command,
    cwd: row.cwd,
    port: row.port,
    envOverrides: decodeEnv(row.env_overrides),
    restartPolicy: row.restart_policy,
    pauseSupported: row.pause_supported === 1,
    resumeSupported: row.resume_supported === 1,
  }));
}

export function createSlotDefinition(
  db: Database,
  slot: Omit<SlotDefinition, "sessionDefIDs">,
): SlotDefinition {
  const id = slot.id;
  const rid = db.runtimeId;

  if (rid) {
    db.query(
      `INSERT INTO slot_definitions (id, runtime_id, kind, name, autostart, presentation_mode, primary_session_def_id, persisted, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      rid,
      slot.kind,
      slot.name,
      slot.autostart ? 1 : 0,
      slot.presentationMode,
      slot.primarySessionDefID,
      slot.persisted ? 1 : 0,
      slot.sortOrder,
    );
  } else {
    db.query(
      `INSERT INTO slot_definitions (id, kind, name, autostart, presentation_mode, primary_session_def_id, persisted, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      slot.kind,
      slot.name,
      slot.autostart ? 1 : 0,
      slot.presentationMode,
      slot.primarySessionDefID,
      slot.persisted ? 1 : 0,
      slot.sortOrder,
    );
  }
  setRuntimeMetadata(db, rid, "seed_terminal_when_empty", "0");

  return {
    ...slot,
    id,
    sessionDefIDs: [],
  };
}

export function updateSlotDefinition(
  db: Database,
  slot: Partial<SlotDefinition> & { id: string },
): void {
  const sets: string[] = [];
  const values: Array<string | number | null> = [];

  if (slot.kind !== undefined) {
    sets.push("kind = ?");
    values.push(slot.kind);
  }
  if (slot.name !== undefined) {
    sets.push("name = ?");
    values.push(slot.name);
  }
  if (slot.autostart !== undefined) {
    sets.push("autostart = ?");
    values.push(slot.autostart ? 1 : 0);
  }
  if (slot.presentationMode !== undefined) {
    sets.push("presentation_mode = ?");
    values.push(slot.presentationMode);
  }
  if (slot.primarySessionDefID !== undefined) {
    sets.push("primary_session_def_id = ?");
    values.push(slot.primarySessionDefID);
  }
  if (slot.persisted !== undefined) {
    sets.push("persisted = ?");
    values.push(slot.persisted ? 1 : 0);
  }
  if (slot.sortOrder !== undefined) {
    sets.push("sort_order = ?");
    values.push(slot.sortOrder);
  }

  if (sets.length === 0) {
    return;
  }

  db.query(`UPDATE slot_definitions SET ${sets.join(", ")} WHERE id = ?`).run(...values, slot.id);
}

export function removeSlotDefinition(db: Database, slotID: string): void {
  const rid = db.runtimeId;
  db.query("DELETE FROM session_definitions WHERE slot_id = ?").run(slotID);
  db.query("DELETE FROM slot_definitions WHERE id = ?").run(slotID);

  const countQuery = rid
    ? "SELECT COUNT(*) AS count FROM slot_definitions WHERE runtime_id = ?"
    : "SELECT COUNT(*) AS count FROM slot_definitions";
  const remaining = (rid
    ? db.query(countQuery).get(rid)
    : db.query(countQuery).get()) as { count: number };
  if (remaining.count === 0) {
    setRuntimeMetadata(db, rid, "seed_terminal_when_empty", "1");
  }
}

export function createSessionDefinition(
  db: Database,
  session: SessionDefinition,
): SessionDefinition {
  const id = session.id;
  const rid = db.runtimeId;

  if (rid) {
    db.query(
      `INSERT INTO session_definitions
       (id, runtime_id, slot_id, kind, name, command, cwd, port, env_overrides, restart_policy, pause_supported, resume_supported)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      rid,
      session.slotID,
      session.kind,
      session.name,
      session.command,
      session.cwd,
      session.port,
      encodeEnv(session.envOverrides),
      session.restartPolicy,
      session.pauseSupported ? 1 : 0,
      session.resumeSupported ? 1 : 0,
    );
  } else {
    db.query(
      `INSERT INTO session_definitions
       (id, slot_id, kind, name, command, cwd, port, env_overrides, restart_policy, pause_supported, resume_supported)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      session.slotID,
      session.kind,
      session.name,
      session.command,
      session.cwd,
      session.port,
      encodeEnv(session.envOverrides),
      session.restartPolicy,
      session.pauseSupported ? 1 : 0,
      session.resumeSupported ? 1 : 0,
    );
  }

  return { ...session, id };
}

export function updateSessionDefinition(
  db: Database,
  session: Partial<SessionDefinition> & { id: string },
): void {
  const sets: string[] = [];
  const values: Array<string | number | null> = [];

  if (session.slotID !== undefined) {
    sets.push("slot_id = ?");
    values.push(session.slotID);
  }
  if (session.kind !== undefined) {
    sets.push("kind = ?");
    values.push(session.kind);
  }
  if (session.name !== undefined) {
    sets.push("name = ?");
    values.push(session.name);
  }
  if (session.command !== undefined) {
    sets.push("command = ?");
    values.push(session.command);
  }
  if (session.cwd !== undefined) {
    sets.push("cwd = ?");
    values.push(session.cwd);
  }
  if (session.port !== undefined) {
    sets.push("port = ?");
    values.push(session.port);
  }
  if (session.envOverrides !== undefined) {
    sets.push("env_overrides = ?");
    values.push(encodeEnv(session.envOverrides));
  }
  if (session.restartPolicy !== undefined) {
    sets.push("restart_policy = ?");
    values.push(session.restartPolicy);
  }
  if (session.pauseSupported !== undefined) {
    sets.push("pause_supported = ?");
    values.push(session.pauseSupported ? 1 : 0);
  }
  if (session.resumeSupported !== undefined) {
    sets.push("resume_supported = ?");
    values.push(session.resumeSupported ? 1 : 0);
  }

  if (sets.length === 0) {
    return;
  }

  db.query(`UPDATE session_definitions SET ${sets.join(", ")} WHERE id = ?`).run(
    ...values,
    session.id,
  );
}

export function removeSessionDefinition(db: Database, sessionDefID: string): void {
  db.query("DELETE FROM session_definitions WHERE id = ?").run(sessionDefID);
}
