import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import started from "electron-squirrel-startup";
import csvParser from "csv-parser";
import Database from "better-sqlite3";
import { chromium } from "playwright";

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  });

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  // Open the DevTools.
  mainWindow.webContents.openDevTools();
};

let db = null;

const initDb = () => {
  const dbPath = path.join(app.getAppPath(), "quto.db");
  db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      steps_json TEXT NOT NULL,
      loop_start_order INTEGER,
      loop_end_order INTEGER,
      updated_at TEXT NOT NULL
    );
  `);
  return dbPath;
};

const saveTaskToDb = (payload) => {
  if (!db) {
    throw new Error("Database not initialized.");
  }
  const id = payload?.id || randomUUID();
  const name = payload?.name || "Untitled Task";
  const stepsJson = JSON.stringify(payload?.steps || []);
  const loopStartOrder = Number.isInteger(payload?.loopStartOrder)
    ? payload.loopStartOrder
    : null;
  const loopEndOrder = Number.isInteger(payload?.loopEndOrder)
    ? payload.loopEndOrder
    : null;
  const updatedAt = new Date().toISOString();

  db.prepare(
    `
      INSERT INTO tasks (id, name, steps_json, loop_start_order, loop_end_order, updated_at)
      VALUES (@id, @name, @steps_json, @loop_start_order, @loop_end_order, @updated_at)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        steps_json = excluded.steps_json,
        loop_start_order = excluded.loop_start_order,
        loop_end_order = excluded.loop_end_order,
        updated_at = excluded.updated_at
    `,
  ).run({
    id,
    name,
    steps_json: stepsJson,
    loop_start_order: loopStartOrder,
    loop_end_order: loopEndOrder,
    updated_at: updatedAt,
  });

  return {
    id,
    name,
    steps: payload?.steps || [],
    loopStartOrder,
    loopEndOrder,
  };
};

const loadTasksFromDb = () => {
  if (!db) {
    throw new Error("Database not initialized.");
  }
  return db
    .prepare(
      "SELECT id, name, steps_json, loop_start_order, loop_end_order FROM tasks ORDER BY updated_at DESC",
    )
    .all()
    .map((row) => ({
      id: row.id,
      name: row.name,
      steps: JSON.parse(row.steps_json || "[]"),
      loopStartOrder: row.loop_start_order ?? null,
      loopEndOrder: row.loop_end_order ?? null,
    }));
};

const readCsvRows = (csvPath) =>
  new Promise((resolve, reject) => {
    const rows = [];
    fs.createReadStream(csvPath)
      .pipe(csvParser())
      .on("data", (row) => rows.push(row))
      .on("end", () => resolve(rows))
      .on("error", reject);
  });

const extractVariables = (steps) => {
  const vars = new Set();
  const re = /{{\s*([^}]+)\s*}}/g;
  for (const step of steps) {
    let match;
    while ((match = re.exec(step.value || "")) !== null) {
      vars.add(match[1]);
    }
  }
  return Array.from(vars);
};

const resolveSelector = (target) => {
  if (!target) return "";
  if (target.startsWith("xpath=") || target.startsWith("//")) {
    return `xpath=${target.replace(/^xpath=/, "")}`;
  }
  return target;
};

const applyTemplate = (value, row) => {
  if (!value) return "";
  if (!row) {
    if (/{{\s*[^}]+\s*}}/.test(value)) {
      throw new Error(
        "Template variables require a CSV row. Move this step inside the loop range.",
      );
    }
    return value;
  }
  return value.replace(/{{\s*([^}]+)\s*}}/g, (_, key) => {
    if (!(key in row)) {
      throw new Error(`Missing CSV column: ${key}`);
    }
    return row[key];
  });
};

let isPaused = false;
let resumeWaiters = [];
let activeBrowser = null;
let activePage = null;
let manualInterventionWaiters = [];

const waitIfPaused = async (sender) => {
  if (!isPaused) return;
  sender.send("automation-log", {
    level: "info",
    rowIndex: null,
    message: "Paused. Waiting for resume...",
  });
  await new Promise((resolve) => {
    resumeWaiters.push(resolve);
  });
};

const resumeAutomation = () => {
  isPaused = false;
  const waiters = resumeWaiters;
  resumeWaiters = [];
  waiters.forEach((resolve) => resolve());
};

const waitForManualIntervention = async (sender, message) => {
  sender.send("action-required", message);
  await new Promise((resolve) => {
    manualInterventionWaiters.push(resolve);
  });
};

const resumeManualIntervention = () => {
  const waiters = manualInterventionWaiters;
  manualInterventionWaiters = [];
  waiters.forEach((resolve) => resolve());
};

const executeSteps = async (steps, row, sender, page) => {
  for (const step of steps) {
    await waitIfPaused(sender);
    const selector = resolveSelector(step.target);
    const value = applyTemplate(step.value, row);

    switch (step.action) {
      case "navigate":
        await page.goto(step.target, { waitUntil: "domcontentloaded" });
        break;
      case "click":
        await page.click(selector);
        break;
      case "type":
        await page.fill(selector, value);
        break;
      case "pause":
        isPaused = true;
        await waitIfPaused(sender);
        break;
      case "manual-intervention":
        await waitForManualIntervention(
          sender,
          "Please log in or complete the required step, then click Resume.",
        );
        break;
      case "select":
        await page.selectOption(selector, value);
        break;
      case "wait":
        await page.waitForTimeout(Number(value));
        break;
      default:
        throw new Error(`Unknown action: ${step.action}`);
    }
  }
};

const runAutomation = async (task, csvPath, sender) => {
  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV not found at ${csvPath}`);
  }

  const rows = await readCsvRows(csvPath);
  if (rows.length === 0) {
    throw new Error("CSV has no rows");
  }

  const requiredVars = extractVariables(task.steps);
  const headers = Object.keys(rows[0]);
  const missing = requiredVars.filter((v) => !headers.includes(v));
  if (missing.length > 0) {
    throw new Error(`CSV missing headers: ${missing.join(", ")}`);
  }

  if (!activeBrowser) {
    activeBrowser = await chromium.launch({ headless: false });
    activePage = await activeBrowser.newPage();
  }
  const page = activePage;

  const sortedSteps = task.steps.slice().sort((a, b) => a.order - b.order);
  const loopStartOrder = Number.isInteger(task.loopStartOrder)
    ? task.loopStartOrder
    : null;
  const loopEndOrder = Number.isInteger(task.loopEndOrder)
    ? task.loopEndOrder
    : null;
  const hasLoopRange =
    loopStartOrder && loopEndOrder && loopStartOrder <= loopEndOrder;

  const preLoopSteps = hasLoopRange
    ? sortedSteps.filter((step) => step.order < loopStartOrder)
    : [];
  const loopSteps = hasLoopRange
    ? sortedSteps.filter(
        (step) => step.order >= loopStartOrder && step.order <= loopEndOrder,
      )
    : sortedSteps;
  const postLoopSteps = hasLoopRange
    ? sortedSteps.filter((step) => step.order > loopEndOrder)
    : [];

  if (preLoopSteps.length > 0) {
    try {
      await executeSteps(preLoopSteps, null, sender, page);
    } catch (error) {
      sender.send("automation-log", {
        level: "error",
        rowIndex: null,
        message: error?.message || "Pre-loop steps failed",
      });
      return;
    }
  }

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    try {
      await executeSteps(loopSteps, row, sender, page);

      sender.send("automation-log", {
        level: "info",
        rowIndex: i,
        message: "Row completed successfully",
      });
    } catch (error) {
      sender.send("automation-log", {
        level: "error",
        rowIndex: i,
        message: error?.message || "Row failed",
      });
    }
  }

  if (postLoopSteps.length > 0) {
    try {
      await executeSteps(postLoopSteps, null, sender, page);
    } catch (error) {
      sender.send("automation-log", {
        level: "error",
        rowIndex: null,
        message: error?.message || "Post-loop steps failed",
      });
    }
  }

  sender.send("automation-log", {
    level: "info",
    rowIndex: null,
    message: "Automation finished. Browser remains open.",
  });
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  const dbPath = initDb();
  createWindow();

  ipcMain.handle("start-automation", async (event, payload) => {
    if (!payload?.steps || payload.steps.length === 0) {
      throw new Error("At least one step is required.");
    }
    const task = {
      name: payload?.name || "Untitled Task",
      steps: payload.steps,
      loopStartOrder: Number.isInteger(payload?.loopStartOrder)
        ? payload.loopStartOrder
        : null,
      loopEndOrder: Number.isInteger(payload?.loopEndOrder)
        ? payload.loopEndOrder
        : null,
    };
    if (!payload?.csvPath) {
      throw new Error("CSV path is required.");
    }
    const csvPath = path.isAbsolute(payload.csvPath)
      ? payload.csvPath
      : path.resolve(payload.csvPath);
    await runAutomation(task, csvPath, event.sender);
    return { ok: true };
  });

  ipcMain.handle("save-task", async (_event, payload) => {
    const saved = saveTaskToDb(payload);
    return { ok: true, task: saved, dbPath };
  });

  ipcMain.handle("load-tasks", async () => {
    const tasks = loadTasksFromDb();
    return { ok: true, tasks, dbPath };
  });

  ipcMain.handle("select-csv", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "CSV Files", extensions: ["csv"] }],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, path: "" };
    }
    return { ok: true, path: result.filePaths[0] };
  });

  ipcMain.handle("pause-automation", async () => {
    isPaused = true;
    return { ok: true };
  });

  ipcMain.handle("continue-automation", async () => {
    resumeAutomation();
    return { ok: true };
  });

  ipcMain.on("resume-task", () => {
    resumeManualIntervention();
  });

  ipcMain.handle("close-browser", async () => {
    if (activePage) {
      await activePage.close();
      activePage = null;
    }
    if (activeBrowser) {
      await activeBrowser.close();
      activeBrowser = null;
    }
    return { ok: true };
  });

  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  // Keep the app running to allow long-running automations to finish.
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
