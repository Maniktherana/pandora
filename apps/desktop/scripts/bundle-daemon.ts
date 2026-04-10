import { mkdirSync, existsSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { $ } from "bun";

const desktopDir = path.join(import.meta.dir, "..");
const daemonDir = path.join(desktopDir, "..", "daemon");
const binDir = path.join(desktopDir, "src-tauri", "binaries");

mkdirSync(binDir, { recursive: true });

const triple = (await $`rustc --print host-tuple`.cwd(desktopDir).text()).trim();
if (!triple) {
  throw new Error("bundle-daemon: rustc --print host-tuple failed");
}

const outFinal = path.join(binDir, `pandorad-${triple}`);
const outTemp = path.join(binDir, `.pandorad-build-tmp`);

await $`bun build --compile ./src/index.ts --outfile ${outTemp}`
  .cwd(daemonDir)
  .env({
    ...process.env,
    NODE_ENV: "production",
  });

if (existsSync(outFinal)) {
  rmSync(outFinal);
}
renameSync(outTemp, outFinal);
console.log("bundle-daemon:", outFinal);
