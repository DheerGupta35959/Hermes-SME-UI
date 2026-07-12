// Alera — the business layer on top of cloud-hosted Hermes.
// Mock state for the cockpit. Mirrors what the real app reads from the managed
// Hermes instance's brain/ folder (state.json projection). Swap these exports
// for a fetch over that file without changing any page.

export type Source = "whatsapp" | "email" | "review" | "calendar" | "billing" | "feedback";
export type Origin = "reactive" | "proactive";
export type Stage = "inbox" | "checking" | "drafting" | "awaiting" | "done" | "declined";

export interface Evidence {
  signals: { source: Source; text: string }[];
  missionLine: string; // the business rule cited (R1–R5)
  missionStatus: "pass" | "fail";
  reasoning: string;
  spec?: string; // the drafted action, in plain words
  pr?: string; // the result ("sent", "posted", "booked")
}

export interface Card {
  id: string;
  title: string;
  stage: Stage;
  sources: Source[];
  origin?: Origin;
  note?: string;
  cite?: string;
  citeStatus?: "ok" | "no";
  pr?: string;
  progress?: number;
  progressColor?: string;
  evidence?: Evidence;
}

export const mission = {
  label: "YOUR RULES",
  text: "Northline — a Shopify store for shirts and pants (men, women, kids). Everyday fits, fair prices. The assistant handles the inbox, orders, reminders, and follow-ups, and always asks before anything that matters.",
  clauses: [
    { id: "R1", text: "reply within 2 hours" },
    { id: "R2", text: "friendly, personal tone" },
    { id: "R3", text: "never discount more than 10%" },
    { id: "R4", text: "always ask before sending money-related messages" },
    { id: "R5", text: "warehouse closed Sundays — no weekend rush shipping" },
  ],
};

// The business rules (R1–R5) — what the rules map orbits.
export const principles: { id: string; text: string }[] = mission.clauses;

export const agent = {
  running: true,
  cron: "always on",
  lastRun: "41s ago",
  brainSummary: "9 new messages · 4 handled · 2 waiting for you",
};

