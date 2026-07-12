// Daily Researcher — the engine that runs web research on configured topics,
// synthesizes findings using the LLM, saves reports to brain/research/, and
// returns structured results for delivery via dashboard, email, and Telegram.
//
// Architecture:
//   scheduler ticks → runResearch(config) → for each topic:
//     1. LLM generates a focused search query from the topic name
//     2. Linkup search returns web results + sourced answer
//     3. LLM synthesizes a concise findings section
//   → collates into a Markdown report → saves to brain/research/<date>.md
//   → returns { report, findings[], date } for delivery

import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { linkupSearch, linkupEnabled } from "./linkup.mjs";
import { runAgent, hasModel } from "./lib/agent.mjs";
import { newRun, finishRun, addStep } from "./lib/trace.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const BRAIN = join(__dir, "..", "brain");
const CONFIG_PATH = join(BRAIN, "research", "config.json");
const REPORT_DIR = join(BRAIN, "research");

// ── Default research config ───────────────────────────────────────────────────
const DEFAULT_TOPICS = [
  "Competitor pricing & products",
  "Industry trends & news",
  "Customer sentiment",
  "Supplier & shipping news",
];

export const DEFAULT_CONFIG = {
  enabled: true,
  time: "08:00",
  topics: DEFAULT_TOPICS,
  lastRun: null,
  lastReportDate: null,
};

// ── Config load / save ─────────────────────────────────────────────────────────

