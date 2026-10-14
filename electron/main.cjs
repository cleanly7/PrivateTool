const {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
} = require("electron");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const APP_NAME = "私人工具箱";
/** 「记一次分心」的全局快捷键：在哪儿都能按，按了就把窗口叫回来。 */
const DISTRACTION_ACCELERATOR = "CommandOrControl+Shift+D";

let mainWindow = null;
let serverInstance = null;
let serverPort = null;
let startupLogPath = null;
let isQuitting = false;

function log(...args) {
  if (!startupLogPath) return;
  const line = `[${new Date().toISOString()}] ${args.join(" ")}\n`;
  fs.appendFileSync(startupLogPath, line);
}

function getServerPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "standalone", "server.js")
    : path.join(__dirname, "..", ".next", "standalone", "server.js");
}

function getDataDir() {
  if (process.env.PRIVATE_TOOLBOX_DATA_DIR) {
    return path.resolve(process.env.PRIVATE_TOOLBOX_DATA_DIR);
  }
  return app.isPackaged
    ? path.join(app.getPath("userData"), "data")
    : path.join(__dirname, "..", "data");
}

function migrateExistingDb(dataDir) {
  const target = path.join(dataDir, "bookkeeping.db");
  if (fs.existsSync(target)) return;

  const candidates = [
    process.env.PRIVATE_TOOLBOX_MIGRATE_DB,
    path.join(os.homedir(), "Desktop", "privateTool", "data", "bookkeeping.db"),
    path.join(process.cwd(), "data", "bookkeeping.db"),
  ].filter(Boolean);

  for (const source of candidates) {
    if (fs.existsSync(source)) {
      fs.copyFileSync(source, target);
      return;
    }
  }
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const port = probe.address().port;
      probe.close(() => resolve(port));
    });
  });
}

async function startEmbeddedServer(serverPath, port) {
  const serverDir = path.dirname(serverPath);
  process.env.NODE_ENV = "production";
  process.env.HOSTNAME = "127.0.0.1";
  process.env.PORT = String(port);
  process.env.PRIVATE_TOOLBOX_DATA_DIR = getDataDir();
  process.chdir(serverDir);

  const source = fs.readFileSync(serverPath, "utf8");
  const match = source.match(
    /const nextConfig = (\{[\s\S]*?\})\n\nprocess\.env\.__NEXT_PRIVATE_STANDALONE_CONFIG/,
  );
  if (!match) {
    throw new Error("无法读取内置服务配置");
  }

  const nextConfig = JSON.parse(match[1]);
  process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(nextConfig);

  require(path.join(serverDir, "node_modules/next"));
  const { startServer } = require(
    path.join(serverDir, "node_modules/next/dist/server/lib/start-server"),
  );

  return startServer({
    dir: serverDir,
    isDev: false,
    config: nextConfig,
    hostname: "127.0.0.1",
    port,
    allowRetry: false,
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: APP_NAME,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${serverPort}`);
  mainWindow.on("close", (event) => {
    // 点红叉：隐藏窗口而不是销毁，后台继续跑（喝水提醒等仍生效）
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

/** 把窗口叫到前面；页面还没建好（或已销毁）时什么都不做。 */
function revealWindow() {
  if (!mainWindow) return false;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  return true;
}

/**
 * 全局快捷键：只负责「把窗口叫回来 + 告诉页面有人按了分心」。
 * 记不记得下、要不要记，全由页面判断（比如没在计时就不记）。
 */
function registerDistractionShortcut() {
  const ok = globalShortcut.register(DISTRACTION_ACCELERATOR, () => {
    // 窗口点红叉只是 hide，所以这里必须自己 show + focus：
    // 「在别的窗口里按一下就能记分心」正是这个快捷键存在的意义。
    revealWindow();
    if (mainWindow && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send("focus:distraction");
    }
  });
  log("global shortcut", DISTRACTION_ACCELERATOR, ok ? "registered" : "failed");
  if (!ok) {
    // 键位被系统或别的 App 占了。不能静默：用户会以为按了没反应。
    dialog.showErrorBox(
      APP_NAME,
      `${DISTRACTION_ACCELERATOR} 已被占用，快捷记分心用不了。` +
        "\n窗口里的「分心了一下」按钮照常可用。",
    );
  }
  return ok;
}

app.whenReady().then(async () => {
  app.setName(APP_NAME);
  startupLogPath = path.join(app.getPath("userData"), "startup.log");

  const dataDir = getDataDir();
  fs.mkdirSync(dataDir, { recursive: true });
  log("app launched, packaged:", app.isPackaged);
  log("dataDir:", dataDir);
  if (app.isPackaged) {
    migrateExistingDb(dataDir);
  }

  const serverPath = getServerPath();
  log("serverPath:", serverPath, "exists:", fs.existsSync(serverPath));
  if (!fs.existsSync(serverPath)) {
    dialog.showErrorBox(APP_NAME, "缺少内置服务文件，请重新安装应用。");
    app.quit();
    return;
  }

  try {
    serverPort = await getFreePort();
    log("starting server on port:", serverPort);
    serverInstance = await startEmbeddedServer(serverPath, serverPort);
    log("server ready");
    createWindow();
    log("window created");
    registerDistractionShortcut();
  } catch (error) {
    log("startup failed:", error.message);
    dialog.showErrorBox(APP_NAME, `应用启动失败：${error.message}`);
    app.quit();
  }

  app.on("activate", () => {
    // Dock 图标点击：隐藏时重新显示，否则新建窗口
    if (mainWindow) {
      mainWindow.show();
    } else if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// 全局快捷键要在应用真正退出时交还系统，否则下次启动注册不上。
app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  isQuitting = true;
  if (serverInstance && typeof serverInstance.close === "function") {
    serverInstance.close();
  }
});
