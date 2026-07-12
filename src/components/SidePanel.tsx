import { useEffect, useMemo, useState } from "react";
import { Skills } from "../pages/Skills";
import { Connectors } from "../pages/Connectors";
import { Decisions } from "../pages/Decisions";
import { Settings } from "../pages/Settings";
import { Brain } from "../pages/Brain";
import { Observability } from "../pages/Observability";
import { AddWorker } from "../pages/AddWorker";
import { AdminUsers } from "./AdminUsers";
import type { BrainDoc } from "../lib/brainDocs";
import * as Hermes from "../lib/hermesClient";
import {
  skills,
  connectors,
  workerColor,
  type Skill,
  type CronSchedule,
  type WorkerChain,
  type ABTestConfig,
} from "../brain";

export type PanelId = "settings" | "connections" | "workers" | "activity" | "brain" | "traces" | "addworker" | "adminusers";

const TITLES: Record<PanelId, string> = {
  settings: "Settings",
  connections: "Connections",
  workers: "Workers",
  activity: "Activity",
  brain: "Under the hood",
  traces: "Observability",
  addworker: "Add a worker",
  adminusers: "User Management",
};

function DocumentPanel({
  docId,
  onClose,
}: {
  docId: string;
  onClose: () => void;
}) {
  const [meta, setMeta] = useState<BrainDoc | null>(null);
  const [body, setBody] = useState("");
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState<"idle" | "saving" | "done">("idle");

  useEffect(() => {
    let alive = true;
    setEditing(false);
    setSaved("idle");
    Hermes.listDocs().then((all) => {
      if (!alive) return;
      const next = all.find((d) => d.id === docId) ?? null;
      setMeta(next);
      setBody(next?.body ?? "");
    });
    return () => {
      alive = false;
    };
  }, [docId]);

  if (!meta) return null;

  async function toggleEdit() {
    if (editing) {
      // leaving edit mode → write the file back to Hermes' brain/
      setSaved("saving");
      try {
        await Hermes.saveDoc(meta.rel, body);
        setSaved("done");
      } catch {
        setSaved("idle");
      }
    }
    setEditing((v) => !v);
  }

  async function copyDoc() {
    await navigator.clipboard.writeText(body);
  }

  function downloadDoc() {
    const blob = new Blob([body], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = meta.name;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <div className="side-panel-head doc-side-head">
        <div className="doc-panel-title">
          <span className="doc-ico">📄</span>
          <div>
            <h2>{meta.title}</h2>
            <code className="doc-path">brain/{meta.rel}</code>
          </div>
        </div>
        <div className="doc-actions">
          <button type="button" onClick={copyDoc}>
            Copy
          </button>
          <button type="button" className={editing ? "on" : ""} onClick={toggleEdit}>
            {editing ? "Save" : saved === "done" ? "Saved ✓" : "Edit"}
          </button>
          <button type="button" onClick={downloadDoc}>
            Download
          </button>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
      </div>
      <div className="side-panel-body doc-side-body">
        {editing ? (
          <textarea
            className="doc-editor"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            spellCheck={false}
          />
        ) : (
          <pre className="doc-view">{body}</pre>
        )}
      </div>
    </>
  );
}

function ScheduleSection({ schedule, workerName }: { schedule: CronSchedule; workerName: string }) {
  const [sched, setSched] = useState(schedule);
  const [editing, setEditing] = useState(false);
  const [draftExpr, setDraftExpr] = useState(schedule.expression);

  function toggleSchedule() {
    const next = { ...sched, enabled: !sched.enabled };
    setSched(next);
    void Hermes.setWorkerEnabled(workerName, next.enabled);
  }

  function saveSchedule() {
    if (!draftExpr.trim()) return;
    const label =
      draftExpr === "0 7 * * 1-5"
        ? "Weekdays at 7:00 AM"
        : draftExpr === "0 9 * * 1-5"
          ? "Weekdays at 9:00 AM"
          : draftExpr === "0 8 * * *"
            ? "Daily at 8:00 AM"
            : `Cron: ${draftExpr}`;
    setSched({ ...sched, expression: draftExpr.trim(), label, enabled: true });
    setEditing(false);
  }

  return (
    <div className="setting">
      <div className="setting-k">
        Schedule
        <button
          className="text-mini"
          style={{ marginLeft: 8 }}
          onClick={() => setEditing((v) => !v)}
        >
          {editing ? "Cancel" : "Edit"}
        </button>
      </div>
      <div className="setting-v">
        {editing ? (
          <div className="schedule-edit">
            <input
              className="schedule-input"
              value={draftExpr}
              onChange={(e) => setDraftExpr(e.target.value)}
              placeholder="0 7 * * 1-5"
            />
            <span className="muted" style={{ fontSize: 11 }}>
              Standard cron syntax: minute hour day month weekday
            </span>
            <button className="btn-primary" style={{ marginTop: 6 }} onClick={saveSchedule}>
              Set schedule
            </button>
          </div>
        ) : (
          <>
            <div className="schedule-display">
              <button
                className={`toggle ${sched.enabled ? "on" : ""}`}
                onClick={toggleSchedule}
              >
                <span className="knob" />
              </button>
              <span className="toggle-label">{sched.enabled ? "On" : "Paused"}</span>
            </div>
            <code className="spec" style={{ marginTop: 8 }}>
              {sched.expression} — {sched.label}
            </code>
            {sched.nextRun && (
              <div className="skill-meta" style={{ marginTop: 6 }}>
                Next run: {sched.nextRun}
                {sched.lastRun && ` · Last: ${sched.lastRun}`}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ChainSection({ chain, workerName }: { chain: WorkerChain; workerName: string }) {
  const [display, setDisplay] = useState(chain);
  const [draftNext, setDraftNext] = useState(display.nextWorker);
  const [draftCond, setDraftCond] = useState(display.condition);
  const [draftDelay, setDraftDelay] = useState(display.delayMinutes ?? 0);
  const [editing, setEditing] = useState(false);

  const otherWorkers = skills.filter((s) => s.name !== workerName);

  function saveChain() {
    if (!draftNext.trim() || !otherWorkers.find((w) => w.name === draftNext.trim())) return;
    setDisplay({ nextWorker: draftNext.trim(), condition: draftCond, delayMinutes: draftDelay });
    setEditing(false);
  }

  return (
    <div className="setting">
      <div className="setting-k">
        Chain
        <button
          className="text-mini"
          style={{ marginLeft: 8 }}
          onClick={() => setEditing((v) => !v)}
        >
          {editing ? "Cancel" : "Edit"}
        </button>
      </div>
      <div className="setting-v">
        {editing ? (
          <div className="chain-edit">
            <div className="field">
              <span>Next worker</span>
              <select
                className="schedule-input"
                value={draftNext}
                onChange={(e) => setDraftNext(e.target.value)}
              >
                {otherWorkers.map((w) => (
                  <option key={w.name} value={w.name}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ marginTop: 8 }}>
              <span>Trigger condition</span>
              <div className="addw-auto">
                <button
                  type="button"
                  className={draftCond === "always" ? "on" : ""}
                  onClick={() => setDraftCond("always")}
                >
                  Always
                </button>
                <button
                  type="button"
                  className={draftCond === "on_success" ? "on" : ""}
                  onClick={() => setDraftCond("on_success")}
                >
                  On success
                </button>
                <button
                  type="button"
                  className={draftCond === "on_failure" ? "on" : ""}
                  onClick={() => setDraftCond("on_failure")}
                >
                  On failure
                </button>
              </div>
            </div>
            <div className="field" style={{ marginTop: 8 }}>
              <span>Delay (minutes)</span>
              <input
                className="schedule-input"
                type="number"
                min={0}
                max={1440}
                value={draftDelay}
                onChange={(e) => setDraftDelay(Number(e.target.value))}
              />
            </div>
            <button className="btn-primary" style={{ marginTop: 8 }} onClick={saveChain}>
              Save chain
            </button>
          </div>
        ) : (
          <div className="chain-display">
            <div className="chain-flow">
              <span className="chain-worker">{workerName}</span>
              <span className="chain-arrow">→</span>
              <span
                className="chain-worker"
                style={{ background: workerColor[display.nextWorker] ?? "#555" }}
              >
                {display.nextWorker}
              </span>
            </div>
            <div className="chain-meta">
              On {display.condition === "always" ? "completion" : display.condition === "on_success" ? "success" : "failure"}
              {display.delayMinutes ? ` · ${display.delayMinutes} min delay` : ""}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ABTestSection({ abTest }: { abTest: ABTestConfig }) {
  const [showAll, setShowAll] = useState(false);

  const a = abTest.variants[0];
  const b = abTest.variants[1];
  const totalRuns = a.runs + b.runs;

  return (
    <div className="setting">
      <div className="setting-k">
        A/B Test
        <button
          className="text-mini"
          style={{ marginLeft: 8 }}
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll ? "Less" : "Details"}
        </button>
      </div>
      <div className="setting-v">
        <div className="ab-summary">
          <div className="ab-bar">
            <div className="ab-bar-track">
              <div
                className="ab-bar-fill"
                style={{ width: `${abTest.splitB}%`, background: workerColor[b.name] ?? "#a855f7" }}
              />
            </div>
            <div className="ab-split-labels">
              <span>{100 - abTest.splitB}% {a.name}</span>
              <span>{abTest.splitB}% {b.name}</span>
            </div>
          </div>
          <div className="ab-variants">
            <div className="ab-variant">
              <span className="ab-vname">A: {a.name}</span>
              <span className="ab-vstat">{a.runs} runs · {a.successRate}% success</span>
            </div>
            <div className="ab-variant">
              <span className="ab-vname">B: {b.name}</span>
              <span className="ab-vstat">{b.runs} runs · {b.successRate}% success</span>
            </div>
          </div>
          {totalRuns > 0 && (
            <div className="ab-overall">
              {totalRuns} total runs{abTest.startedAt ? ` · started ${abTest.startedAt}` : ""}
            </div>
          )}
          {showAll && (
            <div className="ab-detail">
              <div className="step-label">Variant A</div>
              <div className="clause">{a.purpose}</div>
              <div className="step-label" style={{ marginTop: 8 }}>Variant B</div>
              <div className="clause">{b.purpose}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function WorkerPanel({ name, onClose }: { name: string; onClose: () => void }) {
  const worker = skills.find((s) => s.name === name);
  const connectedIds = useMemo(
    () => new Set(connectors.filter((c) => c.state === "connected").map((c) => c.id)),
    []
  );
  const [enabled, setEnabled] = useState(true);
  const [ran, setRan] = useState(false);

  // Find which workers chain to this one (incoming chains)
  const chainedFrom = skills.filter(
    (s) => s.chain?.nextWorker === name && s.name !== name
  );

  if (!worker) return null;

  const missing = worker.requires.filter((r) => !connectedIds.has(r));
  const configured = missing.length === 0;

  async function runNow() {
    setRan(true);
    await Hermes.runWorker(name);
    setTimeout(() => setRan(false), 1500);
  }

  function toggle() {
    const next = !enabled;
    setEnabled(next);
    void Hermes.setWorkerEnabled(name, next);
  }

  return (
    <>
      <div className="side-panel-head doc-side-head">
        <div className="doc-panel-title">
          <span className="agent-ico lg" style={{ background: workerColor[name] ?? "#333" }}>
            {name.slice(0, 1).toUpperCase()}
          </span>
          <div>
            <h2 style={{ textTransform: "capitalize" }}>{name}</h2>
            <code className="doc-path">{worker.arm} worker</code>
          </div>
        </div>
        <div className="doc-actions">
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
      </div>
      <div className="side-panel-body">
        <div className={`worker-status ${configured ? "ok" : "warn"}`}>
          <span className="worker-dot on" />
          {configured ? "Configured & ready" : "Needs setup before it can run"}
        </div>

        <div className="setting">
          <div className="setting-k">What it does</div>
          <div className="setting-v">{worker.purpose}</div>
        </div>

        <div className="setting">
          <div className="setting-k">Autonomy</div>
          <div className="setting-v">
            {worker.autonomy === "careful"
              ? "Careful — drafts everything, waits for your OK"
              : "Auto — handles routine items itself, asks on exceptions"}
          </div>
        </div>

        <div className="setting">
          <div className="setting-k">Needs these connections</div>
          <div className="setting-v">
            {worker.requires.length === 0 ? (
              <span className="muted">No connections needed — always available.</span>
            ) : (
              <div className="req-list">
                {worker.requires.map((r) => {
                  const c = connectors.find((x) => x.id === r);
                  const ok = connectedIds.has(r);
                  return (
                    <div key={r} className={`req ${ok ? "ok" : "missing"}`}>
                      <span className={`worker-dot ${ok ? "on" : "off"}`} />
                      {c?.name ?? r}
                      <span className="req-state">{ok ? "connected" : "connect"}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Schedule section */}
        {worker.schedule && <ScheduleSection schedule={worker.schedule} workerName={name} />}

        {/* Chain section — outgoing */}
        {worker.chain && <ChainSection chain={worker.chain} workerName={name} />}

        {/* Chain section — incoming */}
        {chainedFrom.length > 0 && (
          <div className="setting">
            <div className="setting-k">Triggered by</div>
            <div className="setting-v">
              <div className="chain-display">
                {chainedFrom.map((cf) => (
                  <div key={cf.name} className="chain-flow" style={{ marginBottom: 4 }}>
                    <span
                      className="chain-worker"
                      style={{ background: workerColor[cf.name] ?? "#555" }}
                    >
                      {cf.name}
                    </span>
                    <span className="chain-arrow">→</span>
                    <span className="chain-worker">{name}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* A/B Test section */}
        {worker.abTest && <ABTestSection abTest={worker.abTest} />}

        <div className="setting">
          <div className="setting-k">Activity</div>
          <div className="setting-v mono">
            {worker.runs} runs · last {worker.lastRun}
          </div>
        </div>

        <div className="worker-controls">
          <button className={`toggle ${enabled ? "on" : ""}`} onClick={toggle}>
            <span className="knob" />
          </button>
          <span className="toggle-label">{enabled ? "On" : "Paused"}</span>
          <button className="btn-white" onClick={runNow} disabled={!configured || ran}>
            {ran ? "Running…" : "Run now"}
          </button>
        </div>
      </div>
    </>
  );
}

export function SidePanel({
  panel,
  docId,
  workerName,
  onClose,
}: {
  panel: PanelId | null;
  docId: string | null;
  workerName: string | null;
  onClose: () => void;
}) {
  if (!panel && !docId && !workerName) return null;

  const isDoc = Boolean(docId);
  const isWorker = Boolean(workerName);
  const title = isWorker ? "Worker" : isDoc ? "Document" : TITLES[panel!];

  return (
    <div className="side-overlay" onClick={onClose}>
      <aside
        className={`side-panel ${panel === "traces" ? "obs-wide" : isDoc ? "doc-wide" : panel === "adminusers" ? "admin-wide" : ""}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={title}
      >
        {isWorker && workerName ? (
          <WorkerPanel name={workerName} onClose={onClose} />
        ) : isDoc && docId ? (
          <DocumentPanel docId={docId} onClose={onClose} />
        ) : (
          <>
            <div className="side-panel-head">
              <h2>{TITLES[panel!]}</h2>
              <button className="icon-btn" onClick={onClose} aria-label="Close">
                ✕
              </button>
            </div>
            <div className="side-panel-body">
              {panel === "settings" && <Settings />}
              {panel === "connections" && <Connectors />}
              {panel === "workers" && <Skills />}
              {panel === "activity" && <Decisions />}
              {panel === "brain" && <Brain />}
              {panel === "traces" && <Observability />}
              {panel === "addworker" && <AddWorker onClose={onClose} />}
              {panel === "adminusers" && <AdminUsers />}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
