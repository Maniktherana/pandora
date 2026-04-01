import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { PresentationMode, SessionDefinition, SlotDefinition, SlotKind } from "./types";

function pandoraDirectory(): string {
  return process.env.PANDORA_HOME || join(homedir(), ".pandora");
}

function legacyGlobalDatabasePath(): string {
  return join(pandoraDirectory(), "pandora.db");
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

/** One DB file per daemon runtime (workspace id or `project:…`), so linked workspaces never share a DB. */
function defaultRuntimeDatabasePath(workspacePath: string, runtimeId: string): string {
  const safe = sanitizeRuntimeIdForFilename(runtimeId);
  return join(workspacePath, ".pandora", `runtime-${safe}.db`);
}

function removeDatabaseFiles(dbPath: string): void {
  for (const candidate of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    if (existsSync(candidate)) {
      rmSync(candidate, { force: true });
    }
  }
}

function resetLegacyGlobalDatabase(): void {
  removeDatabaseFiles(legacyGlobalDatabasePath());
}

function databaseUserVersion(db: Database): number {
  const row = db.query("PRAGMA user_version;").get() as { user_version?: number } | null;
  return row?.user_version ?? 0;
}

function getRuntimeMetadata(db: Database, key: string): string | null {
  const row = db
    .query("SELECT value FROM runtime_metadata WHERE key = ?")
    .get(key) as { value?: string } | null;
  return row?.value ?? null;
}

function setRuntimeMetadata(db: Database, key: string, value: string): void {
  db.query(
    `INSERT INTO runtime_metadata (key, value)
     VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, value);
}

export function openDatabase(options?: {
  dbPath?: string;
  workspacePath?: string;
  defaultCwd?: string;
  /** Distinct per Bun daemon (workspace UUID or `project:id`); required when `dbPath` is omitted. */
  runtimeId?: string;
}): Database {
  const runtimeId = options?.runtimeId ?? "legacy";
  const dbPath =
    options?.dbPath ??
    defaultRuntimeDatabasePath(options?.workspacePath ?? pandoraDirectory(), runtimeId);
  ensureDirectory(dirname(dbPath));
  resetLegacyGlobalDatabase();
  let db = new Database(dbPath);
  db.exec("PRAGMA busy_timeout = 10000;");
  if (databaseUserVersion(db) < 2) {
    db.close();
    removeDatabaseFiles(dbPath);
    ensureDirectory(dirname(dbPath));
    db = new Database(dbPath);
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
  db.exec("PRAGMA user_version = 3;");
  if (options?.dbPath === undefined || options?.workspacePath !== undefined || options?.defaultCwd !== undefined) {
    ensureSeedData(db, options?.defaultCwd ?? options?.workspacePath ?? homedir());
  }
  return db;
}

function ensureSeedData(db: Database, defaultCwd: string): void {
  const slotCount = db.query("SELECT COUNT(*) AS count FROM slot_definitions").get() as { count: number };
  if (slotCount.count > 0) {
    return;
  }
  if (getRuntimeMetadata(db, "seed_terminal_when_empty") !== "1") {
    return;
  }

  const slotID = randomUUID();
  const sessionID = randomUUID();

  db.query(
    `INSERT INTO slot_definitions (id, kind, name, autostart, presentation_mode, primary_session_def_id, persisted, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    slotID,
    "terminal_slot",
    "Terminal",
    1,
    "single",
    sessionID,
    1,
    0
  );

  db.query(
    `INSERT INTO session_definitions
     (id, slot_id, kind, name, command, cwd, port, env_overrides, restart_policy, pause_supported, resume_supported)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
    1
  );
  setRuntimeMetadata(db, "seed_terminal_when_empty", "0");
}

export function listSlotDefinitions(db: Database): SlotDefinition[] {
  const sessionIDsBySlot = new Map<string, string[]>();
  const sessionRows = db
    .query("SELECT id, slot_id FROM session_definitions ORDER BY rowid")
    .all() as Array<{ id: string; slot_id: string }>;

  for (const row of sessionRows) {
    const existing = sessionIDsBySlot.get(row.slot_id) ?? [];
    existing.push(row.id);
    sessionIDsBySlot.set(row.slot_id, existing);
  }

  const rows = db
    .query(
      `SELECT id, kind, name, autostart, presentation_mode, primary_session_def_id, persisted, sort_order
       FROM slot_definitions
       ORDER BY sort_order ASC, rowid ASC`
    )
    .all() as Array<{
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
    sortOrder: row.sort_order
  }));
}

export function listSessionDefinitions(db: Database): SessionDefinition[] {
  const rows = db
    .query(
      `SELECT id, slot_id, kind, name, command, cwd, port, env_overrides, restart_policy, pause_supported, resume_supported
       FROM session_definitions
       ORDER BY rowid ASC`
    )
    .all() as Array<{
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
    resumeSupported: row.resume_supported === 1
  }));
}

export function createSlotDefinition(
  db: Database,
  slot: Omit<SlotDefinition, "sessionDefIDs">
): SlotDefinition {
  const id = slot.id;
  db.query(
    `INSERT INTO slot_definitions (id, kind, name, autostart, presentation_mode, primary_session_def_id, persisted, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    slot.kind,
    slot.name,
    slot.autostart ? 1 : 0,
    slot.presentationMode,
    slot.primarySessionDefID,
    slot.persisted ? 1 : 0,
    slot.sortOrder
  );
  setRuntimeMetadata(db, "seed_terminal_when_empty", "0");

  return {
    ...slot,
    id,
    sessionDefIDs: []
  };
}

export function updateSlotDefinition(db: Database, slot: Partial<SlotDefinition> & { id: string }): void {
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
  db.query("DELETE FROM session_definitions WHERE slot_id = ?").run(slotID);
  db.query("DELETE FROM slot_definitions WHERE id = ?").run(slotID);
  const remaining = db.query("SELECT COUNT(*) AS count FROM slot_definitions").get() as { count: number };
  if (remaining.count === 0) {
    setRuntimeMetadata(db, "seed_terminal_when_empty", "1");
  }
}

export function createSessionDefinition(
  db: Database,
  session: SessionDefinition
): SessionDefinition {
  const id = session.id;
  db.query(
    `INSERT INTO session_definitions
     (id, slot_id, kind, name, command, cwd, port, env_overrides, restart_policy, pause_supported, resume_supported)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
    session.resumeSupported ? 1 : 0
  );

  return { ...session, id };
}

export function updateSessionDefinition(
  db: Database,
  session: Partial<SessionDefinition> & { id: string }
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

  db.query(`UPDATE session_definitions SET ${sets.join(", ")} WHERE id = ?`).run(...values, session.id);
}

export function removeSessionDefinition(db: Database, sessionDefID: string): void {
  db.query("DELETE FROM session_definitions WHERE id = ?").run(sessionDefID);
}
