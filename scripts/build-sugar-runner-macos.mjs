import { chmod, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const projectRoot = process.cwd();
const distDirectory = path.join(projectRoot, "dist", "sugar-runner");
const appPath = path.join(distDirectory, "Sugar Runner.app");
const contents = path.join(appPath, "Contents");
const macos = path.join(contents, "MacOS");
const resources = path.join(contents, "Resources");
const appResources = path.join(resources, "app");
const runtime = path.join(resources, "runtime");
const nodeModules = path.join(appResources, "node_modules", "@openai");
const architecture = process.arch === "arm64" ? "arm64" : "x64";

async function officialNodeBinary() {
  const cacheDirectory = path.join(projectRoot, "work", "sugar-runner-node");
  const checksumResponse = await fetch("https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt");
  if (!checksumResponse.ok) throw new Error("Unable to download the official Node.js checksums.");
  const checksums = await checksumResponse.text();
  const match = checksums.match(new RegExp(`^([a-f0-9]{64})  (node-v22\\.[^\\s]+-darwin-${architecture}\\.tar\\.gz)$`, "m"));
  if (!match) throw new Error(`The official Node.js macOS ${architecture} runtime was not found.`);
  const [, expectedChecksum, archiveName] = match;
  const versionDirectory = archiveName.replace(/\.tar\.gz$/, "");
  const cachedBinary = path.join(cacheDirectory, versionDirectory, "bin", "node");
  try {
    await chmod(cachedBinary, 0o755);
    return cachedBinary;
  } catch {
    // Download and verify the official runtime below.
  }
  await mkdir(cacheDirectory, { recursive: true });
  const archivePath = path.join(cacheDirectory, archiveName);
  const archiveResponse = await fetch(`https://nodejs.org/dist/latest-v22.x/${archiveName}`);
  if (!archiveResponse.ok) throw new Error("Unable to download the official Node.js runtime.");
  const archive = Buffer.from(await archiveResponse.arrayBuffer());
  const actualChecksum = createHash("sha256").update(archive).digest("hex");
  if (actualChecksum !== expectedChecksum) throw new Error("The downloaded Node.js runtime failed checksum verification.");
  await writeFile(archivePath, archive);
  const extracted = spawnSync("tar", ["-xzf", archivePath, "-C", cacheDirectory], { stdio: "inherit" });
  if (extracted.status !== 0) throw new Error("Unable to extract the official Node.js runtime.");
  await rm(archivePath, { force: true });
  await readFile(cachedBinary);
  return cachedBinary;
}

await rm(distDirectory, { recursive: true, force: true });
await mkdir(macos, { recursive: true });
await mkdir(runtime, { recursive: true });
await mkdir(nodeModules, { recursive: true });
await cp(await officialNodeBinary(), path.join(runtime, "node"));
await cp(path.join(projectRoot, "runner", "desktop.mjs"), path.join(appResources, "desktop.mjs"), { recursive: false });
await cp(path.join(projectRoot, "runner", "server.mjs"), path.join(appResources, "server.mjs"), { recursive: false });
await cp(path.join(projectRoot, "runner", "local-git.mjs"), path.join(appResources, "local-git.mjs"), { recursive: false });
for (const packageName of ["codex-sdk", "codex", `codex-darwin-${architecture}`]) {
  await cp(path.join(projectRoot, "node_modules", "@openai", packageName), path.join(nodeModules, packageName), { recursive: true });
}
await writeFile(path.join(appResources, "package.json"), JSON.stringify({ type: "module", private: true }, null, 2));

const launcher = `#!/bin/sh
APP_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec "$APP_ROOT/Resources/runtime/node" "$APP_ROOT/Resources/app/desktop.mjs"
`;
await writeFile(path.join(macos, "Sugar Runner"), launcher, { mode: 0o755 });
await chmod(path.join(macos, "Sugar Runner"), 0o755);
await chmod(path.join(runtime, "node"), 0o755);
await writeFile(path.join(contents, "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>Sugar Runner</string>
<key>CFBundleDisplayName</key><string>Sugar Runner</string>
<key>CFBundleIdentifier</key><string>cn.sscd.sugar-runner</string>
<key>CFBundleVersion</key><string>1.0.0</string>
<key>CFBundleShortVersionString</key><string>1.0.0</string>
<key>CFBundleExecutable</key><string>Sugar Runner</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>LSUIElement</key><true/>
</dict></plist>`);

spawnSync("codesign", ["--force", "--deep", "--sign", "-", appPath], { stdio: "inherit" });
const dmgPath = path.join(distDirectory, `Sugar-Runner-macOS-${architecture}.dmg`);
const result = spawnSync("hdiutil", ["create", "-volname", "Sugar Runner", "-srcfolder", appPath, "-ov", "-format", "UDZO", dmgPath], { stdio: "inherit" });
if (result.status !== 0) process.exit(result.status ?? 1);
process.stdout.write(`\nBuilt ${appPath}\nBuilt ${dmgPath}\n`);
