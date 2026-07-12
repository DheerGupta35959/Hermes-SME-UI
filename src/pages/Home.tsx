import { useEffect, useRef, useState } from "react";
import { marked } from "marked";
import * as Brain from "../lib/brainLayer";
import * as Hermes from "../lib/hermesClient";
import type { BrainDoc } from "../lib/brainDocs";
import { skills, connectors, workerColor, type Skill } from "../brain";
import type { StreamItem, Verdict, Answer } from "../lib/brainLayer";

const STAGE_LABEL: Record<string, string> = {
  inbox: "new",
  checking: "checking rules",
  drafting: "drafting",
  awaiting: "needs your OK",
  done: "done",
  declined: "declined by rules",
};

// Human-readable relative time ("just now", "5 min ago", then an absolute date).
function timeAgo(iso?: string | null): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (isNaN(t)) return "";
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 45) return "just now";
  if (s < 90) return "1 min ago";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// which worker owns a given stream item (for the live feed)
function workerFor(item: StreamItem): string {
  if (item.verdict.status === "rejected") return "rule keeper";
  if (item.sources.includes("feedback")) return "product insights";
  if (item.sources.includes("review")) return "reviews & reputation";
  if (item.sources.includes("billing")) return "payments & invoicing";
  if (item.sources.includes("calendar")) return "orders & fulfillment";
  if (item.origin === "proactive") return "follow-ups";
  return "inbox responder";
}