export const cards: Card[] = [
  // INBOX — just arrived
  { id: "s1", title: "WhatsApp: “do you have kids pants in size 6?”", stage: "inbox", sources: ["whatsapp"], origin: "reactive", note: "from +1 ··· 4821 · 12m ago" },
  { id: "s2", title: "New 2★ review — “wrong size, nobody replied”", stage: "inbox", sources: ["review"], origin: "reactive", note: "posted last night" },
  { id: "s3", title: "Email: wholesale quote for 80 shirts", stage: "inbox", sources: ["email"], origin: "reactive", note: "campus store · fall order" },

  // CHECKING — being judged against the rules
  {
    id: "j1",
    title: "3 customers asking for Sunday delivery",
    stage: "checking",
    sources: ["whatsapp", "email"],
    cite: "Checking against your rules…",
    progress: 60,
    evidence: {
      signals: [
        { source: "whatsapp", text: "“can you ship my order for Sunday?”" },
        { source: "whatsapp", text: "“are you packing orders this weekend?”" },
        { source: "email", text: "“need the kids shirts by Sunday morning”" },
      ],
      missionLine: "R5 warehouse closed Sundays",
      missionStatus: "pass",
      reasoning: "Three customers this week asked for Sunday delivery. Your rule R5 says warehouse is closed Sundays — drafting a kind reply that offers Friday ship / Monday delivery instead.",
    },
  },

  // DRAFTING
  {
    id: "b1",
    title: "Reply to the 2★ review",
    stage: "drafting",
    sources: ["review"],
    origin: "reactive",
    cite: "✓ Worth responding · R1, R2. Writing a personal reply…",
    citeStatus: "ok",
    progress: 45,
    evidence: {
      signals: [
        { source: "review", text: "2★ — “ordered a men's shirt, got the wrong size, nobody replied”" },
        { source: "whatsapp", text: "(matched) unanswered size-exchange message from the same customer" },
      ],
      missionLine: "R1 reply within 2 hours",
      missionStatus: "pass",
      reasoning: "The reviewer is the customer whose exchange request slipped through last Tuesday. Drafting an apology + free size swap (within your 10% limit, R3).",
      spec: "Draft: “Hi Jordan, you're right and we're sorry — your exchange request slipped past us…”",
    },
  },

  // AWAITING YOUR APPROVAL
  {
    id: "v1",
    title: "Invoice reminder → Campus Outfitters (21 days overdue)",
    stage: "awaiting",
    sources: ["billing", "email"],
    origin: "proactive",
    note: "waiting for your approval",
    progress: 88,
    progressColor: "var(--amber)",
    evidence: {
      signals: [
        { source: "billing", text: "Invoice #204 · $1,480 · due 21 days ago" },
        { source: "email", text: "no reply to the invoice email from Feb 18" },
      ],
      missionLine: "R4 ask before money-related messages",
      missionStatus: "pass",
      reasoning: "Polite first reminder drafted. Your rule R4 says money messages always need your OK — so it's waiting for you.",
      spec: "Draft: “Hi Sam, a gentle reminder about invoice #204 for the wholesale shirts…”",
    },
  },

  // DONE
  {
    id: "sh1",
    title: "6 order questions answered + Shopify updated",
    stage: "done",
    sources: ["whatsapp", "calendar"],
    origin: "reactive",
    pr: "✓ answered · tracking links sent",
    evidence: {
      signals: [
        { source: "whatsapp", text: "6 “where is my order?” / size questions this week" },
        { source: "calendar", text: "fulfillment schedule clear" },
      ],
      missionLine: "R1 reply within 2 hours",
      missionStatus: "pass",
      reasoning: "Routine order support — you approved auto-handling these last month. Sent tracking, confirmed sizes in stock, updated Shopify notes.",
      pr: "6 replies sent · avg reply time 9 minutes",
    },
  },
  {
    id: "sh2",
    title: "Follow-up sent: wholesale quote from last week",
    stage: "done",
    sources: ["email"],
    origin: "proactive",
    pr: "✓ sent · buyer replied “yes, let's place the order”",
    evidence: {
      signals: [
        { source: "email", text: "quote for 40 women's pants sent 6 days ago · no reply" },
      ],
      missionLine: "R2 friendly, personal tone",
      missionStatus: "pass",
      reasoning: "Quotes with no reply after 5 days get one friendly nudge — you approved this pattern. It worked: they ordered.",
      spec: "Draft: “Hi Priya, just checking you got our wholesale quote — happy to adjust sizes…”",
      pr: "Follow-up sent · PO confirmed 2h later",
    },
  },

  // DECLINED — things it deliberately did not do
  {
    id: "r1",
    title: "“Can we get 30% off for a bulk order?”",
    stage: "declined",
    sources: ["email"],
    origin: "reactive",
    cite: "✕ Against your rule R3 “never discount more than 10%”. Drafted a counter-offer instead — waiting for you.",
    citeStatus: "no",
    evidence: {
      signals: [
        { source: "email", text: "“we'd order 120 shirts monthly if you can do 30% off”" },
      ],
      missionLine: "R3 never discount more than 10%",
      missionStatus: "fail",
      reasoning: "30% breaks your pricing rule. Didn't agree, didn't ignore — drafted a 10% counter-offer with free shipping on monthly wholesale for your review.",
    },
  },
  {
    id: "r2",
    title: "Sunday rush-ship request",
    stage: "declined",
    sources: ["email"],
    cite: "✕ R5 “warehouse closed Sundays”. Offered Friday ship / Monday delivery instead.",
    citeStatus: "no",
    evidence: {
      signals: [
        { source: "email", text: "“please ship overnight so it arrives Sunday”" },
      ],
      missionLine: "R5 warehouse closed Sundays",
      missionStatus: "fail",
      reasoning: "Sunday fulfillment is off-limits by your rule. Politely offered Friday ship for Monday delivery — they accepted.",
    },
  },

  // PRODUCT INSIGHTS — synthesized from reviews + feedback forms
  {
    id: "pi1",
    title: "Fix sizing: navy chinos run small (7 people flagged it)",
    stage: "awaiting",
    sources: ["feedback", "review"],
    origin: "proactive",
    note: "human task — needs your OK to open",
    evidence: {
      signals: [
        { source: "review", text: "3★ — “ordered my usual 32, way too tight”" },
        { source: "review", text: "2★ — “navy chinos run a full size small”" },
        { source: "feedback", text: "post-purchase survey ×4 — “sizing smaller than expected”" },
      ],
      missionStatus: "pass",
      missionLine: "trend: 7 signals, 3 sources",
      reasoning: "Seven customers across reviews and surveys say the navy chinos run small — that's a real product problem, not a one-off. I've drafted a human task for the team to re-grade the size chart. Approve to open it.",
      spec: "Task: re-grade navy chino sizing + add 'runs small, size up' note to the PDP.",
    },
  },
  {
    id: "pi2",
    title: "6 customers asking for tall / long-inseam sizes",
    stage: "drafting",
    sources: ["feedback"],
    origin: "proactive",
    cite: "Enough demand to plan — drafting a proposal for the next drop.",
    evidence: {
      signals: [
        { source: "feedback", text: "suggestion form — “please make a 34\" inseam”" },
        { source: "feedback", text: "survey ×3 — “need tall sizes”" },
        { source: "review", text: "“love the fit but too short for me”" },
      ],
      missionStatus: "pass",
      missionLine: "trend: 6 requests",
      reasoning: "Six people asked for tall sizes this month. That's a repeatable request, not noise — I'm drafting a proposal (styles, inseams, expected demand) to add to the next drop for your review.",
      spec: "Proposal: add 34\" inseam to the two best-selling pant styles.",
    },
  },
  {
    id: "pi3",
    title: "This week's feedback digest → 3 ranked to-dos",
    stage: "done",
    sources: ["feedback"],
    origin: "proactive",
    pr: "✓ opened 3 tasks: checkout speed, size chart, restock alerts",
    evidence: {
      signals: [
        { source: "feedback", text: "42 post-purchase surveys read" },
        { source: "feedback", text: "top themes: checkout felt slow (9), sizing (7), out-of-stock (5)" },
      ],
      missionStatus: "pass",
      missionLine: "read 42 forms",
      reasoning: "Read every survey this week, grouped the answers, and turned the top themes into a ranked to-do list so you know what to improve next.",
      pr: "3 tasks opened, ranked by how many people it affects.",
    },
  },
];

