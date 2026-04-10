#!/usr/bin/env bun
import { existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

function pandoraHomePath(): string {
  const raw = process.env.PANDORA_HOME?.trim();
  if (!raw) {
    return path.join(homedir(), ".pandora");
  }
  if (raw.startsWith("~/")) {
    return path.join(homedir(), raw.slice(2));
  }
  if (raw === "~") {
    return homedir();
  }
  return path.resolve(raw);
}

if (import.meta.main) {
  const target = pandoraHomePath();
  const resolved = path.resolve(target);
  const home = path.resolve(homedir());

  if (resolved === path.parse(resolved).root || resolved === home) {
    console.error("clear-pandora-home: refusing to remove filesystem root or user home directory.");
    process.exit(1);
  }

  if (!existsSync(resolved)) {
    console.log("clear-pandora-home: nothing to remove at", resolved);
    process.exit(0);
  }

  rmSync(resolved, { recursive: true, force: true });
  console.log("clear-pandora-home: removed", resolved);
}
