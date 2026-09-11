import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { app, BrowserWindow, shell } from "electron";

let runtime: ChildProcess | undefined;

const startPackagedRuntime = () => {
  if (!app.isPackaged) return;
  const entry = join(app.getAppPath(), "node_modules", "@space", "runtime", "dist", "main.js");
  runtime = spawn(process.execPath, [entry], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      SPACE_DATABASE_PATH: join(app.getPath("userData"), "space.db"),
    },
    stdio: "inherit",
  });
};

const createWindow = () => {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#09090b",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(__dirname, "../preload/index.js"),
      sandbox: true,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }
};

void app.whenReady().then(() => {
  startPackagedRuntime();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => runtime?.kill());
