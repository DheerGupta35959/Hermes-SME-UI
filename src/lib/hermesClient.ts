// hermesClient — the ONE bridge between the Alera UI and Hermes.
//
// Every surface (terminal, chat, brain files, workers, approvals) talks to
// Hermes through this module. It is two-way:
//   READ  ← getState() / getDoc() / subscribe()   (poll Hermes' brain projection)
//   WRITE → command() / ask() / approve() / override() / saveDoc() / runWorker()
//
// Transport is pluggable:
//   • No VITE_HERMES_URL set  → MOCK transport (local brain/ + in-memory), current demo.
//   • VITE_HERMES_URL set     → HTTP transport, talks to your Hostinger Hermes bridge.
//
// The HTTP endpoint contract your Hermes must expose is documented in
// alera/docs/hermes-bridge-api.md.

import * as Brain from "./brainLayer";
import type { Answer, StreamItem, Verdict } from "./brainLayer";
import { loadBrainDocs, type BrainDoc } from "./brainDocs";
import { activity as mockActivity, skills as mockSkills } from "../brain";

const BASE = (import.meta.env.VITE_HERMES_URL as string | undefined)?.replace(/\/$/, "");
const TOKEN = import.meta.env.VITE_HERMES_TOKEN as string | undefined;

export const isLive = Boolean(BASE);

export interface TerminalLine {
  skill: string;
  text: string;
  now?: boolean;
}

export interface WorkerState {
  name: string;
  purpose: string;
  runs: number;
  lastRun: string;
  enabled: boolean;
}

export interface AleraState {
  activity: TerminalLine[];
  stream: StreamItem[];
  workers: WorkerState[];
}

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`Hermes ${path} → ${res.status}`);
  return (await res.json()) as T;
}

// ── READ ─────────────────────────────────────────────────────────────────────

export async function getState(): Promise<AleraState> {
  if (isLive) return http<AleraState>("/api/state");
  return {
    activity: mockActivity,
    stream: Brain.next(),
    workers: mockSkills.map((s) => ({
      name: s.name,
      purpose: s.purpose,
      runs: s.runs,
      lastRun: s.lastRun,
      enabled: true,
    })),
  };
}

export async function listDocs(): Promise<BrainDoc[]> {
  if (isLive) return http<BrainDoc[]>("/api/brain/docs");
  return loadBrainDocs();
}

export async function getDoc(rel: string): Promise<string> {
  if (isLive) return http<{ body: string }>(`/api/brain/doc?rel=${encodeURIComponent(rel)}`).then((r) => r.body);
  return loadBrainDocs().find((d) => d.rel === rel)?.body ?? "";
}

// Poll Hermes for state changes. Returns an unsubscribe fn.
export function subscribe(onState: (s: AleraState) => void, intervalMs = 4000): () => void {
  let stopped = false;
  async function tick() {
    if (stopped) return;
    try {
      onState(await getState());
    } catch {
      /* keep polling; Hermes may be mid-write */
    }
    if (!stopped) timer = window.setTimeout(tick, intervalMs);
  }
  let timer = window.setTimeout(tick, intervalMs);
  return () => {
    stopped = true;
    window.clearTimeout(timer);
  };
}

// ── WRITE ────────────────────────────────────────────────────────────────────

// Free-text terminal command → Hermes runs it, returns the log lines it produced.
export async function command(text: string): Promise<TerminalLine[]> {
  if (isLive) return http<TerminalLine[]>("/api/command", { method: "POST", body: JSON.stringify({ text }) });
  return [{ skill: "cmd", text }];
}

// Chat → grounded answer from Hermes (falls back to local retrieval in mock).
// `history` carries prior turns so follow-ups resolve in context.
export async function ask(question: string, history: { role: "user" | "ai"; text: string }[] = []): Promise<Answer> {
  if (isLive) return http<Answer>("/api/ask", { method: "POST", body: JSON.stringify({ question, history }) });
  return Brain.ask(question);
}

// Approve a pending item → Hermes acts (sends the reply, files the invoice, etc.).
export async function approve(itemId: string): Promise<void> {
  if (isLive) {
    await http("/api/approve", { method: "POST", body: JSON.stringify({ itemId }) });
    return;
  }
  Brain.record(itemId, { status: "approved" });
}

// Override a verdict (flip approve/reject) → Hermes records the human decision.
export async function override(itemId: string, verdict: Verdict): Promise<void> {
  if (isLive) {
    await http("/api/override", { method: "POST", body: JSON.stringify({ itemId, verdict }) });
    return;
  }
  Brain.record(itemId, verdict);
}

// Edit a brain file → Hermes writes it back to brain/ and re-reads on next loop.
export async function saveDoc(rel: string, body: string): Promise<void> {
  if (isLive) {
    await http("/api/brain/doc", { method: "PUT", body: JSON.stringify({ rel, body }) });
    return;
  }
  // mock: no persistence beyond the session
}

