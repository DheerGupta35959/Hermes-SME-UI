// The brain layer — the simple layer Hermes uses, and the UI skins.
// Five verbs over the brain/ folder. Today they run over the local mock + Markdown;
// the same five verbs become an MCP server so any agent calls them (v2).
//
//   mission()        → the constitution (the filter)
//   next()           → ranked queue of what to work on (reactive + proactive)
//   judge(item)      → verdict + the exact mission line it passed/failed
//   record(item, v)  → append a decision (memory)
//   ask(question)    → grounded answer with evidence + confidence
//
// The UI never touches raw data — it only calls these. Swap the bodies for
// file/Hermes-backed implementations without changing the screen.

import {
  mission as missionData,
  principles,
  cards,
  decisions,
  loopPipeline,
  layers,
  driftAlerts,
  type Card,
  type Evidence,
  type Stage,
} from "../brain";

export interface Mission {
  text: string;
  principles: { id: string; text: string }[];
}

export type VerdictStatus = "approved" | "rejected" | "pending";

export interface Verdict {
  status: VerdictStatus;
  missionLine?: string;
  reasoning?: string;
}

export interface StreamItem {
  id: string;
  title: string;
  stage: Stage;
  origin: "reactive" | "proactive";
  sources: Card["sources"];
  verdict: Verdict;
  outcome?: string; // PR link / "declined" / progress note
  evidence?: Evidence;
  specialist?: string; // the real worker the manager routed to (live runs)
  totals?: { tokens: number; costUsd: number; ms: number };
  customer?: string | null; // who sent it (phone/email)
  channel?: string | null;
  at?: string; // ISO timestamp of the run
}

export interface Answer {
  text: string;
  missionLine?: string;
  sources: { source: string; text: string }[];
  confidence: "high" | "medium" | "low";
}

// --- mission() ---
export function mission(): Mission {
  return { text: missionData.text, principles };
}

// --- next() --- ranked feed: needs-you first, then in-flight, done, declined, inbox.
const STAGE_RANK: Record<Stage, number> = {
  awaiting: 0,
  drafting: 1,
  checking: 2,
  done: 3,
  declined: 4,
  inbox: 5,
};

function toVerdict(card: Card): Verdict {
  if (!card.evidence) {
    return { status: "pending" };
  }
  const status: VerdictStatus =
    card.evidence.missionStatus === "fail" ? "rejected" : "approved";
  return {
    status: card.stage === "checking" ? "pending" : status,
    missionLine: card.evidence.missionLine,
    reasoning: card.evidence.reasoning,
  };
}

function toOutcome(card: Card): string | undefined {
  if (card.stage === "done") return card.evidence?.pr ?? card.pr;
  if (card.stage === "declined") return "didn't do it";
  if (card.stage === "drafting" || card.stage === "awaiting") return card.note ?? "in progress";
  return undefined;
}

export function next(): StreamItem[] {
  return cards
    .map((c) => ({
      id: c.id,
      title: c.title,
      stage: c.stage,
      origin: c.origin ?? "reactive",
      sources: c.sources,
      verdict: toVerdict(c),
      outcome: toOutcome(c),
      evidence: c.evidence,
    }))
    .sort((a, b) => STAGE_RANK[a.stage] - STAGE_RANK[b.stage]);
}

// --- judge(item) --- returns the verdict for an item (display + agent use).
export function judge(itemId: string): Verdict | null {
  const c = cards.find((x) => x.id === itemId);
  return c ? toVerdict(c) : null;
}

// --- record(item, verdict) --- append a decision. In the mock this is in-memory;
// the file-backed impl appends to brain/decisions.md + Hermes memory.
const recorded: { id: string; verdict: Verdict; at: number }[] = [];
export function record(itemId: string, verdict: Verdict): void {
  recorded.push({ id: itemId, verdict, at: Date.now() });
}
export function getRecorded() {
  return recorded;
}

// --- ask(question) --- grounded answer over the decision log. Naive keyword match
// now; retrieval-backed later. Always returns sources, never invents.
export function ask(question: string): Answer {
  const q = question.toLowerCase();
  const hit = decisions.find((d) => {
    const hay = (d.title + " " + d.evidence.reasoning + " " + d.evidence.missionLine).toLowerCase();
    return q
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .some((w) => hay.includes(w));
  });

  if (!hit) {
    return {
      text: "Nothing in your history matches that yet. Try asking about the discount request, the review reply, bookings, or the invoice reminder.",
      sources: [],
      confidence: "low",
    };
  }

  const verb = hit.status === "shipped" ? "handled" : "declined";
  return {
    text: `I ${verb} "${hit.title}". ${hit.evidence.reasoning}`,
    missionLine: hit.evidence.missionLine,
    sources: hit.evidence.signals,
    confidence: hit.evidence.signals.length >= 3 ? "high" : "medium",
  };
}

// --- status (thin footer): the loop + the three layers ---
export function status() {
  const brainFileCount = Object.keys(
    import.meta.glob("/brain/**/*.md", { eager: true })
  ).length;
  return {
    loop: loopPipeline,
    layers: layers.map((l) => (l.id === "L1" ? { ...l, stat: `${brainFileCount} files` } : l)),
    drift: driftAlerts,
  };
}