export const activity: { skill: string; text: string; now?: boolean }[] = [
  { skill: "draft", text: "writing the reply to Jordan's review", now: true },
  { skill: "check", text: "Sunday delivery asks → drafting 'Friday ship' replies (R5)" },
  { skill: "listen", text: "3 new WhatsApp messages, 1 new review" },
  { skill: "check", text: "30% wholesale ask → declined against R3, counter-offer drafted" },
  { skill: "remind", text: "invoice #204 reminder drafted — waiting for your OK (R4)" },
  { skill: "order", text: "6 order questions answered, Shopify notes updated" },
  { skill: "follow-up", text: "wholesale quote nudge sent → they ordered" },
];

export const boardStages: { key: Stage; label: string }[] = [
  { key: "inbox", label: "Inbox" },
  { key: "checking", label: "Checking" },
  { key: "drafting", label: "Drafting" },
  { key: "awaiting", label: "Needs you" },
  { key: "done", label: "Done" },
  { key: "declined", label: "Didn't do" },
];

export const primaryNav = ["Home"];
export const drilldownNav = ["Activity", "Workers", "Connections", "Under the hood", "Settings"];

// --- Workers (the universal jobs every business has; Hermes skills underneath) ---
export type Arm = "reactive" | "proactive" | "shared";

/** Cron expression + human label for scheduling a worker run. */
export interface CronSchedule {
  expression: string; // standard cron, e.g. "0 7 * * 1-5"
  label: string; // human-readable, e.g. "Weekdays at 7:00 AM"
  enabled: boolean;
  nextRun?: string; // ISO timestamp or plain text like "Tomorrow 7:00 AM"
  lastRun?: string;
}

/** Chain: after this worker finishes, trigger another worker. */
export interface WorkerChain {
  nextWorker: string; // name of the worker to trigger
  condition: "always" | "on_success" | "on_failure";
  delayMinutes?: number; // delay before triggering next, default 0
}

/** A/B test variant definition. */
export interface ABTestVariant {
  name: string;
  purpose: string;
  autonomy: "auto" | "careful";
  runs: number;
  successRate?: number; // percentage of runs that succeeded
}

/** A/B test config for a worker — splits incoming work across variants. */
export interface ABTestConfig {
  variants: [ABTestVariant, ABTestVariant]; // exactly two variants
  splitB: number; // 0–100, percentage of traffic routed to variant B
  startedAt?: string;
}

export interface Skill {
  name: string;
  purpose: string;
  runs: number;
  lastRun: string;
  arm: Arm;
  requires: string[]; // connector ids this worker needs to run
  autonomy: "auto" | "careful"; // careful = drafts, waits for your OK
  schedule?: CronSchedule;
  chain?: WorkerChain;
  abTest?: ABTestConfig;
}