export async function loadConfig() {
  try {
    const raw = await readFile(CONFIG_PATH, "utf8");
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function saveConfig(config) {
  await mkdir(dirname(CONFIG_PATH), { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// ── List past reports ──────────────────────────────────────────────────────────

export async function listReports() {
  try {
    const dir = REPORT_DIR;
    if (!existsSync(dir)) return [];
    const files = await readdir(dir);
    const reports = [];
    for (const f of files) {
      if (!f.match(/^\d{4}-\d{2}-\d{2}\.md$/)) continue;
      try {
        const body = await readFile(join(dir, f), "utf8");
        const title = body.match(/^#\s+(.+)$/m)?.[1]?.trim() || f.replace(".md", "");
        reports.push({
          date: f.replace(".md", ""),
          title,
          summary: body.split("\n").slice(0, 6).join("\n").trim(),
          body,
        });
      } catch { /* skip unreadable */ }
    }
    return reports.sort((a, b) => b.date.localeCompare(a.date));
  } catch {
    return [];
  }
}

// ── Generate a search query from a topic name using the LLM ────────────────────

async function generateQuery(topic, businessContext) {
  const run = newRun(`generate query: ${topic}`, { channel: "research", customer: "system", version: "v1" });
  try {
    const result = await runAgent(run, {
      agent: "researcher",
      note: "generate query",
      system:
        "You generate precise web search queries for a daily research assistant. " +
        "Given a topic name and business context, output a SHORT, focused search query (10-15 words) " +
        "that will return the most relevant current results. " +
        "Return ONLY a JSON object: {\"query\": \"...\", \"reason\": \"...\"}",
      user:
        `Business: ${businessContext || "a clothing brand selling shirts and pants"}\n` +
        `Topic: "${topic}"\n\n` +
        `Generate a single web search query that will find the most useful current information.`,
      json: true,
    });
    await finishRun(run, { status: "done", verdict: null, outcome: "query generated" });
    return result.json?.query || topic;
  } catch {
    await finishRun(run, { status: "error", verdict: null, outcome: "query generation failed" });
    return topic; // fallback
  }
}

// ── Synthesize findings from search results ────────────────────────────────────

async function synthesizeFindings(topic, query, searchResult) {
  const run = newRun(`synthesize: ${topic}`, { channel: "research", customer: "system", version: "v1" });
  try {
    const result = await runAgent(run, {
      agent: "researcher",
      note: "synthesize",
      system:
        "You summarize web search results into a concise, useful research finding. " +
        "Be factual, cite the source names naturally, and highlight the most important takeaways. " +
        "Format as Markdown bullet points. Keep it to 3-5 key points. " +
        "If the search returned no useful results, say so honestly — never invent facts.",
      user:
        `Topic: "${topic}"\nSearch query: "${query}"\n\nSearch results:\n${searchResult.answer || "(no results found)"}\n\n` +
        (searchResult.sources?.length > 0
          ? `Sources: ${searchResult.sources.map((s) => `${s.name} (${s.url})`).join("; ")}`
          : ""),
      json: false,
    });
    await finishRun(run, { status: "done", verdict: null, outcome: "synthesis complete" });
    return result.text || "No findings could be generated from the search results.";
  } catch {
    await finishRun(run, { status: "error", verdict: null, outcome: "synthesis failed" });
    return "Unable to synthesize findings due to an error.";
  }
}

// ── Run the full research cycle ────────────────────────────────────────────────
// Returns: { success, report, findings[], date, sources[], config, error? }

export async function runResearch() {
  const config = await loadConfig();
  if (!config.enabled) {
    return { success: false, error: "Research is disabled", config };
  }

  const topics = config.topics?.length > 0 ? config.topics : DEFAULT_TOPICS;
  const today = new Date().toISOString().slice(0, 10);
  const businessContext = "a clothing brand selling shirts and pants";

  // If research was already run today, return the existing report
  if (config.lastReportDate === today) {
    const reports = await listReports();
    const existing = reports.find((r) => r.date === today);
    if (existing) {
      return { success: true, report: existing.body, date: today, skipped: true };
    }
  }

  // Check prerequisites
  const hasSearch = linkupEnabled();
  const hasLLM = hasModel;
  if (!hasSearch && !hasLLM) {
    return {
      success: false,
      error: "Neither Linkup (web search) nor LLM credential (OPENAI_API_KEY) is configured. Set LINKUP_API_KEY in server/.env to enable web research.",
      config,
    };
  }

  const findings = [];

  for (const topic of topics) {
    const query = hasLLM
      ? await generateQuery(topic, businessContext)
      : topic;

    let searchResult = { answer: "(skipped — no Linkup key configured)", sources: [] };
    if (hasSearch) {
      try {
        searchResult = await linkupSearch(query);
      } catch (e) {
        searchResult = { answer: `Search failed: ${e.message || e}`, sources: [] };
      }
    }

    let synthesis = searchResult.answer;
    if (hasLLM && searchResult.answer && searchResult.answer !== "(no results found)") {
      synthesis = await synthesizeFindings(topic, query, searchResult);
    }

    findings.push({
      topic,
      query,
      synthesis: synthesis || "(no results)",
      sources: searchResult.sources || [],
    });
  }

  // Build the Markdown report
  const dateStr = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const lines = [`# Daily Research — ${dateStr}`, "", `_Auto-generated on ${new Date().toISOString()}_`, ""];

  for (const f of findings) {
    lines.push(`## ${f.topic}`, "");
    if (f.query) lines.push(`_Search query: "${f.query}"_`, "");
    lines.push(f.synthesis || "No findings.", "");
    if (f.sources.length > 0) {
      lines.push("**Sources:**");
      for (const s of f.sources) {
        lines.push(`- [${s.name}](${s.url})${s.snippet ? ` — ${s.snippet.slice(0, 100)}` : ""}`);
      }
      lines.push("");
    }
    lines.push("---", "");
  }

  const report = lines.join("\n");

  // Save to brain/research/<date>.md
  try {
    await mkdir(REPORT_DIR, { recursive: true });
    await writeFile(join(REPORT_DIR, `${today}.md`), report);
  } catch (e) {
    // report saved to memory even if file write fails
  }

  // Update config with last run info
  config.lastRun = new Date().toISOString();
  config.lastReportDate = today;
  await saveConfig(config);

  return {
    success: true,
    report,
    findings: findings.map((f) => ({ topic: f.topic, summary: f.synthesis })),
    date: today,
    sources: findings.flatMap((f) => f.sources),
    config,
  };
}
