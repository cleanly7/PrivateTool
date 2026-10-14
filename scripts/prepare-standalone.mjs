import { cpSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const standalone = path.join(root, ".next", "standalone");
const staticDir = path.join(root, ".next", "static");
const targetStatic = path.join(standalone, ".next", "static");

if (!existsSync(standalone)) {
  console.error("缺少 .next/standalone，请先运行 npm run build");
  process.exit(1);
}

if (existsSync(targetStatic)) {
  rmSync(targetStatic, { recursive: true, force: true });
}
cpSync(staticDir, targetStatic, { recursive: true });
console.log("standalone 资源已就绪");