export const skills: Skill[] = [
  { name: "inbox responder", purpose: "Reads Telegram, email, and DMs; drafts replies in your tone; sends the routine ones you've approved", runs: 214, lastRun: "2m ago", arm: "reactive", requires: ["telegram", "email"], autonomy: "auto", abTest: { variants: [{ name: "concise", purpose: "Short, direct replies under 2 sentences", autonomy: "auto", runs: 112, successRate: 94 }, { name: "warm", purpose: "Friendly, detailed replies with personal touch", autonomy: "auto", runs: 102, successRate: 91 }], splitB: 50, startedAt: "2026-06-01" } },
  { name: "orders & fulfillment", purpose: "Answers 'where's my order?', shares tracking, checks stock and delivery windows before promising a date", runs: 96, lastRun: "6m ago", arm: "reactive", requires: ["shopify"], autonomy: "auto" },
  { name: "bookings", purpose: "Books and confirms appointments, pickups, and calls; reschedules on request and blocks conflicts", runs: 58, lastRun: "18m ago", arm: "reactive", requires: ["calendar"], autonomy: "careful" },
  { name: "quotes & estimates", purpose: "Turns an enquiry into a priced quote using your catalog and rules; sends after you approve the number", runs: 44, lastRun: "22m ago", arm: "proactive", requires: ["shopify", "email"], autonomy: "careful" },
  { name: "payments & invoicing", purpose: "Raises invoices, sends receipts, and chases overdue payments — every money message waits for your OK", runs: 31, lastRun: "1h ago", arm: "proactive", requires: ["billing"], autonomy: "careful" },
  { name: "reminders", purpose: "Sends appointment, restock, and renewal reminders so nothing gets forgotten", runs: 63, lastRun: "35m ago", arm: "proactive", requires: ["email"], autonomy: "auto" },
  { name: "follow-ups", purpose: "Nudges unanswered quotes and conversations that went quiet after a few days, once, politely", runs: 22, lastRun: "3h ago", arm: "proactive", requires: ["email"], autonomy: "auto" },
  { name: "returns & refunds", purpose: "Handles size swaps, returns, and refund requests within your policy; escalates the exceptions", runs: 19, lastRun: "52m ago", arm: "reactive", requires: ["shopify"], autonomy: "careful" },
  { name: "reviews & reputation", purpose: "Watches reviews and social mentions, drafts personal responses, flags the ones that need you", runs: 27, lastRun: "41m ago", arm: "reactive", requires: ["review"], autonomy: "auto" },
  { name: "lead capture", purpose: "Catches new enquiries from Telegram, forms, and DMs; qualifies them and routes the hot ones to you", runs: 38, lastRun: "12m ago", arm: "proactive", requires: ["telegram"], autonomy: "auto", chain: { nextWorker: "follow-ups", condition: "on_success", delayMinutes: 15 } },
  { name: "promotions", purpose: "Drafts offers, newsletters, and restock announcements — always inside your discount limit", runs: 14, lastRun: "2h ago", arm: "proactive", requires: ["email", "instagram"], autonomy: "careful" },
  { name: "restock & inventory", purpose: "Watches stock levels, flags what's running low, and drafts reorders before you sell out", runs: 41, lastRun: "1h ago", arm: "proactive", requires: ["shopify"], autonomy: "auto" },
  { name: "daily brief", purpose: "Every morning, sums up what happened, what it handled, and what's waiting for your approval", runs: 30, lastRun: "today 7:00", arm: "proactive", requires: [], autonomy: "auto", schedule: { expression: "0 7 * * 1-5", label: "Weekdays at 7:00 AM", enabled: true, nextRun: "Tomorrow 7:00 AM", lastRun: "Today 7:00 AM" } },
  { name: "product insights", purpose: "Reads reviews, feedback forms, and suggestions. When several people flag the same problem it opens a human task to fix it; when several ask for the same thing it plans it next; and it turns survey answers into a ranked to-do list.", runs: 47, lastRun: "24m ago", arm: "proactive", requires: ["review", "feedback"], autonomy: "careful" },
  { name: "rule keeper", purpose: "Checks every action against your rules before it happens; declines what breaks them and tells you why", runs: 337, lastRun: "2m ago", arm: "shared", requires: [], autonomy: "auto" },
];

export const workerColor: Record<string, string> = {
  "inbox responder": "#22c55e",
  "orders & fulfillment": "#14b8a6",
  bookings: "#3b82f6",
  "quotes & estimates": "#06b6d4",
  "payments & invoicing": "#eab308",
  reminders: "#f59e0b",
  "follow-ups": "#a855f7",
  "returns & refunds": "#ec4899",
  "reviews & reputation": "#f97316",
  "lead capture": "#8b5cf6",
  promotions: "#d946ef",
  "restock & inventory": "#0ea5e9",
  "daily brief": "#64748b",
  "product insights": "#10b981",
  "rule keeper": "#ef4444",
};

