// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("api", {
  startAutomation: (payload) => ipcRenderer.invoke("start-automation", payload),
  pauseAutomation: () => ipcRenderer.invoke("pause-automation"),
  continueAutomation: () => ipcRenderer.invoke("continue-automation"),
  resumeTask: () => ipcRenderer.send("resume-task"),
  closeBrowser: () => ipcRenderer.invoke("close-browser"),
  saveTask: (payload) => ipcRenderer.invoke("save-task", payload),
  loadTasks: () => ipcRenderer.invoke("load-tasks"),
  selectCsv: () => ipcRenderer.invoke("select-csv"),
  onActionRequired: (handler) => {
    const listener = (_event, message) => handler(message);
    ipcRenderer.on("action-required", listener);
    return () => ipcRenderer.removeListener("action-required", listener);
  },
  onAutomationLog: (handler) => {
    const listener = (_event, entry) => handler(entry);
    ipcRenderer.on("automation-log", listener);
    return () => ipcRenderer.removeListener("automation-log", listener);
  },
});
