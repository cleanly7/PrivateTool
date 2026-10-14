import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf8"),
);
const appName = "私人工具箱";
const arch = process.arch === "arm64" ? "arm64" : "x64";
const appDir = path.join(root, "release", `mac-${arch}`, `${appName}.app`);

if (!existsSync(appDir)) {
  console.error(`找不到应用包：${appDir}`);
  process.exit(1);
}

const staging = mkdtempSync(path.join(os.tmpdir(), "private-toolbox-dmg-"));
const stagedApp = path.join(staging, `${appName}.app`);
cpSync(appDir, stagedApp, { recursive: true });
symlinkSync("/Applications", path.join(staging, "Applications"), "dir");

const dmgPath = path.join(root, "release", `${appName}-${version}-${arch}.dmg`);
execFileSync(
  "hdiutil",
  ["create", "-volname", appName, "-srcfolder", staging, "-ov", "-format", "UDZO", dmgPath],
  { stdio: "inherit" },
);

const zipPath = path.join(
  root,
  "release",
  `${appName}-${version}-${arch}-mac.zip`,
);
execFileSync(
  "ditto",
  ["-c", "-k", "--sequesterRsrc", "--keepParent", appDir, zipPath],
  { stdio: "inherit" },
);

rmSync(staging, { recursive: true, force: true });
console.log(`DMG: ${dmgPath}`);
console.log(`ZIP: ${zipPath}`);
