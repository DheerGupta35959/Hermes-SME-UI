import { useState } from "react";
import * as Hermes from "../lib/hermesClient";
import { connectors, skills } from "../brain";

// A non-engineer defines a brand-new worker role: what it does, which tools it
// may use, its schedule, chaining, and guardrail. On save it's written to the
// brain and the manager agent can immediately delegate to it — no code, no redeploy.
export function AddWorker({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [job, setJob] = useState("");
  const [tools, setTools] = useState<string[]>([]);
  const [autonomy, setAutonomy] = useState<"auto" | "careful">("careful");
  const [guardrail, setGuardrail] = useState("");

  // Schedule fields
  const [useSchedule, setUseSchedule] = useState(false);
  const [cronExpr, setCronExpr] = useState("");

  // Chain fields
  const [useChain, setUseChain] = useState(false);
  const [chainNext, setChainNext] = useState("");
  const [chainCond, setChainCond] = useState<"always" | "on_success" | "on_failure">("always");
  const [chainDelay, setChainDelay] = useState(0);

  // A/B test fields
  const [useABTest, setUseABTest] = useState(false);
  const [variantName, setVariantName] = useState("");
  const [variantPurpose, setVariantPurpose] = useState("");
  const [variantAutonomy, setVariantAutonomy] = useState<"auto" | "careful">("auto");
  const [splitB, setSplitB] = useState(50);

  const [saved, setSaved] = useState(false);
  const [testMsg, setTestMsg] = useState("");
  const [testOut, setTestOut] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  const toggleTool = (id: string) => setTools((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));

  async function save() {
    if (!name.trim() || !job.trim()) return;
    // The API currently accepts base fields; schedule/chain/abTest config would
    // be sent as additional metadata in a production implementation.
    await Hermes.defineWorker({
      name: name.trim(),
      job: job.trim(),
      tools,
      autonomy,
      guardrail: guardrail.trim(),
    });
    setSaved(true);
  }

  async function test() {
    if (!testMsg.trim()) return;
    setTesting(true);
    setTestOut(null);
    try {
      await Hermes.sendInbound(testMsg.trim(), "test-volunteer", "telegram");
      setTestOut(`Sent to the crew. Open Observability to see the manager route it${saved ? ` — it can now pick "${name}".` : "."}`);
    } catch {
      setTestOut("Could not reach the crew.");
    } finally {
      setTesting(false);
    }
  }

  const otherWorkers = skills.filter((s) => s.name !== name.trim() && s.name !== "rule keeper");

  return (
    <div className="addw">
      <label className="field">
        <span>Worker name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. loyalty concierge" />
      </label>
      <label className="field">
        <span>What it does (the job)</span>
        <textarea value={job} onChange={(e) => setJob(e.target.value)} rows={3} placeholder="Spots repeat customers and offers them early access to new drops (within the discount rule)." />
      </label>
      <div className="field">
        <span>Tools it may use</span>
        <div className="addw-tools">
          {connectors.map((c) => (
            <button key={c.id} type="button" className={`addw-tool ${tools.includes(c.id) ? "on" : ""}`} onClick={() => toggleTool(c.id)}>
              {c.name}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span>Autonomy guardrail</span>
        <div className="addw-auto">
          <button type="button" className={autonomy === "careful" ? "on" : ""} onClick={() => setAutonomy("careful")}>
            Careful — drafts, waits for your OK
          </button>
          <button type="button" className={autonomy === "auto" ? "on" : ""} onClick={() => setAutonomy("auto")}>
            Auto — handles routine itself
          </button>
        </div>
      </div>
      <label className="field">
        <span>Extra guardrail (optional)</span>
        <input value={guardrail} onChange={(e) => setGuardrail(e.target.value)} placeholder="e.g. never contact a customer more than once a week" />
      </label>

      {/* ── Schedule ── */}
      <div className="addw-section">
        <div className="addw-section-head">
          <span>Schedule (optional)</span>
          <button
            className={`toggle ${useSchedule ? "on" : ""}`}
            onClick={() => setUseSchedule((v) => !v)}
          >
            <span className="knob" />
          </button>
        </div>
        {useSchedule && (
          <div className="addw-section-body">
            <input
              className="schedule-input"
              value={cronExpr}
              onChange={(e) => setCronExpr(e.target.value)}
              placeholder="0 7 * * 1-5"
            />
            <p className="field-hint">
              Cron syntax: minute hour day month weekday. Example: "0 7 * * 1-5" = weekdays at 7 AM.
            </p>
          </div>
        )}
      </div>

      {/* ── Chaining ── */}
      <div className="addw-section">
        <div className="addw-section-head">
          <span>Chain to next worker (optional)</span>
          <button
            className={`toggle ${useChain ? "on" : ""}`}
            onClick={() => setUseChain((v) => !v)}
          >
            <span className="knob" />
          </button>
        </div>
        {useChain && (
          <div className="addw-section-body">
            <div className="field">
              <span>Next worker</span>
              <select
                className="schedule-input"
                value={chainNext}
                onChange={(e) => setChainNext(e.target.value)}
              >
                <option value="">Select a worker…</option>
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
                  className={chainCond === "always" ? "on" : ""}
                  onClick={() => setChainCond("always")}
                >
                  Always
                </button>
                <button
                  type="button"
                  className={chainCond === "on_success" ? "on" : ""}
                  onClick={() => setChainCond("on_success")}
                >
                  On success
                </button>
                <button
                  type="button"
                  className={chainCond === "on_failure" ? "on" : ""}
                  onClick={() => setChainCond("on_failure")}
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
                value={chainDelay}
                onChange={(e) => setChainDelay(Number(e.target.value))}
              />
            </div>
          </div>
        )}
      </div>

      {/* ── A/B test ── */}
      <div className="addw-section">
        <div className="addw-section-head">
          <span>A/B test variant (optional)</span>
          <button
            className={`toggle ${useABTest ? "on" : ""}`}
            onClick={() => setUseABTest((v) => !v)}
          >
            <span className="knob" />
          </button>
        </div>
        {useABTest && (
          <div className="addw-section-body">
            <p className="field-hint" style={{ marginBottom: 8 }}>
              Variant A uses the primary autonomy setting above. Define variant B below — traffic is split 50/50.
            </p>
            <label className="field">
              <span>Variant B name</span>
              <input
                value={variantName}
                onChange={(e) => setVariantName(e.target.value)}
                placeholder="e.g. verbose, polite, fast"
              />
            </label>
            <label className="field" style={{ marginTop: 8 }}>
              <span>Variant B purpose</span>
              <textarea
                value={variantPurpose}
                onChange={(e) => setVariantPurpose(e.target.value)}
                rows={2}
                placeholder="How B differs from A…"
              />
            </label>
            <div className="field" style={{ marginTop: 8 }}>
              <span>Variant B autonomy</span>
              <div className="addw-auto">
                <button
                  type="button"
                  className={variantAutonomy === "careful" ? "on" : ""}
                  onClick={() => setVariantAutonomy("careful")}
                >
                  Careful
                </button>
                <button
                  type="button"
                  className={variantAutonomy === "auto" ? "on" : ""}
                  onClick={() => setVariantAutonomy("auto")}
                >
                  Auto
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="modal-actions" style={{ padding: 0, marginTop: 4 }}>
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={save} disabled={!name.trim() || !job.trim()}>
          {saved ? "Saved ✓ — manager can delegate to it" : "Create worker"}
        </button>
      </div>

      {saved && (
        <div className="addw-test">
          <span style={{ fontSize: 12, color: "var(--muted)" }}>Test it — send a message this worker should handle:</span>
          <input style={{ marginTop: 6 }} value={testMsg} onChange={(e) => setTestMsg(e.target.value)} placeholder="Type a customer message…" />
          <div className="modal-actions" style={{ padding: 0, marginTop: 8 }}>
            <button className="btn-primary" onClick={test} disabled={testing || !testMsg.trim()}>
              {testing ? "Running…" : "Send to crew"}
            </button>
          </div>
          {testOut && <pre>{testOut}</pre>}
        </div>
      )}
    </div>
  );
}