export function Home({
  onOpenPanel,
  onOpenDoc,
  openDocId,
  onOpenWorker,
  openWorkerName,
}: {
  onOpenPanel: (panel: "settings" | "connections" | "workers" | "activity" | "brain") => void;
  onOpenDoc: (id: string) => void;
  openDocId: string | null;
  onOpenWorker: (name: string) => void;
  openWorkerName: string | null;
}) {
  const m = Brain.mission();
  // Documents are live from Hermes. We start with the core business docs
  // (root-level: rules/strategy/product/decisions) and the list grows on its own
  // as Hermes writes new documents into brain/. Signals/clusters/etc. (subfolders)
  // stay under "Under the hood", not here.
  const [docs, setDocs] = useState<BrainDoc[]>([]);
  useEffect(() => {
    let alive = true;
    const ORDER = ["mission.md", "strategy.md", "product.md", "decisions.md"];
    const rank = (n: string) => (ORDER.indexOf(n) === -1 ? 99 : ORDER.indexOf(n));
    const load = () =>
      Hermes.listDocs().then((all) => {
        if (!alive) return;
        const root = all.filter((d) => d.dir === "").sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
        setDocs(root);
      });
    load();
    const t = window.setInterval(load, 10000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, []);
  const [items, setItems] = useState<StreamItem[]>([]);
  const [companyOpen, setCompanyOpen] = useState(true);
  const [query, setQuery] = useState("");
  const [thinking, setThinking] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  // chat message controls: one play/pause audio at a time + copy feedback
  const [audioIdx, setAudioIdx] = useState<number | null>(null);
  const [audioState, setAudioState] = useState<"idle" | "loading" | "playing" | "paused">("idle");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlCacheRef = useRef<Map<number, string>>(new Map());
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  async function toggleAudio(i: number, text: string) {
    const cur = audioRef.current;
    if (audioIdx === i && cur) {
      if (audioState === "playing") {
        cur.pause();
        setAudioState("paused");
      } else {
        await cur.play().catch(() => {});
        setAudioState("playing");
      }
      return;
    }
    if (cur) cur.pause();
    setAudioIdx(i);
    setAudioState("loading");
    try {
      let url = urlCacheRef.current.get(i);
      if (!url) {
        url = await Hermes.ttsUrl(text);
        urlCacheRef.current.set(i, url);
      }
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => setAudioState("idle");
      await audio.play();
      setAudioState("playing");
    } catch {
      setAudioState("idle");
      setAudioIdx(null);
    }
  }

  async function copyMsg(i: number, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIdx(i);
      setTimeout(() => setCopiedIdx((v) => (v === i ? null : v)), 1500);
    } catch {
      /* clipboard blocked */
    }
  }
  const [editingCompany, setEditingCompany] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [companyAbout, setCompanyAbout] = useState("");
  const [draftName, setDraftName] = useState("");
  const [draftAbout, setDraftAbout] = useState("");
  const [savingBiz, setSavingBiz] = useState(false);

  const displayName = companyName || "Set up your business";
  const logoLetter = (companyName || "A").trim().charAt(0).toUpperCase();

  function openCompanyEditor() {
    setDraftName(companyName);
    setDraftAbout(companyAbout);
    setEditingCompany(true);
  }

  async function saveCompany() {
    setSavingBiz(true);
    const name = draftName.trim();
    setCompanyName(name);
    setCompanyAbout(draftAbout);
    const firstTime = !isSetup;
    // personalize the greeting once the business is known
    setMessages((prev) => {
      const next = [...prev];
      const greeting = `hi — i'm Alera, your ${name} assistant. ask me anything, or approve the items that need you on the left.`;
      if (next[0]?.role === "ai") next[0] = { role: "ai", text: greeting };
      return next;
    });
    try {
      const res = await Hermes.saveBusiness(name, draftAbout);
      setIsSetup(true);
      if (firstTime) {
        const workers = res.workers?.length
          ? res.workers.map((w) => `- ${w}`).join("\n")
          : "- inbox responder\n- orders & fulfillment\n- reminders\n- follow-ups\n- reviews & reputation\n- product insights";
        const docs = res.docs?.length ? res.docs : ["Return & refund policy", "Shipping & delivery", "FAQ / sizing guide"];
        setMessages((prev) => [
          ...prev,
          { role: "ai", text: `✓ saved **${name}** to my memory — i'll remember it every session.\n\ni've set up your workers:\n\n${workers}` },
          {
            role: "ai",
            text: `to answer customers accurately, i still need a few details. want me to start these documents?\n\n${docs
              .map((d) => `- ${d}`)
              .join("\n")}\n\nreply **yes** and i'll draft them, or open **Documents** on the left.`,
          },
        ]);
      }
    } catch {
      /* keep local change even if the agent write fails */
    } finally {
      setSavingBiz(false);
      setEditingCompany(false);
    }
  }
  const SETUP_GREETING =
    "👋 i'm **Alera** — let's get you set up. click **✎ Edit business** (top-left) and tell me your business name and what you do. i'll configure your workers, save it to memory, and help you fill in the key documents.";
  const [isSetup, setIsSetup] = useState(false);
  const [messages, setMessages] = useState<{ role: "user" | "ai"; text: string; meta?: Answer }[]>([
    { role: "ai", text: SETUP_GREETING },
  ]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, thinking]);

  // Live Feed + Workers both read the SAME source: the real crew stream from
  // Hermes (polled). Everything the feed shows and every worker's activity is
  // the same set of runs, so the two columns stay in sync.
  useEffect(() => {
    const apply = (s: Hermes.AleraState) => setItems(s.stream);
    Hermes.getState().then(apply).catch(() => {});
    return Hermes.subscribe(apply);
  }, []);

  // hydrate from Hermes: if a business profile is already saved, skip setup
  useEffect(() => {
    let alive = true;
    Hermes.getBusiness().then((b) => {
      if (!alive || !b?.name) return;
      setCompanyName(b.name);
      setCompanyAbout(b.about);
      setIsSetup(true);
      setMessages((prev) => {
        const greeting = `hi — i'm Alera, your ${b.name} assistant. ask me anything, or approve the items that need you on the left.`;
        if (prev.length === 1 && prev[0].role === "ai") return [{ role: "ai", text: greeting }];
        return prev;
      });
    });
    return () => {
      alive = false;
    };
  }, []);

  const connectedIds = new Set(connectors.filter((c) => c.state === "connected").map((c) => c.id));
  const isConfigured = (s: Skill) => s.requires.every((r) => connectedIds.has(r));
  // Connections shown to the owner = the four we really wired, with live status.
  const liveConns = connectors.filter((c) => c.tier === "live");
  const [ch, setCh] = useState<Hermes.ChannelStatus | null>(null);
  useEffect(() => {
    Hermes.channels().then(setCh);
  }, []);
  const connOn = (key?: string) => (key && ch ? Boolean(ch[key as keyof Hermes.ChannelStatus]) : false);

  // The worker for an item = the real specialist the manager routed to (live
  // runs), falling back to the heuristic for any mock/demo items.
  const workerOf = (it: StreamItem) => it.specialist || workerFor(it);
  // live feed = every stream item, newest/most-urgent first, tagged with its worker
  const feed = items.map((it) => ({ item: it, worker: workerOf(it) }));
  const pendingFeed = feed.filter((f) => f.item.stage === "awaiting");
  const activityFeed = feed.filter((f) => f.item.stage !== "awaiting");

  const renderExecRow = ({ item: it, worker }: { item: StreamItem; worker: string }) => (
    <div key={it.id} className={`exec-row ${it.stage}`}>
      <span className="exec-ico" style={{ background: workerColor[worker] ?? "#333" }}>
        {worker.slice(0, 1).toUpperCase()}
      </span>
      <div className="exec-body">
        <div className="exec-top">
          <button className="exec-worker" onClick={() => onOpenWorker(worker)}>
            {worker}
          </button>
          <span className={`exec-stage ${it.stage}`}>{STAGE_LABEL[it.stage]}</span>
          {it.at && <span className="exec-time" title={new Date(it.at).toLocaleString()}>{timeAgo(it.at)}</span>}
        </div>
        <div className="exec-title">{it.title}</div>
        {(it.customer || it.channel) && (
          <div className="exec-who">{it.customer ?? "customer"}{it.channel ? ` · ${it.channel}` : ""}</div>
        )}
        {it.verdict.missionLine && <div className="exec-meta">rule · {it.verdict.missionLine}</div>}
        {it.stage === "awaiting" && (
          <div className="exec-actions">
            <button className="btn-primary" onClick={() => approve(it)}>
              Approve & send
            </button>
            <button className="btn-ghost" onClick={() => override(it)}>
              Decline
            </button>
          </div>
        )}
        {it.outcome && it.stage !== "awaiting" && <div className="exec-outcome">{it.outcome}</div>}
      </div>
    </div>
  );

  async function runAsk(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim() || thinking) return;
    const q = query.trim();
    setQuery("");
    const history = messages.map((m) => ({ role: m.role, text: m.text }));
    setMessages((prev) => [...prev, { role: "user", text: q }]);
    setThinking(true);
    try {
      const a = await Hermes.ask(q, history);
      setMessages((prev) => [...prev, { role: "ai", text: a.text, meta: a }]);
    } catch {
      setMessages((prev) => [...prev, { role: "ai", text: "hmm, i couldn't reach the agent just now — try again." }]);
    } finally {
      setThinking(false);
    }
  }

  function approve(item: StreamItem) {
    // optimistic UI, then tell Hermes to actually act
    setItems((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, stage: "done", outcome: "✓ approved & sent" } : i))
    );
    void Hermes.approve(item.id);
  }

  function override(item: StreamItem) {
    const flipped: Verdict = {
      ...item.verdict,
      status: item.verdict.status === "rejected" ? "approved" : "rejected",
    };
    setItems((prev) =>
      prev.map((i) =>
        i.id === item.id
          ? {
              ...i,
              verdict: flipped,
              outcome: flipped.status === "rejected" ? "stopped (your call)" : "going ahead (your call)",
            }
          : i
      )
    );
    void Hermes.override(item.id, flipped);
  }

  return (
    <div className={`grid4 ${companyOpen ? "" : "company-collapsed"}`}>
      <section className={`col company-col ${companyOpen ? "" : "collapsed"}`}>
        {companyOpen ? (
          <>
            <div className="col-head">
              <h3>Company</h3>
              <div className="col-head-actions">
                <button className="icon-btn" onClick={() => onOpenPanel("brain")} title="Under the hood">
                  ⤢
                </button>
                <button
                  className="icon-btn"
                  onClick={() => setCompanyOpen(false)}
                  title="Collapse company"
                  aria-label="Collapse company"
                >
                  ‹
                </button>
              </div>
            </div>

            <div className="col-body">
              <div className="company-hero">
                <div className="company-logo">{logoLetter}</div>
                <div className={`company-name ${companyName ? "" : "placeholder"}`}>{displayName}</div>
                <button
                  className="company-edit"
                  onClick={openCompanyEditor}
                  title="Edit business"
                  aria-label="Edit business"
                >
                  <span className="pencil-flip">✎</span>
                </button>
              </div>
              <p className="company-blurb">
                {companyAbout || "Tell me about your business so I can help — click ✎ to start."}
              </p>

              <div className="subhead">Documents</div>
              <ul className="doc-list">
                {docs.map((d) => (
                  <li key={d.id}>
                    <button
                      className={`doc-item ${openDocId === d.id ? "on" : ""}`}
                      onClick={() => {
                        setCompanyOpen(true);
                        onOpenDoc(d.id);
                      }}
                    >
                      <span className="doc-ico">📄</span>
                      <span className="doc-title">{d.title}</span>
                      <span className="chev">›</span>
                    </button>
                  </li>
                ))}
              </ul>

              <div className="subhead">
                Connections{" "}
                <button className="text-mini" onClick={() => onOpenPanel("connections")}>
                  Edit
                </button>
              </div>
              <div className="comp-grid">
                {liveConns.map((c) => (
                  <a key={c.id} className="comp-chip" href="#" onClick={(e) => e.preventDefault()}>
                    <span className={`comp-dot ${connOn(c.statusKey) ? "" : "off"}`} />
                    {c.name}
                  </a>
                ))}
              </div>
            </div>
          </>
        ) : (
          <div className="company-rail">
            <button className="rail-btn brand" onClick={() => setCompanyOpen(true)} title="Expand company">
              {logoLetter}
            </button>
            <button className="rail-btn" onClick={() => setCompanyOpen(true)} title="Documents">
              📄
            </button>
            <button className="rail-btn" onClick={() => onOpenPanel("connections")} title="Connections">
              ◎
            </button>
            <button className="rail-btn" onClick={() => onOpenPanel("activity")} title="Activity">
              ▤
            </button>
            <div className="rail-spacer" />
            <button className="rail-btn" onClick={() => onOpenPanel("settings")} title="Settings">
              ⚙
            </button>
            <button className="rail-btn" onClick={() => setCompanyOpen(true)} title="Expand" aria-label="Expand company">
              ›
            </button>
          </div>
        )}
      </section>

      {/* Col 2 — Workers (click → right panel with skill info) */}
      <section className="col">
        <div className="col-head">
          <h3>
            Workers <span className="col-count">{skills.length}</span>
          </h3>
          <button className="icon-btn" onClick={() => onOpenPanel("workers")} title="All workers">
            ⚙
          </button>
        </div>
        <div className="col-body feed-body">
          {skills.map((s) => {
            const configured = isConfigured(s);
            const handled = items.filter((i) => workerOf(i) === s.name).length;
            const pending = items.filter(
              (i) => i.stage === "awaiting" && workerOf(i) === s.name
            ).length;
            const active = handled > 0;
            return (
              <button
                key={s.name}
                className={`worker-row ${openWorkerName === s.name ? "on" : ""}`}
                onClick={() => onOpenWorker(s.name)}
              >
                <span className="agent-ico" style={{ background: workerColor[s.name] ?? "#333" }}>
                  {s.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="agent-info">
                  <b>{s.name}</b>
                  <em>
                    {active
                      ? `${handled} handled${pending > 0 ? ` · ${pending} waiting` : " this session"}`
                      : configured
                        ? "ready"
                        : "needs setup"}
                  </em>
                </span>
                {pending > 0 && <span className="worker-badge">{pending}</span>}
                <span className={`worker-dot ${active || configured ? "on" : "off"}`} />
                <span className="chev">›</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Col 3 — Live Feed (which worker executed what) */}
      <section className="col">
        <div className="col-head">
          <h3>
            Live Feed <span className="live-dot on" />
          </h3>
          <button className="icon-btn" onClick={() => onOpenPanel("activity")} title="Full activity">
            ⤢
          </button>
        </div>
        <div className="col-body feed-body">
          {pendingFeed.length > 0 && (
            <>
              <div className="feed-section-label pinned">
                📌 Needs your approval · {pendingFeed.length}
              </div>
              {pendingFeed.map(renderExecRow)}
              <div className="feed-divider">All activity</div>
            </>
          )}

          {activityFeed.length > 0 ? (
            activityFeed.map(renderExecRow)
          ) : pendingFeed.length === 0 ? (
            <div className="feed-empty">No activity yet — text the bot or send a message.</div>
          ) : null}
        </div>
      </section>

      <section className="col chat-col">
        <div className="col-head chat-head">
          <h3>Talk to Alera</h3>
        </div>
        <div className="chat-body">
          {messages.map((msg, i) => (
            <div key={i} className={`bubble ${msg.role}`}>
              {msg.role === "ai" ? (
                <>
                  <div
                    className="md"
                    dangerouslySetInnerHTML={{ __html: marked.parse(msg.text, { breaks: true }) as string }}
                  />
                  <div className="bubble-actions">
                    <button
                      className="msg-btn"
                      title={audioIdx === i && audioState === "playing" ? "Pause" : "Play"}
                      onClick={() => void toggleAudio(i, msg.text)}
                    >
                      {audioIdx === i && audioState === "loading"
                        ? "⏳"
                        : audioIdx === i && audioState === "playing"
                          ? "⏸"
                          : "▶"}
                    </button>
                    <button className="msg-btn" title="Copy message" onClick={() => void copyMsg(i, msg.text)}>
                      {copiedIdx === i ? "✓" : "⧉"}
                    </button>
                  </div>
                </>
              ) : (
                <div>{msg.text}</div>
              )}
              {msg.meta?.missionLine && (
                <div className="bubble-meta">rule: {msg.meta.missionLine}</div>
              )}
            </div>
          ))}
          {thinking && (
            <div className="bubble ai thinking">
              <span className="think-dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
              <span className="think-text">Alera is thinking…</span>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>
        <form className="chat-form" onSubmit={runAsk}>
          <button type="button" className="attach" title="Attach">
            ＋
          </button>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={thinking ? "Alera is thinking…" : "Ask me anything…"}
            disabled={thinking}
          />
          <button type="submit" className="send" disabled={!query.trim() || thinking}>
            ↑
          </button>
        </form>
      </section>

      {editingCompany && (
        <div className="modal-overlay" onClick={() => !savingBiz && setEditingCompany(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Edit business">
            <div className="modal-head">
              <h2>Edit business</h2>
              <button className="icon-btn" onClick={() => !savingBiz && setEditingCompany(false)} aria-label="Close">
                ✕
              </button>
            </div>
            <div className="modal-body">
              <label className="field">
                <span>Business name</span>
                <input
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  placeholder="Business name"
                />
              </label>
              <label className="field">
                <span>About your business</span>
                <textarea
                  value={draftAbout}
                  onChange={(e) => setDraftAbout(e.target.value)}
                  placeholder="Describe your business — what you sell, who for, tone…"
                  rows={7}
                />
              </label>
              <p className="field-hint">Saved to Hermes so the assistant remembers it in future sessions.</p>
            </div>
            <div className="modal-actions">
              <button className="btn-ghost" onClick={() => setEditingCompany(false)} disabled={savingBiz}>
                Cancel
              </button>
              <button className="btn-primary" onClick={saveCompany} disabled={savingBiz || !draftName.trim()}>
                {savingBiz ? "Saving to Hermes…" : "Save & remember"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