// Turn a worker on/off, or trigger a run now.
export async function setWorkerEnabled(name: string, enabled: boolean): Promise<void> {
  if (isLive) await http("/api/worker", { method: "POST", body: JSON.stringify({ name, enabled }) });
}

export async function runWorker(name: string): Promise<TerminalLine[]> {
  if (isLive) return http<TerminalLine[]>("/api/worker/run", { method: "POST", body: JSON.stringify({ name }) });
  return [{ skill: name, text: `ran ${name} once` }];
}

// Define a brand-new worker role (job + tools + guardrail) — the manager picks it up.
export interface WorkerDef {
  name: string;
  job: string;
  tools: string[];
  autonomy: "auto" | "careful";
  guardrail: string;
}
export async function defineWorker(def: WorkerDef): Promise<{ ok: boolean; slug: string }> {
  if (isLive) return http<{ ok: boolean; slug: string }>("/api/worker/define", { method: "POST", body: JSON.stringify(def) });
  return { ok: true, slug: def.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") };
}

// ── Observability: traces of real agent runs ─────────────────────────────────

export interface TraceStep {
  id: string;
  parent: string | null;
  agent: string;
  model: string | null;
  input: string;
  output: string;
  promptTokens: number;
  completionTokens: number;
  tokens: number;
  costUsd: number;
  ms: number;
  ts: string;
  note: string | null;
  error: string | null;
}

export interface TraceRun {
  id: string;
  task: string;
  channel: string;
  customer: string | null;
  version: string;
  status: string;
  createdAt: string;
  finishedAt?: string;
  verdict: { status: string; rule?: string; reasoning?: string } | null;
  outcome: string | null;
  steps: TraceStep[];
  totals: { tokens: number; costUsd: number; ms: number };
  costSpike?: boolean;
}

export interface TraceSummary {
  id: string;
  task: string;
  channel: string;
  customer: string | null;
  version: string;
  status: string;
  createdAt: string;
  steps: number;
  tokens: number;
  costUsd: number;
  ms: number;
  costSpike: boolean;
  rule: string | null;
}

export async function listTraces(q?: string): Promise<TraceSummary[]> {
  if (!isLive) return [];
  return http<TraceSummary[]>(`/api/traces${q ? `?q=${encodeURIComponent(q)}` : ""}`);
}

export async function getTrace(id: string): Promise<TraceRun | null> {
  if (!isLive) return null;
  return http<TraceRun>(`/api/trace?id=${encodeURIComponent(id)}`);
}

export interface ChannelStatus {
  telegram: boolean;
  gmail: boolean;
  elevenlabs: boolean;
  linkup: boolean;
  shopify: boolean;
  convex: boolean;
  model: boolean;
}

export async function channels(): Promise<ChannelStatus> {
  if (!isLive) return { telegram: false, gmail: false, elevenlabs: false, linkup: false, shopify: false, convex: false, model: false };
  return http<ChannelStatus>("/api/channels");
}

// Feed a new customer message to the crew → returns the projected stream item.
export async function sendInbound(text: string, customer: string, channel = "telegram"): Promise<{ runId: string }> {
  if (!isLive) return { runId: "" };
  return http<{ runId: string }>("/api/inbound", { method: "POST", body: JSON.stringify({ text, customer, channel }) });
}

// ElevenLabs: fetch the spoken reply as audio and return a playable object URL
// (the caller controls play/pause). Throws if the voice service isn't available.
export async function ttsUrl(text: string): Promise<string> {
  if (!isLive) throw new Error("voice unavailable");
  const res = await fetch(`${BASE}/api/voice`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`voice ${res.status}`);
  return URL.createObjectURL(await res.blob());
}

export interface BusinessProfile {
  name: string;
  about: string;
}

export interface SetupResult {
  ok: boolean;
  workers: string[];
  docs: string[];
}

// Read the saved business profile (null until the owner sets it up).
export async function getBusiness(): Promise<BusinessProfile | null> {
  if (!isLive) return null;
  try {
    const r = await http<{ business: BusinessProfile | null }>("/api/business");
    return r.business;
  } catch {
    return null;
  }
}

// Save the business profile → Hermes stores it in memory, adopts the Alera
// persona, and "sets up" the workers. Returns the setup result.
export async function saveBusiness(name: string, about: string): Promise<SetupResult> {
  if (isLive) {
    return http<SetupResult>("/api/business", { method: "POST", body: JSON.stringify({ name, about }) });
  }
  return {
    ok: true,
    workers: ["inbox responder", "orders & fulfillment", "reminders", "follow-ups", "reviews & reputation", "product insights"],
    docs: ["Return & refund policy", "Shipping & delivery", "FAQ / sizing guide"],
  };
}
