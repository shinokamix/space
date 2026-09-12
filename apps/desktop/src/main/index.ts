import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { join } from "node:path";

import { app, BrowserWindow, ipcMain, shell } from "electron";

interface RuntimeConfig {
  readonly token: string;
  readonly url: string;
}

let runtime: ChildProcess | undefined;
let runtimeConfig: RuntimeConfig | undefined;

const startPackagedRuntime = () =>
  new Promise<RuntimeConfig>((resolve, reject) => {
    const token = randomBytes(32).toString("base64url");
    const entry = join(app.getAppPath(), "node_modules", "@space", "runtime", "dist", "main.js");
    const child = spawn(process.execPath, [entry], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        SPACE_DATABASE_PATH: join(app.getPath("userData"), "space.db"),
        SPACE_RUNTIME_PORT: "0",
        SPACE_RUNTIME_TOKEN: token,
      },
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });
    runtime = child;

    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("Space runtime did not become ready within 15 seconds"));
    }, 15_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      if (!runtimeConfig)
        reject(new Error(`Space runtime exited before ready (${code ?? signal})`));
    });
    child.on("message", (message: unknown) => {
      if (
        typeof message === "object" &&
        message !== null &&
        "type" in message &&
        message.type === "space.runtime.ready" &&
        "port" in message &&
        typeof message.port === "number"
      ) {
        clearTimeout(timeout);
        resolve({ token, url: `http://127.0.0.1:${message.port}` });
      }
    });
  });

const getDevelopmentRuntimeConfig = (): RuntimeConfig => {
  const token = process.env.SPACE_RUNTIME_TOKEN;
  const port = process.env.SPACE_RUNTIME_PORT;
  if (!token || !port) throw new Error("Development runtime configuration is missing");
  return { token, url: `http://127.0.0.1:${port}` };
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
      preload: join(__dirname, "../preload/index.cjs"),
      sandbox: true,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event) => event.preventDefault());

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }
};

void app
  .whenReady()
  .then(async () => {
    runtimeConfig = app.isPackaged ? await startPackagedRuntime() : getDevelopmentRuntimeConfig();
    ipcMain.handle("space:get-runtime-config", () => runtimeConfig);
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  })
  .catch((error: unknown) => {
    console.error(error);
    app.quit();
  });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => runtime?.kill());
