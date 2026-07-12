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
import { skills, connectors, workerColor } from "../brain";

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

function WorkerPanel({ name, onClose }: { name: string; onClose: () => void }) {
  const worker = skills.find((s) => s.name === name);
  const connectedIds = useMemo(
    () => new Set(connectors.filter((c) => c.state === "connected").map((c) => c.id)),
    []
  );
  const [enabled, setEnabled] = useState(true);
  const [ran, setRan] = useState(false);

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
