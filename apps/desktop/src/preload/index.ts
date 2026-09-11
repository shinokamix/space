import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("space", {
  platform: process.platform,
});
