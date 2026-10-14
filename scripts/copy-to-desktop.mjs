import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appName = "私人工具箱";
const arch = process.arch === "arm64" ? "arm64" : "x64";
const appDir = path.join(root, "release", `mac-${arch}`, `${appName}.app`);
const desktopApp = path.join(os.homedir(), "Desktop", `${appName}.app`);

if (!existsSync(appDir)) {
  console.error(`找不到应用包：${appDir}`);
  process.exit(1);
}

// 日常更新只覆盖 .app，安装包（DMG/zip）按需用 npm run build:installer 生成
execFileSync("ditto", [appDir, desktopApp], { stdio: "inherit" });
console.log(`桌面应用已更新：${desktopApp}`);

