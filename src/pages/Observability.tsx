import { useEffect, useMemo, useState } from "react";
import * as Hermes from "../lib/hermesClient";
import type { TraceRun, TraceSummary, TraceStep } from "../lib/hermesClient";

const AGENT_COLOR: Record<string, string> = {
  manager: "#6366f1",
  "rule keeper": "#ef4444",
  "inbox responder": "#22c55e",
  "returns & refunds": "#ec4899",
  "quotes & estimates": "#06b6d4",
  "payments & invoicing": "#eab308",
  "reviews & reputation": "#f97316",
  researcher: "#0ea5e9",
  shopify: "#95bf47",
  catalog: "#95bf47",
};
const color = (a: string) => AGENT_COLOR[a] ?? "#64748b";
const money = (n: number) => `$${n.toFixed(4)}`;
const statusColor: Record<string, string> = { done: "#22c55e", awaiting: "#eab308", declined: "#ef4444", error: "#f43f5e", running: "#64748b" };

function StepRow({ step, depth }: { step: TraceStep; depth: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="obs-step" style={{ marginLeft: depth * 18 }}>
      <button className="obs-step-head" onClick={() => setOpen((v) => !v)}>
        <span className="obs-chip" style={{ background: color(step.agent) }}>{step.agent}</span>
        {step.note && <span className="obs-note">{step.note}</span>}
        {step.error ? (
          <span className="obs-err">error</span>
        ) : (
          <span className="obs-metrics mono">
            {step.tokens}t · {money(step.costUsd)} · {step.ms}ms
          </span>
        )}
        <span className="obs-model mono">{step.model ?? ""}</span>
      </button>
      {open && (
        <div className="obs-step-body">
          {step.error && <pre className="obs-pre err">{step.error}</pre>}
          <div className="obs-io">
            <div className="obs-io-k">input</div>
            <pre className="obs-pre">{step.input}</pre>
          </div>
          <div className="obs-io">
            <div className="obs-io-k">output</div>
            <pre className="obs-pre">{step.output}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

// Order steps as a tree: root steps first, each followed by its children.
function treeOrder(steps: TraceStep[]): { step: TraceStep; depth: number }[] {
  const byParent = new Map<string | null, TraceStep[]>();
  for (const s of steps) {
    const k = s.parent ?? null;
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k)!.push(s);
  }
  const out: { step: TraceStep; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const s of byParent.get(parent) ?? []) {
      out.push({ step: s, depth });
      walk(s.id, depth + 1);
    }
  };
  walk(null, 0);
  // any orphans (parent not in set) render flat
  const seen = new Set(out.map((o) => o.step.id));
  for (const s of steps) if (!seen.has(s.id)) out.push({ step: s, depth: 0 });
  return out;
}

function RunDetail({ run }: { run: TraceRun }) {
  const ordered = useMemo(() => treeOrder(run.steps), [run]);
  return (
    <div className="obs-run">
      <div className="obs-run-head">
        <div>
          <div className="obs-run-task">{run.task}</div>
          <div className="obs-run-sub mono">
            {run.customer ?? "—"} · {run.channel} · {run.version}
          </div>
        </div>
        <div className="obs-run-totals mono">
          <span style={{ color: statusColor[run.status] }}>{run.status}</span>
          <span>{run.totals.tokens}t</span>
          <span>{money(run.totals.costUsd)}</span>
          <span>{run.totals.ms}ms</span>
        </div>
      </div>
      {run.verdict?.rule && (
        <div className="obs-verdict">
          <b>rule keeper:</b> {run.verdict.rule} — {run.verdict.reasoning}
        </div>
      )}
      <div className="obs-steps">
        {ordered.map(({ step, depth }) => (
          <StepRow key={step.id} step={step} depth={depth} />
        ))}
      </div>
    </div>
  );
}

function DiffView({ a, b }: { a: TraceRun; b: TraceRun }) {
  const rows = [
    ["task", a.task, b.task],
    ["status", a.status, b.status],
    ["steps", String(a.steps.length), String(b.steps.length)],
    ["tokens", String(a.totals.tokens), String(b.totals.tokens)],
    ["cost", money(a.totals.costUsd), money(b.totals.costUsd)],
    ["latency", `${a.totals.ms}ms`, `${b.totals.ms}ms`],
    ["rule", a.verdict?.rule ?? "—", b.verdict?.rule ?? "—"],
  ];
  return (
    <div className="obs-diff">
      <div className="obs-diff-head">
        <span>Run A · {a.version}</span>
        <span>Run B · {b.version}</span>
      </div>
      {rows.map(([k, va, vb]) => (
        <div key={k} className={`obs-diff-row ${va !== vb ? "changed" : ""}`}>
          <div className="obs-diff-k">{k}</div>
          <div className="obs-diff-v">{va}</div>
          <div className="obs-diff-v">{vb}</div>
        </div>
      ))}
    </div>
  );
}

export function Observability() {
  const [runs, setRuns] = useState<TraceSummary[]>([]);
  const [q, setQ] = useState("");
  const [selId, setSelId] = useState<string | null>(null);
  const [sel, setSel] = useState<TraceRun | null>(null);
  const [compare, setCompare] = useState(false);
  const [pair, setPair] = useState<[TraceRun | null, TraceRun | null]>([null, null]);
  const [ch, setCh] = useState<Hermes.ChannelStatus | null>(null);

  useEffect(() => {
    Hermes.channels().then(setCh);
  }, []);

  useEffect(() => {
    let alive = true;
    const load = () => Hermes.listTraces(q).then((r) => alive && setRuns(r));
    load();
    const t = window.setInterval(load, 5000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [q]);

  async function pick(id: string) {
    const run = await Hermes.getTrace(id);
    if (!run) return;
    if (compare) {
      setPair(([a]) => (a ? [a, run] : [run, null]));
    } else {
      setSelId(id);
      setSel(run);
    }
  }

  const spikes = runs.filter((r) => r.costSpike).length;

  return (
    <div className="obs">
      <div className="obs-bar">
        <input
          className="obs-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search across runs — customer, agent, rule, message…"
        />
        <button className={`obs-toggle ${compare ? "on" : ""}`} onClick={() => { setCompare((v) => !v); setPair([null, null]); }}>
          {compare ? "Comparing (pick 2)" : "Diff runs"}
        </button>
      </div>

      {ch && (
        <div className="obs-chstatus mono">
          model {ch.model ? "✓" : "✗"} · telegram {ch.telegram ? "LIVE" : "staged"} · gmail {ch.gmail ? "LIVE" : "staged"} · shopify {ch.shopify ? "LIVE" : "staged"} · voice {ch.elevenlabs ? "LIVE" : "staged"} · linkup {ch.linkup ? "LIVE" : "staged"} · store {ch.convex ? "Convex" : "SQLite"}
        </div>
      )}
      {spikes > 0 && <div className="obs-alert">⚠ {spikes} run{spikes > 1 ? "s" : ""} flagged: cost &gt; 3× median. Investigate before it drains budget.</div>}

      <div className="obs-main">
        <div className="obs-list">
          {runs.length === 0 && <div className="obs-empty">No runs yet. Text the Telegram bot or send a message to the crew.</div>}
          {runs.map((r) => (
            <button
              key={r.id}
              className={`obs-row ${selId === r.id ? "on" : ""} ${pair[0]?.id === r.id || pair[1]?.id === r.id ? "picked" : ""}`}
              onClick={() => pick(r.id)}
            >
              <span className="obs-dot" style={{ background: statusColor[r.status] ?? "#64748b" }} />
              <span className="obs-row-body">
                <span className="obs-row-task">{r.task}</span>
                <span className="obs-row-meta mono">
                  {r.customer ?? "—"} · {money(r.costUsd)} · {r.ms}ms · {r.tokens}t · {r.version}
                  {r.costSpike && <span className="obs-spike">spike</span>}
                </span>
              </span>
            </button>
          ))}
        </div>

        <div className="obs-detail">
          {compare ? (
            pair[0] && pair[1] ? (
              <DiffView a={pair[0]} b={pair[1]} />
            ) : (
              <div className="obs-empty">Pick two runs to diff{pair[0] ? " — one selected" : ""}.</div>
            )
          ) : sel ? (
            <RunDetail run={sel} />
          ) : (
            <div className="obs-empty">Select a run to see the trace tree, tokens, and cost per step.</div>
          )}
        </div>
      </div>
    </div>
  );
}
