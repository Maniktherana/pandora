import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createSessionDefinition,
  createSlotDefinition,
  listSessionDefinitions,
  listSlotDefinitions,
  openDatabase,
  removeSessionDefinition,
  removeSlotDefinition,
  updateSlotDefinition,
} from "../db";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("sqlite state", () => {
  test("persists slot and session definitions", () => {
    const dir = mkdtempSync(join(tmpdir(), "pandora-db-"));
    tempDirs.push(dir);

    const db = openDatabase({ dbPath: join(dir, "pandora.db") });
    const slot = createSlotDefinition(db, {
      id: "slot-1",
      kind: "process_slot",
      name: "backend",
      autostart: true,
      presentationMode: "single",
      primarySessionDefID: null,
      persisted: true,
      sortOrder: 10,
    });

    const session = createSessionDefinition(db, {
      id: "session-1",
      slotID: slot.id,
      kind: "process",
      name: "backend",
      command: "echo hello",
      cwd: "/tmp/pandora-project",
      port: 3000,
      envOverrides: { NODE_ENV: "development" },
      pauseSupported: true,
      resumeSupported: true,
      restartPolicy: "manual",
    });

    updateSlotDefinition(db, {
      id: slot.id,
      primarySessionDefID: session.id,
    });

    expect(listSlotDefinitions(db)).toHaveLength(1);
    expect(listSessionDefinitions(db)).toHaveLength(1);

    removeSessionDefinition(db, session.id);
    removeSlotDefinition(db, slot.id);
    expect(listSlotDefinitions(db)).toHaveLength(0);
    expect(listSessionDefinitions(db)).toHaveLength(0);

    db.close();
  });

  test("migrates restored terminal slots away from autostart", () => {
    const dir = mkdtempSync(join(tmpdir(), "pandora-db-"));
    tempDirs.push(dir);

    const dbPath = join(dir, "pandora.db");
    let db = openDatabase({ dbPath });
    createSlotDefinition(db, {
      id: "terminal-slot",
      kind: "terminal_slot",
      name: "Terminal",
      autostart: true,
      presentationMode: "single",
      primarySessionDefID: null,
      persisted: true,
      sortOrder: 1,
    });
    createSlotDefinition(db, {
      id: "process-slot",
      kind: "process_slot",
      name: "Server",
      autostart: true,
      presentationMode: "single",
      primarySessionDefID: null,
      persisted: true,
      sortOrder: 2,
    });
    db.close();

    db = openDatabase({ dbPath });
    const slots = listSlotDefinitions(db);
    expect(slots.find((slot) => slot.id === "terminal-slot")?.autostart).toBe(false);
    expect(slots.find((slot) => slot.id === "process-slot")?.autostart).toBe(true);
    db.close();
  });

  test("seeds a dormant terminal when an empty runtime requests seed data", () => {
    const dir = mkdtempSync(join(tmpdir(), "pandora-db-"));
    tempDirs.push(dir);

    const dbPath = join(dir, "pandora.db");
    let db = openDatabase({ dbPath });
    db.query(
      `INSERT INTO runtime_metadata (key, value)
       VALUES ('seed_terminal_when_empty', '1')
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run();
    db.close();

    db = openDatabase({ dbPath, defaultCwd: "/tmp/pandora-project" });
    const [slot] = listSlotDefinitions(db);
    expect(slot?.kind).toBe("terminal_slot");
    expect(slot?.autostart).toBe(false);
    db.close();
  });
});
