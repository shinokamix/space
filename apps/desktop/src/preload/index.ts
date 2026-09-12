import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("space", {
  platform: process.platform,
  getRuntimeConfig: () => ipcRenderer.invoke("space:get-runtime-config"),
});
