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
  updateSessionDefinition,
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
});