// --- Connections (their tools, via OAuth — no setup, no terminal) ---
export type ConnState = "connected" | "available";
export interface Connector {
  id: string;
  name: string;
  role: string;
  state: ConnState;
  detail?: string;
  tier?: "live" | "soon"; // "live" = really wired end-to-end; "soon" = not built yet
  statusKey?: "telegram" | "gmail" | "elevenlabs" | "linkup" | "shopify"; // maps to /api/channels
}

export const connectors: Connector[] = [
  // Really wired end-to-end (go live the moment a credential is set in server/.env)
  { id: "telegram", name: "Telegram", role: "customer chat — inbound + replies", state: "connected", tier: "live", statusKey: "telegram" },
  { id: "email", name: "Gmail", role: "inbox + follow-ups", state: "connected", tier: "live", statusKey: "gmail", detail: "hello@northline.co" },
  { id: "shopify", name: "Shopify", role: "live product catalog + order lookup", state: "connected", tier: "live", statusKey: "shopify" },
  { id: "elevenlabs", name: "ElevenLabs", role: "voice replies", state: "available", tier: "live", statusKey: "elevenlabs" },
  { id: "linkup", name: "Linkup", role: "live web search for the crew", state: "available", tier: "live", statusKey: "linkup" },
  // Not built yet — shown honestly as coming soon, not faked as connected
  { id: "discord", name: "Discord", role: "customer messages", state: "connected", tier: "soon", detail: "38 conversations this week" },
  { id: "review", name: "Google Business", role: "reviews", state: "connected", tier: "soon", detail: "4.6★ · 312 reviews" },
  { id: "feedback", name: "Feedback forms", role: "surveys + suggestions", state: "connected", tier: "soon", detail: "Typeform + post-purchase survey" },
  { id: "razorpay", name: "Razorpay", role: "payments", state: "available", tier: "soon" },
  { id: "billing", name: "Stripe / invoices", role: "payments + reminders", state: "available", tier: "soon" },
  { id: "instagram", name: "Instagram", role: "DMs + posts", state: "available", tier: "soon" },
  { id: "calendar", name: "Google Calendar", role: "restocks + drops", state: "available", tier: "soon" },
  { id: "phone", name: "Phone / voicemail", role: "missed-call texts", state: "available", tier: "soon" },
];

// --- Activity log (what it did and refused, with evidence) ---
export interface Decision {
  id: string;
  title: string;
  date: string;
  status: "shipped" | "rejected";
  origin: Origin;
  evidence: Evidence;
}

export const decisions: Decision[] = cards
  .filter((c) => (c.stage === "done" || c.stage === "declined") && c.evidence)
  .map((c, i) => ({
    id: `d${i + 1}`,
    title: c.title,
    date: c.stage === "done" ? "done" : "declined",
    status: (c.stage === "done" ? "shipped" : "rejected") as "shipped" | "rejected",
    origin: c.origin ?? "reactive",
    evidence: c.evidence!,
  }));

export const settings = {
  brainPath: "brain/ (on your managed Hermes)",
  cron: "always on",
  shipGate: "drafts everything · you approve what matters",
  connection: "managed Hermes instance in the cloud — nothing to install",
};

// --- Overview data ---
export const loopPipeline: { stage: string; count: number; active?: boolean }[] = [
  { stage: "listen", count: 9 },
  { stage: "understand", count: 4 },
  { stage: "check rules", count: 3 },
  { stage: "draft", count: 2, active: true },
  { stage: "your OK", count: 2 },
  { stage: "done", count: 8 },
];

export const layers: { id: string; name: string; tech: string; stat: string; note: string }[] = [
  { id: "L1", name: "Your business file", tech: "plain files you can read", stat: "", note: "rules, tone, and history — readable any time" },
  { id: "L2", name: "Memory", tech: "remembers every customer & decision", stat: "312 memories", note: "“Jordan asked this before” — it knows" },
  { id: "L3", name: "Workers", tech: "the jobs it runs for you", stat: `${skills.length} workers`, note: "inbox, orders, reminders, follow-ups, reviews" },
];

export const driftAlerts: { title: string; detail: string }[] = [
  {
    title: "Sunday delivery asks keep coming — 7 this month",
    detail: "Your rule R5 blocks Sunday shipping, and 7 customers asked anyway. Keep the rule, or offer Saturday cutoffs? One tap to decide.",
  },
];
