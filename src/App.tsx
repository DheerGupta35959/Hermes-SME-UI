import { useEffect, useRef, useState } from "react";
import { Home } from "./pages/Home";
import { SidePanel, type PanelId } from "./components/SidePanel";
import { useAuth } from "./components/AuthContext";
import * as Hermes from "./lib/hermesClient";
import type { TerminalLine } from "./lib/hermesClient";

export default function App() {
  const { user, logout, hasRole } = useAuth();
  const [panel, setPanel] = useState<PanelId | null>(null);
  const [docId, setDocId] = useState<string | null>(null);
  const [workerName, setWorkerName] = useState<string | null>(null);
  const [termOpen, setTermOpen] = useState(true);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  const [log, setLog] = useState<TerminalLine[]>([]);
  const [stream, setStream] = useState<Hermes.AleraState["stream"]>([]);
  const [cmd, setCmd] = useState("");
  const [busy, setBusy] = useState(false);
  const [bizName, setBizName] = useState("");
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    Hermes.getBusiness().then((b) => {
      if (alive && b?.name) setBizName(b.name);
    });
    return () => {
      alive = false;
    };
  }, []);
  const workspaceName = bizName || "Hermes SME";

  const needsYou = stream.filter((s) => s.stage === "awaiting").length;
  const done = stream.filter((s) => s.stage === "done").length;
  const live = log.findLast?.((a) => a.now) ?? log[log.length - 1];

  // Two-way: read Hermes state on mount, then poll for changes.
  useEffect(() => {
    let alive = true;
    Hermes.getState()
      .then((s) => {
        if (!alive) return;
        setLog(s.activity);
        setStream(s.stream);
      })
      .catch(() => {
        /* Hermes not up yet — the poll below will retry */
      });
    const stop = Hermes.subscribe((s) => {
      setLog(s.activity);
      setStream(s.stream);
    });
    return () => {
      alive = false;
      stop();
    };
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: "end" });
  }, [log]);

  useEffect(() => {
    if (!profileOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!profileRef.current?.contains(e.target as Node)) setProfileOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setProfileOpen(false);
    };
    document.addEventListener("click", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [profileOpen]);

  async function sendCommand(e: React.FormEvent) {
    e.preventDefault();
    const text = cmd.trim();
    if (!text || busy) return;
    setCmd("");
    setBusy(true);
    setLog((prev) => [...prev.map((l) => ({ ...l, now: false })), { skill: "you", text }]);
    try {
      const lines = await Hermes.command(text);
      setLog((prev) => [...prev, ...lines]);
    } catch {
      setLog((prev) => [...prev, { skill: "error", text: "Hermes did not respond." }]);
    } finally {
      setBusy(false);
    }
  }

  function openFromProfile(id: PanelId) {
    setProfileOpen(false);
    setDocId(null);
    setWorkerName(null);
    setPanel(id);
  }

  function openPanel(id: PanelId) {
    setDocId(null);
    setWorkerName(null);
    setPanel(id);
  }

  function openDoc(id: string) {
    setPanel(null);
    setWorkerName(null);
    setDocId(id);
  }

  function openWorker(name: string) {
    setPanel(null);
    setDocId(null);
    setWorkerName(name);
  }

  function closeDrawer() {
    setPanel(null);
    setDocId(null);
    setWorkerName(null);
  }

  return (
    <div className={`app ${termOpen ? "" : "term-collapsed"}`}>
      <header className="topbar">
        <div className="topbar-left">
          <button
            className={`term-toggle ${termOpen ? "on" : ""}`}
            title={termOpen ? "Collapse terminal" : "Expand terminal"}
            onClick={() => setTermOpen((v) => !v)}
          >
            <span className={`live-dot ${Hermes.isLive ? "on" : ""}`} />
            Terminal
            <span className="chev">{termOpen ? "▾" : "▸"}</span>
          </button>
          <button className="workspace">
            <span className="brand-mark">{workspaceName.charAt(0).toUpperCase()}</span>
            {workspaceName}
            <span className="chev">▾</span>
          </button>
          <span className="terminal-brand">
            <span className="skull">◆</span> Hermes SME
            <span className={`conn-tag ${Hermes.isLive ? "on" : ""}`}>
              {Hermes.isLive ? "Hermes live" : "demo"}
            </span>
          </span>
        </div>
        <div className="topbar-center mono">
          {live && (
            <span>
              &gt; [{live.skill}] {live.text}
            </span>
          )}
        </div>
        <div className="topbar-right" ref={profileRef}>
          <button
            className={`userpill ${profileOpen ? "open" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              setProfileOpen(!profileOpen);
            }}
            aria-expanded={profileOpen}
            aria-haspopup="menu"
          >
            <span className="avatar">{user?.displayName?.charAt(0) || "M"}</span>
            <span className="user-meta">
              <b>{user?.displayName || "User"}</b>
              <em>
                {done} done · {needsYou} need you
              </em>
            </span>
            <span className="chev">▾</span>
          </button>

          {profileOpen && (
            <div className="profile-menu" role="menu">
              <div className="profile-menu-head">
                <span className="avatar lg">{user?.displayName?.charAt(0) || "M"}</span>
                <div>
                  <b>{user?.displayName || "User"}</b>
                  <em>{user?.email || ""}</em>
                </div>
                <button className="btn-upgrade" type="button">
                  Upgrade
                </button>
              </div>
              <div className="profile-credits">
                Careful mode · {needsYou} waiting for you
              </div>
              <button role="menuitem" onClick={() => openFromProfile("connections")}>
                Integrations
              </button>
              <button role="menuitem" onClick={() => openFromProfile("settings")}>
                Settings <span className="menu-dot" />
              </button>
              <button role="menuitem" onClick={() => openFromProfile("activity")}>
                Activity
              </button>
              <button role="menuitem" type="button">
                Language
              </button>
              {hasRole("Admin") && (
                <>
                  <div className="profile-sep" />
                  <button role="menuitem" onClick={() => openFromProfile("adminusers")}>
                    User Management
                  </button>
                </>
              )}
              <div className="profile-sep" />
              <button role="menuitem" onClick={() => openFromProfile("addworker")}>
                + Add worker
              </button>
              <button role="menuitem" onClick={() => openFromProfile("brain")}>
                Under the hood
              </button>
              <button role="menuitem" onClick={() => openFromProfile("traces")}>
                Observability
              </button>
              <div className="profile-sep" />
              <button role="menuitem" className="danger" type="button" onClick={logout}>
                Log out
              </button>
            </div>
          )}
        </div>
      </header>

      {termOpen && (
        <div className="terminal">
          <div className="terminal-log mono">
            {log.map((a, i) => (
              <div key={i} className={a.now ? "now" : ""}>
                &gt; [{a.skill}] {a.text}
                {a.now ? " ▍" : ""}
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
          <form className="terminal-input mono" onSubmit={sendCommand}>
            <span className="prompt">&gt;</span>
            <input
              value={cmd}
              onChange={(e) => setCmd(e.target.value)}
              placeholder={Hermes.isLive ? "run a command on Hermes…" : "type a command (demo)…"}
              disabled={busy}
            />
          </form>
        </div>
      )}

      <main className="main">
        <Home
          onOpenPanel={openPanel}
          onOpenDoc={openDoc}
          openDocId={docId}
          onOpenWorker={openWorker}
          openWorkerName={workerName}
        />
      </main>

      <SidePanel panel={panel} docId={docId} workerName={workerName} onClose={closeDrawer} />
    </div>
  );
}
