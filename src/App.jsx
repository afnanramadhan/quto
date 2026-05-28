import { useEffect, useMemo, useState } from 'react';

const defaultSteps = [];

const actionOptions = [
  { value: 'navigate', label: 'Navigate' },
  { value: 'click', label: 'Click' },
  { value: 'type', label: 'Type' },
  { value: 'pause', label: 'Pause (wait for resume)' },
  { value: 'manual-intervention', label: 'Pause for Manual Login' },
  { value: 'wait', label: 'Wait' },
];

const normalizeOrder = (items) =>
  items.map((step, index) => ({ ...step, order: index + 1 }));

const formatLog = (entry) => {
  if (typeof entry === 'string') return entry;
  const level = entry?.level || 'info';
  const row = Number.isInteger(entry?.rowIndex) ? `row ${entry.rowIndex + 1}` : 'system';
  const message = entry?.message || 'Log event';
  return `[${level.toUpperCase()}] ${row} - ${message}`;
};

export default function App() {
  const [taskName, setTaskName] = useState('Data Entry Bot');
  const [steps, setSteps] = useState(defaultSteps);
  const [savedTask, setSavedTask] = useState(null);
  const [savedTasks, setSavedTasks] = useState([]);
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [csvPath, setCsvPath] = useState('');
  const [loopStartOrder, setLoopStartOrder] = useState('');
  const [loopEndOrder, setLoopEndOrder] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [actionRequiredMessage, setActionRequiredMessage] = useState('');
  const [logs, setLogs] = useState([
    'Ready. Connect a CSV and run automation.',
  ]);

  const stepCount = useMemo(() => steps.length, [steps.length]);

  useEffect(() => {
    const loadTasks = async () => {
      if (!window?.api?.loadTasks) return;
      const result = await window.api.loadTasks();
      if (result?.ok) {
        setSavedTasks(result.tasks || []);
      }
    };
    loadTasks();
  }, []);

  useEffect(() => {
    if (!window?.api?.onActionRequired) return undefined;
    const unsubscribe = window.api.onActionRequired((message) => {
      setActionRequiredMessage(
        message || 'Action required. Complete the step and click Resume.',
      );
    });
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!window?.api?.onAutomationLog) {
      setLogs((prev) => [
        ...prev,
        '[WARN] system - window.api.onAutomationLog not available.',
      ]);
      return undefined;
    }

    const unsubscribe = window.api.onAutomationLog((entry) => {
      if (entry?.message?.includes('Paused. Waiting for resume')) {
        setIsPaused(true);
      }
      setLogs((prev) => [...prev, formatLog(entry)]);
    });

    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);

  const updateStep = (index, key, value) => {
    setSteps((prev) =>
      prev.map((step, i) => (i === index ? { ...step, [key]: value } : step)),
    );
  };

  const addStep = () => {
    setSteps((prev) =>
      normalizeOrder([
        ...prev,
        { order: prev.length + 1, action: 'navigate', target: '', value: '' },
      ]),
    );
  };

  const deleteStep = (index) => {
    setSteps((prev) => normalizeOrder(prev.filter((_, i) => i !== index)));
  };

  const saveTask = ({ forceNew } = {}) => {
    const nextTask = {
      id: forceNew ? undefined : savedTask?.id || undefined,
      name: taskName,
      steps: normalizeOrder(steps),
      loopStartOrder: loopStartOrder === '' ? null : Number(loopStartOrder),
      loopEndOrder: loopEndOrder === '' ? null : Number(loopEndOrder),
    };
    if (!window?.api?.saveTask) {
      setLogs((prev) => [
        ...prev,
        '[ERROR] system - window.api.saveTask not available.',
      ]);
      return;
    }
    window.api
      .saveTask(nextTask)
      .then((result) => {
        if (result?.ok) {
          setSavedTask(result.task);
          setSelectedTaskId(result.task.id);
          setSavedTasks((prev) => {
            const existing = prev.filter((task) => task.id !== result.task.id);
            return [result.task, ...existing];
          });
          setLogs((prev) => [
            ...prev,
            `[INFO] system - Task saved to ${result.dbPath}.`,
          ]);
        }
      })
      .catch((error) => {
        setLogs((prev) => [
          ...prev,
          `[ERROR] system - ${error?.message || 'Failed to save task.'}`,
        ]);
      });
  };

  const applySavedTask = () => {
    const task = savedTasks.find((item) => item.id === selectedTaskId);
    if (!task) return;
    setTaskName(task.name || 'Data Entry Bot');
    setSteps(normalizeOrder(task.steps || []));
    setLoopStartOrder(
      Number.isInteger(task.loopStartOrder) ? String(task.loopStartOrder) : '',
    );
    setLoopEndOrder(
      Number.isInteger(task.loopEndOrder) ? String(task.loopEndOrder) : '',
    );
    setSavedTask(task);
    setLogs((prev) => [...prev, `[INFO] system - Loaded task: ${task.name}.`]);
  };

  const runAutomation = async () => {
    if (!csvPath) {
      setLogs((prev) => [...prev, '[ERROR] system - Please select a CSV file.']);
      return;
    }

    if (!window?.api?.startAutomation) {
      setLogs((prev) => [
        ...prev,
        '[ERROR] system - window.api.startAutomation not available.',
      ]);
      return;
    }

    try {
      setIsRunning(true);
      setIsPaused(false);
      const payload = {
        name: taskName,
        steps: normalizeOrder(steps),
        csvPath,
        loopStartOrder: loopStartOrder === '' ? null : Number(loopStartOrder),
        loopEndOrder: loopEndOrder === '' ? null : Number(loopEndOrder),
      };
      await window.api.startAutomation(payload);
      setLogs((prev) => [...prev, '[INFO] system - Automation started.']);
    } catch (error) {
      setLogs((prev) => [
        ...prev,
        `[ERROR] system - ${error?.message || 'Failed to start automation.'}`,
      ]);
    } finally {
      setIsRunning(false);
      setIsPaused(false);
    }
  };

  const continueAutomation = async () => {
    if (!window?.api?.continueAutomation) {
      setLogs((prev) => [
        ...prev,
        '[ERROR] system - window.api.continueAutomation not available.',
      ]);
      return;
    }
    await window.api.continueAutomation();
    setIsPaused(false);
    setLogs((prev) => [...prev, '[INFO] system - Automation resumed.']);
  };

  const resumeTask = async () => {
    if (!window?.api?.resumeTask) {
      setLogs((prev) => [
        ...prev,
        '[ERROR] system - window.api.resumeTask not available.',
      ]);
      return;
    }
    await window.api.resumeTask();
    setActionRequiredMessage('');
    setLogs((prev) => [...prev, '[INFO] system - Manual step resumed.']);
  };

  const selectCsv = async () => {
    if (!window?.api?.selectCsv) {
      setLogs((prev) => [
        ...prev,
        '[ERROR] system - window.api.selectCsv not available.',
      ]);
      return;
    }
    const result = await window.api.selectCsv();
    if (result?.ok && result.path) {
      setCsvPath(result.path);
      setLogs((prev) => [...prev, `[INFO] system - CSV selected: ${result.path}`]);
    }
  };

  const closeBrowser = async () => {
    if (!window?.api?.closeBrowser) {
      setLogs((prev) => [
        ...prev,
        '[ERROR] system - window.api.closeBrowser not available.',
      ]);
      return;
    }
    await window.api.closeBrowser();
    setLogs((prev) => [...prev, '[INFO] system - Browser closed.']);
  };

  const isActionRequired = actionRequiredMessage.length > 0;

  return (
    <div className="min-h-screen px-6 py-10 md:px-12">
      {isActionRequired && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-6">
          <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-black/80 p-8 text-center shadow-soft">
            <p className="text-xs uppercase tracking-[0.3em] text-mint">
              Action Required
            </p>
            <h2 className="mt-4 text-2xl font-semibold text-fog">
              Complete the manual step
            </h2>
            <p className="mt-3 text-sm text-fog/70">{actionRequiredMessage}</p>
            <button
              className="mt-6 w-full rounded-2xl bg-ocean px-6 py-4 text-base font-semibold text-white hover:bg-ocean/90"
              onClick={resumeTask}
              type="button"
            >
              Resume Automation
            </button>
          </div>
        </div>
      )}
      <div className="mx-auto max-w-6xl space-y-10">
        <header className="flex flex-col gap-3">
          <p className="text-sm uppercase tracking-[0.3em] text-mint">Quto Studio</p>
          <h1 className="text-4xl font-semibold text-fog md:text-5xl">
            No-code browser automation
          </h1>
          <p className="max-w-2xl text-base text-fog/70">
            Design a step-by-step workflow, map it to CSV data, and run it in a live
            browser.
          </p>
        </header>

        <div className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
          <section className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-soft backdrop-blur">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">Step Builder</h2>
                <p className="text-sm text-fog/60">Configure task steps and variables.</p>
              </div>
              <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-fog/70">
                {stepCount} steps
              </span>
            </div>

            <div className="mt-6 grid gap-4">
              <label className="text-sm text-fog/70">Task Name</label>
              <input
                className="w-full rounded-xl border border-white/10 bg-white/10 px-4 py-3 text-base text-fog outline-none ring-1 ring-transparent transition focus:ring-mint"
                value={taskName}
                onChange={(event) => setTaskName(event.target.value)}
                placeholder="Data Entry Bot"
              />
            </div>

            <div className="mt-6 grid gap-4 rounded-2xl border border-white/10 bg-black/20 p-4">
              <div>
                <p className="text-sm font-semibold text-fog">Loop CSV Rows</p>
                <p className="text-xs text-fog/60">
                  Run the selected step range for each CSV row. Leave empty to run all
                  steps for every row.
                </p>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="text-xs uppercase tracking-[0.2em] text-fog/50">
                  Start Step
                  <input
                    className="mt-2 w-full rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-sm text-fog"
                    type="number"
                    min="1"
                    placeholder="3"
                    value={loopStartOrder}
                    onChange={(event) => setLoopStartOrder(event.target.value)}
                  />
                </label>
                <label className="text-xs uppercase tracking-[0.2em] text-fog/50">
                  End Step
                  <input
                    className="mt-2 w-full rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-sm text-fog"
                    type="number"
                    min="1"
                    placeholder="6"
                    value={loopEndOrder}
                    onChange={(event) => setLoopEndOrder(event.target.value)}
                  />
                </label>
              </div>
            </div>

            <div className="mt-6 space-y-4">
              {steps.map((step, index) => (
                <div
                  key={`${step.order}-${index}`}
                  className="grid gap-3 rounded-2xl border border-white/10 bg-black/20 p-4 md:grid-cols-[120px_1fr_1fr_auto]"
                >
                  <div className="space-y-1">
                    <p className="text-xs uppercase tracking-[0.2em] text-fog/50">
                      Step {step.order}
                    </p>
                    <select
                      className="w-full rounded-lg border border-white/10 bg-white/10 px-2 py-2 text-sm text-fog"
                      value={step.action}
                      onChange={(event) =>
                        updateStep(index, 'action', event.target.value)
                      }
                    >
                      {actionOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <p className="text-xs uppercase tracking-[0.2em] text-fog/50">Target</p>
                    <input
                      className="w-full rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-sm text-fog"
                      placeholder="XPath or Selector"
                      value={step.target}
                      onChange={(event) =>
                        updateStep(index, 'target', event.target.value)
                      }
                    />
                  </div>

                  <div className="space-y-1">
                    <p className="text-xs uppercase tracking-[0.2em] text-fog/50">Value</p>
                    <input
                      className="w-full rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-sm text-fog"
                      placeholder="Value or {{variable}}"
                      value={step.value}
                      onChange={(event) =>
                        updateStep(index, 'value', event.target.value)
                      }
                    />
                  </div>

                  <div className="flex items-end">
                    <button
                      className="rounded-lg border border-ember/40 bg-ember/20 px-3 py-2 text-xs font-semibold text-ember hover:bg-ember/30"
                      onClick={() => deleteStep(index)}
                      type="button"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                className="rounded-xl border border-white/10 bg-white/10 px-5 py-3 text-sm font-semibold text-fog hover:bg-white/20"
                onClick={addStep}
                type="button"
              >
                Add Step
              </button>
              <button
                className="rounded-xl bg-mint px-5 py-3 text-sm font-semibold text-ink hover:bg-mint/90"
                onClick={() => saveTask({ forceNew: true })}
                type="button"
              >
                Save New
              </button>
              <button
                className="rounded-xl border border-white/10 bg-white/10 px-5 py-3 text-sm font-semibold text-fog hover:bg-white/20"
                onClick={() => saveTask({ forceNew: false })}
                type="button"
                disabled={!savedTask}
              >
                Update
              </button>
              <div className="flex flex-1 items-center gap-3">
                <select
                  className="w-full rounded-xl border border-white/10 bg-white/10 px-4 py-3 text-sm text-fog"
                  value={selectedTaskId}
                  onChange={(event) => setSelectedTaskId(event.target.value)}
                >
                  <option value="">Select saved task</option>
                  {savedTasks.map((task) => (
                    <option key={task.id} value={task.id}>
                      {task.name}
                    </option>
                  ))}
                </select>
                <button
                  className="rounded-xl border border-white/10 bg-white/10 px-4 py-3 text-sm font-semibold text-fog hover:bg-white/20"
                  onClick={applySavedTask}
                  type="button"
                  disabled={!selectedTaskId}
                >
                  Load
                </button>
              </div>
              {savedTask && (
                <span className="self-center text-xs text-fog/60">
                  Saved: {savedTask.name}
                </span>
              )}
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-soft backdrop-blur">
            <div className="flex flex-col gap-2">
              <h2 className="text-xl font-semibold">Execution Panel</h2>
              <p className="text-sm text-fog/60">
                Select a CSV file and run the workflow.
              </p>
            </div>

            <div className="mt-6 space-y-4">
              <label className="text-sm text-fog/70">CSV File</label>
              <button
                className="w-full rounded-xl border border-dashed border-white/20 bg-white/5 px-4 py-6 text-sm text-fog/80 hover:bg-white/10"
                onClick={selectCsv}
                type="button"
              >
                {csvPath ? `Selected: ${csvPath}` : 'Choose CSV file'}
              </button>
            </div>

            <button
              className="mt-6 w-full rounded-2xl bg-ocean px-6 py-4 text-base font-semibold text-white hover:bg-ocean/90 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={runAutomation}
              type="button"
              disabled={isRunning}
            >
              {isRunning ? 'Running...' : 'Run Automation'}
            </button>

            <div className="mt-4">
              <button
                className="w-full rounded-xl border border-white/10 bg-white/10 px-4 py-3 text-sm font-semibold text-fog hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={continueAutomation}
                type="button"
                disabled={!isRunning || !isPaused}
              >
                Continue
              </button>
            </div>

            <div className="mt-3">
              <button
                className="w-full rounded-xl border border-ember/40 bg-ember/20 px-4 py-3 text-sm font-semibold text-ember hover:bg-ember/30"
                onClick={closeBrowser}
                type="button"
              >
                Close Browser Tab
              </button>
            </div>

            <div className="mt-6">
              <p className="text-xs uppercase tracking-[0.3em] text-fog/50">Logs</p>
              <div className="terminal-scrollbar mt-3 h-72 overflow-y-auto rounded-2xl bg-black/70 p-4 font-mono text-xs text-fog">
                <ul className="space-y-2">
                  {logs.map((entry, index) => (
                    <li key={`${entry}-${index}`}>{entry}</li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
