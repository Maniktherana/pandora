import {
  cpSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { $ } from "bun";

const desktopDir = path.join(import.meta.dir, "..");
const daemonDir = path.join(desktopDir, "..", "daemon");
const repoRoot = path.join(desktopDir, "..", "..");
const binDir = path.join(desktopDir, "src-tauri", "binaries");
const daemonOutDir = path.join(binDir, "pandorad-dist");
const runtimePackages = ["better-sqlite3", "node-pty", "pino"] as const;

mkdirSync(binDir, { recursive: true });

const triple = (await $`rustc --print host-tuple`.cwd(desktopDir).text()).trim();
if (!triple) {
  throw new Error("bundle-daemon: rustc --print host-tuple failed");
}

const nodePath = (await $`node -p "process.execPath"`.cwd(repoRoot).text()).trim();
if (!nodePath) {
  throw new Error("bundle-daemon: failed to resolve node executable");
}

function findPackagePath(packageName: string, startDir: string): string | null {
  let current = startDir;
  while (current.startsWith(repoRoot)) {
    const candidate = path.join(current, "node_modules", packageName);
    if (existsSync(candidate)) {
      return realpathSync(candidate);
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  const fallbacks = [
    path.join(daemonDir, "node_modules", packageName),
    path.join(repoRoot, "node_modules", packageName),
  ];
  for (const fallback of fallbacks) {
    if (existsSync(fallback)) {
      return realpathSync(fallback);
    }
  }

  const bunStore = path.join(repoRoot, "node_modules", ".bun");
  if (existsSync(bunStore)) {
    const encoded = packageName.replace("/", "+");
    const prefix = `${encoded}@`;
    const matches = readdirSync(bunStore)
      .filter((entry) => entry.startsWith(prefix))
      .map((entry) => path.join(bunStore, entry, "node_modules", packageName))
      .filter((candidate) => existsSync(candidate));
    if (matches.length === 1) {
      return realpathSync(matches[0] as string);
    }
    if (matches.length > 1) {
      throw new Error(`Ambiguous Bun store matches for ${packageName}: ${matches.join(", ")}`);
    }
  }

  return null;
}

function copyPackageWithDependencies(
  packageName: string,
  startDir: string,
  destModules: string,
  copied: Set<string>,
): void {
  if (copied.has(packageName)) {
    return;
  }
  copied.add(packageName);

  const sourcePath = findPackagePath(packageName, startDir);
  if (!sourcePath) {
    throw new Error(`Package not found: ${packageName}. Run 'bun install' first.`);
  }

  const destPath = path.join(destModules, packageName);
  mkdirSync(path.dirname(destPath), { recursive: true });
  cpSync(sourcePath, destPath, { recursive: true, dereference: true });

  const packageJsonPath = path.join(sourcePath, "package.json");
  if (!existsSync(packageJsonPath)) {
    return;
  }

  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  };
  const dependencyNames = [
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.optionalDependencies ?? {}),
  ];
  for (const dependencyName of dependencyNames) {
    copyPackageWithDependencies(dependencyName, sourcePath, destModules, copied);
  }
}

function ensureBundledNodePtySpawnHelperExecutable(destModules: string): void {
  const prebuildsDir = path.join(destModules, "node-pty", "prebuilds");
  if (!existsSync(prebuildsDir)) {
    return;
  }

  for (const entry of readdirSync(prebuildsDir)) {
    const helperPath = path.join(prebuildsDir, entry, "spawn-helper");
    if (existsSync(helperPath)) {
      chmodSync(helperPath, 0o755);
    }
  }
}

await $`bun run build`.cwd(daemonDir).env({
  ...process.env,
  NODE_ENV: "production",
});

rmSync(daemonOutDir, { recursive: true, force: true });
mkdirSync(daemonOutDir, { recursive: true });
cpSync(path.join(daemonDir, "dist"), daemonOutDir, { recursive: true });
cpSync(path.join(daemonDir, "package.json"), path.join(daemonOutDir, "package.json"));

const destModules = path.join(daemonOutDir, "node_modules");
mkdirSync(destModules, { recursive: true });
const copied = new Set<string>();
for (const packageName of runtimePackages) {
  console.log(`bundle-daemon: copying ${packageName} (+ deps)`);
  copyPackageWithDependencies(packageName, daemonDir, destModules, copied);
}
ensureBundledNodePtySpawnHelperExecutable(destModules);

const bundledNodePath = path.join(binDir, `node-${triple}`);
if (existsSync(bundledNodePath)) {
  rmSync(bundledNodePath, { force: true });
}
cpSync(nodePath, bundledNodePath, { dereference: true, force: true });

console.log("bundle-daemon: node", bundledNodePath);
console.log("bundle-daemon: dist", daemonOutDir);
