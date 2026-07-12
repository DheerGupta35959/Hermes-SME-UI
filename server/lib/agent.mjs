// The traced agent primitive.
//
// runAgent() is the single call every specialist, the manager, and the rule
// keeper go through. It calls the model (same OpenAI credential the Hermes
// runtime uses, loaded from ~/.hermes/.env), measures latency, reads token
// usage, computes cost, and appends a fully-attributed step to the run's trace.
//
// Because every agent hop is one runAgent() call, the trace tree (who called
// whom) and the per-step token/cost accounting come for free.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { addStep } from "./trace.mjs";

// ── credential (shared with Hermes) ────────────────────────────────────────────
function loadKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  const envPath = join(homedir(), ".hermes", ".env");
  if (existsSync(envPath)) {
    const m = readFileSync(envPath, "utf8").match(/^OPENAI_API_KEY=(.+)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  return null;
}
const API_KEY = loadKey();
export const MODEL = process.env.ALERA_MODEL || "gpt-5.4";
export const hasModel = Boolean(API_KEY);

// ── pricing (USD per 1M tokens) — override with ALERA_PRICE_IN / _OUT ──────────
const PRICING = {
  "gpt-5.4": { in: 1.25, out: 10 },
  "gpt-5.4-mini": { in: 0.25, out: 2 },
  "gpt-4.1-mini": { in: 0.4, out: 1.6 },
  "gpt-4o-mini": { in: 0.15, out: 0.6 },
};
function priceFor(model) {
  const envIn = process.env.ALERA_PRICE_IN, envOut = process.env.ALERA_PRICE_OUT;
  if (envIn && envOut) return { in: Number(envIn), out: Number(envOut) };
  return PRICING[model] ?? PRICING["gpt-5.4"];
}
function costOf(model, promptTokens, completionTokens) {
  const p = priceFor(model);
  return (promptTokens / 1e6) * p.in + (completionTokens / 1e6) * p.out;
}

async function callModel({ system, user, json, history = [] }) {
  const body = { model: MODEL, messages: [] };
  if (system) body.messages.push({ role: "system", content: system });
  for (const m of history) {
    const content = m.content ?? m.text;
    if (content) body.messages.push({ role: m.role === "ai" || m.role === "assistant" ? "assistant" : "user", content });
  }
  body.messages.push({ role: "user", content: user });
  if (json) body.response_format = { type: "json_object" };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`model ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return {
    text: data.choices?.[0]?.message?.content ?? "",
    promptTokens: data.usage?.prompt_tokens ?? 0,
    completionTokens: data.usage?.completion_tokens ?? 0,
  };
}

// Multi-turn completion for the owner chat (no trace). Carries prior turns so
// follow-ups like "do it" / "break it down" resolve against the conversation.
export async function chat({ system, user, history = [] }) {
  if (!API_KEY) return "I can't reach the model right now (no OPENAI_API_KEY).";
  try {
    const { text } = await callModel({ system, user, history });
    return text;
  } catch (err) {
    return `Sorry — I hit an error: ${String(err.message || err)}`;
  }
}

// Run one agent hop and record it in the trace. Returns { text, json?, step }.
export async function runAgent(run, { agent, parent, system, user, json = false, note }) {
  const t0 = Date.now();
  if (!API_KEY) {
    const step = addStep(run, { agent, parent, model: null, input: user, output: "", ms: Date.now() - t0, error: "no OPENAI_API_KEY", note });
    return { text: "", json: null, step };
  }
  try {
    const { text, promptTokens, completionTokens } = await callModel({ system, user, json });
    const step = addStep(run, {
      agent, parent, model: MODEL, input: user, output: text,
      promptTokens, completionTokens, costUsd: costOf(MODEL, promptTokens, completionTokens),
      ms: Date.now() - t0, note,
    });
    let parsed = null;
    if (json) { try { parsed = JSON.parse(text); } catch { /* leave null */ } }
    return { text, json: parsed, step };
  } catch (err) {
    const step = addStep(run, { agent, parent, model: MODEL, input: user, output: "", ms: Date.now() - t0, error: String(err.message || err), note });
    return { text: "", json: null, step, error: step.error };
  }
}
