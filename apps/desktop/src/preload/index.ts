import { contextBridge } from "electron";

import { createDesktopBridge } from "./api.js";

contextBridge.exposeInMainWorld("agentDesktop", createDesktopBridge());
