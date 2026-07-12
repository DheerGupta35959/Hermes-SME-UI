// Real Hermes adapter — a thin bridge between the Alera UI and your locally
// installed Nous Research Hermes Agent CLI.
//
// The browser can't spawn a process, so this tiny server does it: it shells out
// to the real `hermes` binary and returns the result synchronously (no cron).
//
//   UI  ──POST /api/ask|command──▶  this adapter  ──exec──▶  hermes chat -q ... -Q
//                                                              (real agent runs now)
//   UI  ◀──── final answer ─────────────────────────────────────────┘
//
// Run:  npm run hermes        (from alera/)
// Point the UI at it with alera/.env.local → VITE_HERMES_URL=http://localhost:8787
//
// PREREQUISITE: authenticate a model once, e.g.
//   hermes model                       (pick a provider/model)
//   hermes auth add nous --type oauth  (Nous Portal)
//   …or set an API key in ~/.hermes/hermes-agent/.env
// Until then, hermes chat will error and this adapter returns that error verbatim.

import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { homedir } from "node:os";
import { initTraceStore, listRuns, getRun, searchRuns } from "./lib/trace.mjs";
import { initOrchestrator, handleInbound } from "./orchestrator.mjs";
import { channelStatus, deliver, tgPoll, tgSend } from "./channels.mjs";
import { speak, voiceEnabled } from "./voice.mjs";
import { linkupEnabled } from "./linkup.mjs";
import { shopifyEnabled } from "./shopify.mjs";
import { catalogEnabled, catalogSize, catalogStats } from "./catalog.mjs";
import { chat } from "./lib/agent.mjs";
import { initDb, saveItem, loadItems, findUserByUsername, findUserById, listAllUsers, createUser, updateUser, deleteUser, getUserRoles } from "./lib/db.mjs";
import { verifyToken, isPublicPath, verifyPassword, signToken } from "./lib/auth.mjs";
import { convexEnabled, cxUpsert, cxList } from "./lib/convexStore.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const BRAIN = join(__dir, "..", "brain");
const BIZ_FILE = join(__dir, "business.json");
const PORT = process.env.PORT || 8787;
const TOKEN = process.env.ALERA_TOKEN || "";

initTraceStore(BRAIN);
initOrchestrator(BRAIN);
initDb(join(__dir, "alera.db"));

// live projection the cockpit reads: real agent runs become stream items, and
// the drafted action for each is held so an approval can actually send it.
// Hydrated from SQLite on boot so the session survives restarts.
const streamItems = [];
const drafts = new Map(); // runId → { channel, to, draft, subject }
function hydrateFrom(rows) {
	streamItems.length = 0;
	drafts.clear();
	for (const { item, draft } of rows) {
		streamItems.push(item);
		if (draft) drafts.set(item.id, draft);
	}
}
hydrateFrom(loadItems()); // instant local hydrate
if (convexEnabled()) {
	// Convex is the source of truth when configured — replace once it loads.
	cxList().then((rows) => rows.length && hydrateFrom(rows)).catch(() => {});
}

// Persist an agent run to both stores: SQLite (local) + Convex (state of record).
function persistItem(item, draft) {
	saveItem(item, draft);
	void cxUpsert(item, draft).catch(() => {});
}

function channelToSource(ch) {
	return ch === "email" ? "email" : ch === "review" ? "review" : "whatsapp";
}

// Turn one crew run into a cockpit stream item and remember its draft to send.
function ingestResult(r, { to, channel }) {
	drafts.set(r.runId, { channel, to, draft: r.draft, subject: "Northline" });
	const item = {
		id: r.runId,
		title: r.title,
		stage: r.stage,
		origin: "reactive",
		sources: [channelToSource(channel)],
		verdict: {
			status: r.verdict?.status ?? "approved",
			missionLine: r.verdict?.rule,
			reasoning: r.verdict?.reasoning,
		},
		outcome: r.outcome,
		evidence: {
			signals: [{ source: channelToSource(channel), text: r.title }],
			missionLine: r.verdict?.rule,
			missionStatus: r.verdict?.status === "rejected" ? "fail" : "pass",
			reasoning: r.verdict?.reasoning,
			spec: r.draft,
		},
		specialist: r.specialist,
		totals: r.totals,
		customer: to ?? null,
		channel: channel ?? null,
		at: new Date().toISOString(),
	};
	streamItems.unshift(item);
	if (streamItems.length > 60) streamItems.pop();
	persistItem(item, drafts.get(r.runId));
	return item;
}

// Live business context for the owner chat — real catalog stats + who has
// pinged + what happened. Lets "Talk to Alera" answer analytics questions
// ("how many products?", "who messaged us?") grounded in real data.
function businessContext() {
	const fmt = (o) =>
		Object.entries(o)
			.map(([k, v]) => `${k}: ${v}`)
			.join(", ");
	const customers = [
		...new Set(streamItems.map((i) => i.customer).filter(Boolean)),
	];
	const activity = streamItems
		.slice(0, 25)
		.map(
			(i) =>
				`- ${i.customer || "?"} via ${i.channel || "?"}: "${i.title}" → ${i.stage}${i.verdict?.missionLine ? ` [${i.verdict.missionLine}]` : ""}`,
		)
		.join("\n");
	const parts = [];
	if (business?.name)
		parts.push(
			`BUSINESS: ${business.name}${business.about ? ` — ${business.about}` : ""}`,
		);
	if (catalogEnabled()) {
		const s = catalogStats();
		parts.push(
			`PRODUCT CATALOG: ${s.count} products. By audience: {${fmt(s.byAudience)}}. By type: {${fmt(s.byType)}}. Top brands: {${fmt(
				Object.fromEntries(
					Object.entries(s.byVendor)
						.sort((a, b) => b[1] - a[1])
						.slice(0, 6),
				),
			)}}. Price range ₹${s.min}–₹${s.max}.`,
		);
	}
	parts.push(
		`CUSTOMER ACTIVITY (this session): ${streamItems.length} messages from ${customers.length} people.\nContacts: ${customers.join(", ") || "none yet"}\nRecent:\n${activity || "none yet"}`,
	);
	return parts.join("\n\n");
}

// locate the real hermes binary + its project dir
const HERMES_BIN =
	process.env.HERMES_BIN || join(homedir(), ".local", "bin", "hermes");
const HERMES_CWD =
	process.env.HERMES_CWD || join(homedir(), ".hermes", "hermes-agent");
const TIMEOUT_MS = Number(process.env.HERMES_TIMEOUT_MS || 180000);

// ── business profile (persisted so the persona survives restarts) ──────────────
let business = null; // { name, about }
try {
	if (existsSync(BIZ_FILE))
		business = JSON.parse(readFileSync(BIZ_FILE, "utf8"));
} catch {
	business = null;
}
function saveBusiness(b) {
	business = b;
	try {
		writeFileSync(BIZ_FILE, JSON.stringify(b, null, 2));
	} catch {
		/* ignore */
	}
}

// The persona every chat/command runs under — this is what makes the agent speak
// as Alera for THIS business instead of as generic Hermes.
function persona() {
	const name = business?.name?.trim();
	const lines = [
		`You are "Alera", the AI business assistant${name ? ` for ${name}` : ""}.`,
		`Identity rules: always speak as Alera. Never say you are "Hermes", a "CLI agent", or describe yourself as a coding/terminal tool. You run this business day-to-day.`,
	];
	if (business?.about) lines.push(`About the business: ${business.about}`);
	lines.push(
		`You handle: inbox replies, orders & fulfillment, reminders, follow-ups, reviews, and product insights. You always ask the owner before anything money-related. Be warm, concise, and practical.`,
	);
	return lines.join("\n");
}

// ── run the real agent, one-shot ──────────────────────────────────────────────
function runHermes(prompt, extraArgs = []) {
	return new Promise((resolve) => {
		const args = [
			"chat",
			"-q",
			prompt,
			"-Q",
			"--yolo",
			"--accept-hooks",
			...extraArgs,
		];
		execFile(
			HERMES_BIN,
			args,
			{
				cwd: HERMES_CWD,
				timeout: TIMEOUT_MS,
				maxBuffer: 1024 * 1024 * 16,
				env: process.env,
			},
			(err, stdout, stderr) => {
				const out = (stdout || "").trim();
				if (err && !out) {
					resolve({
						ok: false,
						text: (stderr || err.message || "hermes error").trim(),
					});
				} else {
					resolve({ ok: true, text: out || (stderr || "").trim() });
				}
			},
		);
	});
}

// run the agent in-character (persona prepended) — used for chat/ask/command
function askAlera(userText) {
	return runHermes(`${persona()}\n\n----- The owner says: -----\n${userText}`);
}

// read-only agent introspection (best-effort; ignored if it fails)
function hermesRaw(args) {
	return new Promise((resolve) => {
		execFile(
			HERMES_BIN,
			args,
			{
				cwd: HERMES_CWD,
				timeout: 20000,
				maxBuffer: 1024 * 1024 * 8,
				env: process.env,
			},
			(err, stdout) => {
				resolve(err ? "" : (stdout || "").trim());
			},
		);
	});
}

// ── activity log (kept in memory; the terminal shows real runs) ────────────────
// chronological: oldest first, newest last (UI shows newest at the bottom)
const activity = [
	{ skill: "hermes", text: `adapter online → ${HERMES_BIN}`, now: true },
];
function pushLog(skill, text) {
	for (const a of activity) a.now = false;
	activity.push({ skill, text, now: true });
	if (activity.length > 60) activity.splice(0, activity.length - 60);
}

// ── brain docs (the app's own brain/ folder) ───────────────────────────────────
const TITLE_MAP = {
	"mission.md": "Business Rules",
	"strategy.md": "Strategy",
	"product.md": "Product Information",
	"decisions.md": "Decisions",
};
function prettyTitle(name, body) {
	if (TITLE_MAP[name]) return TITLE_MAP[name];
	const h = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
	if (h) return h.replace(/^(Signal|Verdict|Cluster|Hypothesis)\s+—\s*/i, "");
	return name.replace(/\.md$/, "").replace(/-/g, " ");
}
async function walk(dir) {
	const out = [];
	for (const e of await readdir(dir, { withFileTypes: true })) {
		const p = join(dir, e.name);
		if (e.isDirectory()) out.push(...(await walk(p)));
		else if (e.name.endsWith(".md")) out.push(p);
	}
	return out;
}
async function loadDocs() {
	const docs = [];
	for (const p of await walk(BRAIN)) {
		const rel = relative(BRAIN, p).split("\\").join("/");
		const name = rel.split("/").pop();
		const dir = rel.includes("/") ? rel.split("/")[0] : "";
		const body = await readFile(p, "utf8");
		docs.push({
			id: `/brain/${rel}`,
			rel,
			name,
			dir,
			title: prettyTitle(name, body),
			body,
			badge:
				name === "mission.md" ? "Live" : name === "product.md" ? "Lock" : null,
		});
	}
	return docs;
}
function safeRel(rel) {
	return join(BRAIN, rel.replace(/^\/+/, "").replace(/\.\.(\/|\\)/g, ""));
}

// ── http plumbing ───────────────────────────────────────────────────────────────
function send(res, code, data) {
	res.writeHead(code, {
		"Content-Type": "application/json",
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Headers": "Content-Type, Authorization",
		"Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
	});
	res.end(data === undefined ? "" : JSON.stringify(data));
}
function readBody(req) {
	return new Promise((resolve) => {
		let b = "";
		req.on("data", (c) => (b += c));
		req.on("end", () => {
			try {
				resolve(b ? JSON.parse(b) : {});
			} catch {
				resolve({});
			}
		});
	});
}

const server = createServer(async (req, res) => {
	const url = new URL(req.url, `http://localhost:${PORT}`);
	const { pathname } = url;
	if (req.method === "OPTIONS") return send(res, 204);

	if (!isPublicPath(pathname)) {
		const header = req.headers.authorization;
		if (!header) return send(res, 401, { error: "unauthorized" });

		const token = header.startsWith("Bearer ") ? header.slice(7) : "";
		const payload = verifyToken(token);

		if (payload) {
			req.user = payload;
		} else {
			// Fallback: ALERA_TOKEN shared-secret (machine-to-machine)
			if (!TOKEN || token !== TOKEN) {
				return send(res, 401, { error: "unauthorized" });
			}
			req.user = { sub: "machine", username: "machine", email: "", roles: ["Admin"] };
		}
	}

	try {
		// READ
		if (req.method === "GET" && pathname === "/api/state") {
			return send(res, 200, {
				activity: [...activity],
				stream: [...streamItems],
				workers: [],
			});
		}
		// observability: trace list / search / one run tree
		if (req.method === "GET" && pathname === "/api/traces") {
			const q = url.searchParams.get("q");
			return send(res, 200, q ? await searchRuns(q) : await listRuns());
		}
		if (req.method === "GET" && pathname === "/api/trace") {
			return send(
				res,
				200,
				(await getRun(url.searchParams.get("id"))) ?? { error: "not found" },
			);
		}
		if (req.method === "GET" && pathname === "/api/channels") {
			return send(res, 200, {
				...channelStatus(),
				linkup: linkupEnabled(),
				shopify: shopifyEnabled() || catalogEnabled(),
				convex: convexEnabled(),
				model: true,
			});
		}
		if (req.method === "GET" && pathname === "/api/brain/docs")
			return send(res, 200, await loadDocs());
		if (req.method === "GET" && pathname === "/api/brain/doc") {
			return send(res, 200, {
				body: await readFile(safeRel(url.searchParams.get("rel")), "utf8"),
			});
		}
		// current business profile (so the UI can hydrate the greeting + setup state)
		if (req.method === "GET" && pathname === "/api/business") {
			return send(res, 200, { business, setup: Boolean(business?.name) });
		}

		// WRITE — the real agent (in Alera persona)
		if (req.method === "POST" && pathname === "/api/ask") {
			const { question, history = [] } = await readBody(req);
			pushLog("you", question);
			const system =
				`You are Alera, the AI operations assistant for ${business?.name || "this business"}, in an ongoing chat with the owner. ` +
				`Use BOTH the conversation so far and the live business context below to answer. ` +
				`Resolve follow-ups ("do it", "break it down", "yes") against your own previous message. Be concise and specific. ` +
				`For product counts, categories, prices, or customer contacts, use ONLY the data in the context — never invent products, customers, or figures. ` +
				`If something truly isn't in the conversation or the context, say what's missing.\n\n=== LIVE BUSINESS CONTEXT ===\n${businessContext()}`;
			const text = await chat({
				system,
				user: question,
				history: Array.isArray(history) ? history.slice(-10) : [],
			});
			pushLog("alera", "answered");
			return send(res, 200, { text, sources: [], confidence: "high" });
		}
		if (req.method === "POST" && pathname === "/api/command") {
			const { text } = await readBody(req);
			pushLog("you", text);
			const r = await askAlera(text);
			const line = { skill: r.ok ? "alera" : "error", text: r.text };
			pushLog(line.skill, r.text.slice(0, 200));
			return send(res, 200, [line]);
		}

		// brain edits → write the file the app reads
		if (req.method === "PUT" && pathname === "/api/brain/doc") {
			const { rel, body } = await readBody(req);
			await mkdir(dirname(safeRel(rel)), { recursive: true });
			await writeFile(safeRel(rel), body ?? "");
			pushLog("edit", `${rel} saved`);
			return send(res, 204);
		}

		// a new customer message → run the crew, project the result, auto-send if allowed
		if (req.method === "POST" && pathname === "/api/inbound") {
			const { text, customer, channel = "telegram" } = await readBody(req);
			pushLog(
				channel,
				`↙ ${customer || "customer"}: ${String(text).slice(0, 60)}`,
			);
			const r = await handleInbound(text, { customer, channel });
			const item = ingestResult(r, { to: customer, channel });
			pushLog(
				"crew",
				`${r.specialist} → ${r.stage} · ${r.verdict?.rule ?? ""} · $${r.totals.costUsd.toFixed(4)} · ${r.totals.ms}ms`,
			);
			if (r.stage === "done" && r.draft) {
				const sent = await deliver(channel, customer, r.draft);
				pushLog(
					"send",
					sent.live
						? `✓ sent on ${channel}`
						: sent.error
							? `send failed: ${sent.error.slice(0, 80)}`
							: `staged (${sent.note})`,
				);
			}
			return send(res, 200, { item, runId: r.runId });
		}

		// hear a reply aloud / send it as voice (ElevenLabs power-up)
		if (req.method === "POST" && pathname === "/api/voice") {
			const { text } = await readBody(req);
			try {
				const audio = await speak(text || "");
				res.writeHead(200, {
					"Content-Type": "audio/mpeg",
					"Access-Control-Allow-Origin": "*",
				});
				return res.end(audio);
			} catch (e) {
				return send(res, 503, { error: String(e.message || e) });
			}
		}

		// approvals → actually deliver the held draft on its channel
		if (
			req.method === "POST" &&
			(pathname === "/api/approve" || pathname === "/api/override")
		) {
			const { itemId, verdict } = await readBody(req);
			const d = drafts.get(itemId);
			const it = streamItems.find((s) => s.id === itemId);
			if (pathname === "/api/approve" && d?.draft) {
				const sent = await deliver(d.channel, d.to, d.draft);
				if (it) {
					it.stage = "done";
					it.outcome = sent.live ? "✓ approved & sent" : "approved (staged)";
				}
				pushLog(
					"approve",
					`${itemId} → ${sent.live ? `sent on ${d.channel}` : "staged"}`,
				);
			} else {
				if (it) {
					it.stage = verdict?.status === "rejected" ? "declined" : "done";
					it.outcome = "your call recorded";
				}
				pushLog(
					"override",
					`${itemId}${verdict ? ` (${verdict.status})` : ""}`,
				);
			}
			if (it) persistItem(it, d); // persist the new stage
			return send(res, 202, { ok: true });
		}
		if (req.method === "POST" && pathname === "/api/worker/run") {
			const { name } = await readBody(req);
			pushLog(name, `run requested`);
			return send(res, 200, [{ skill: name, text: `queued ${name}` }]);
		}
		if (req.method === "POST" && pathname === "/api/worker") {
			return send(res, 200, { ok: true });
		}
		// define a NEW worker role from the UI (non-eng): job + tools + guardrail.
		// Written to brain/workers/<slug>.md so the manager can delegate to it.
		if (req.method === "POST" && pathname === "/api/worker/define") {
			const {
				name,
				job,
				tools = [],
				autonomy = "careful",
				guardrail = "",
			} = await readBody(req);
			const slug = String(name)
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, "-")
				.replace(/^-|-$/g, "");
			const dir = join(BRAIN, "workers");
			await mkdir(dir, { recursive: true });
			const md = `name: ${name}\njob: ${job}\ntools: ${tools.join(", ")}\nautonomy: ${autonomy}\nguardrail: ${guardrail}\n\n# ${name}\n\n${job}\n\n**Tools:** ${tools.join(", ") || "none"}\n**Autonomy:** ${autonomy}\n**Guardrail:** ${guardrail || "follows the shop rules"}\n`;
			await writeFile(join(dir, `${slug}.md`), md);
			pushLog("worker", `defined new worker "${name}" (${autonomy})`);
			return send(res, 200, { ok: true, slug });
		}
		// save business profile → set persona, persist, store in Hermes memory, set up skills
		if (req.method === "POST" && pathname === "/api/business") {
			const { name, about } = await readBody(req);
			saveBusiness({ name, about }); // persona now applies to every future call
			pushLog("setup", `configuring Alera for ${name}…`);

			const workers = [
				"inbox responder",
				"orders & fulfillment",
				"reminders",
				"follow-ups",
				"reviews & reputation",
				"product insights",
			];
			const docs = [
				"Return & refund policy",
				"Shipping & delivery",
				"FAQ / sizing guide",
			];

			// tell the real agent to remember the profile + its Alera identity for this business
			const prompt =
				`You are Alera, the assistant for ${name}. Save this to your long-term memory so you remember it every session ` +
				`(replace any earlier business profile). Business name: ${name}. About: ${about}. ` +
				`From now on you manage this business as Alera.`;
			const r = await runHermes(prompt);
			workers.forEach((w) => pushLog(w, "activated"));
			pushLog(
				"setup",
				r.ok
					? `Alera is set up for ${name} ✓`
					: "setup saved (memory write failed)",
			);

			return send(res, 200, {
				ok: r.ok,
				business,
				workers,
				docs,
				text: r.text,
			});
		}

		// ── Account / Auth ────────────────────────────────────────────────────────
		if (req.method === "POST" && pathname === "/api/account/login") {
			const { username, password } = await readBody(req);
			if (!username || !password) return send(res, 400, { error: "username and password required" });
			const user = findUserByUsername(username);
			if (!user || !verifyPassword(password, user.password_hash))
				return send(res, 401, { error: "Invalid username or password" });
			const roles = getUserRoles(user.id);
			const payload = {
				id: user.id,
				username: user.username,
				email: user.email,
				displayName: user.display_name,
				roles,
			};
			const token = signToken(payload);
			return send(res, 200, { token, user: payload });
		}

		if (req.method === "GET" && pathname === "/api/account/me") {
			const uid = req.user?.sub;
			if (!uid) return send(res, 401, { error: "unauthorized" });
			if (uid === "machine") {
				return send(res, 200, {
					user: { id: "machine", username: "machine", email: "", displayName: "Machine", roles: ["Admin"] },
				});
			}
			const user = findUserById(uid);
			if (!user) return send(res, 401, { error: "user not found" });
			return send(res, 200, {
				user: {
					id: user.id,
					username: user.username,
					email: user.email,
					displayName: user.display_name,
					roles: user.roles,
				},
			});
		}

		// Admin-only user management
		if (pathname.startsWith("/api/account/users")) {
			if (!req.user?.roles?.includes("Admin")) return send(res, 403, { error: "forbidden" });
		}

		if (req.method === "GET" && pathname === "/api/account/users") {
			const users = listAllUsers().map((u) => ({
				id: u.id,
				username: u.username,
				email: u.email,
				displayName: u.display_name,
				roles: u.roles,
				createdAt: u.created_at,
			}));
			return send(res, 200, users);
		}

		if (req.method === "POST" && pathname === "/api/account/users") {
			const body = await readBody(req);
			if (!body.username || !body.password || !body.email)
				return send(res, 400, { error: "username, email, and password required" });
			try {
				const user = createUser(body);
				if (!user) return send(res, 500, { error: "failed to create user" });
				return send(res, 201, {
					id: user.id,
					username: user.username,
					email: user.email,
					displayName: user.display_name,
					roles: user.roles,
				});
			} catch (e) {
				return send(res, 409, { error: String(e.message || e) });
			}
		}

		if (req.method === "PUT" && pathname.startsWith("/api/account/users/")) {
			const id = pathname.slice("/api/account/users/".length);
			if (!id) return send(res, 400, { error: "missing user id" });
			const body = await readBody(req);
			const user = updateUser(id, body);
			if (!user) return send(res, 404, { error: "user not found" });
			return send(res, 200, {
				id: user.id,
				username: user.username,
				email: user.email,
				displayName: user.display_name,
				roles: user.roles,
			});
		}

		if (req.method === "DELETE" && pathname.startsWith("/api/account/users/")) {
			const id = pathname.slice("/api/account/users/".length);
			if (!id) return send(res, 400, { error: "missing user id" });
			if (id === "admin") return send(res, 403, { error: "cannot delete default admin" });
			deleteUser(id);
			return send(res, 204);
		}

		return send(res, 404, { error: "not found" });
	} catch (err) {
		return send(res, 500, { error: String(err) });
	}
});

server.listen(PORT, async () => {
	console.log(`\n  Alera → Hermes adapter on http://localhost:${PORT}`);
	console.log(`  hermes binary: ${HERMES_BIN}`);
	console.log(`  hermes cwd:    ${HERMES_CWD}`);
	if (!existsSync(HERMES_BIN)) {
		console.log(`\n  ⚠ hermes binary not found. Set HERMES_BIN to its path.\n`);
		return;
	}
	const status = await hermesRaw(["status"]);
	const model = status.match(/Model:\s*(.+)/)?.[1]?.trim();
	// ready if a model is set AND (some API key is ✓ OR some auth provider is logged in)
	const hasApiKey = /API Keys[\s\S]*?✓/.test(status);
	const hasAuth =
		/Auth Providers[\s\S]*?✓/.test(status) ||
		(/Auth Providers/.test(status) &&
			!/Auth Providers[\s\S]*not logged in/.test(status));
	const ready = Boolean(model) && (hasApiKey || hasAuth);
	console.log(`  hermes status: ${status ? "reachable" : "unreachable"}`);
	if (model) console.log(`  model:         ${model}`);
	console.log(
		`  point the UI here: echo "VITE_HERMES_URL=http://localhost:${PORT}" > .env.local\n`,
	);
	if (!ready) {
		console.log(
			`  ℹ Could not confirm a model credential from \`hermes status\`.`,
		);
		console.log(
			`    If chat replies work, ignore this. Otherwise set a key/model (e.g. \`hermes model\`).\n`,
		);
	} else {
		console.log(
			`  ✓ Model ready. Chat + terminal in the UI now hit the real agent.\n`,
		);
	}

	const ch = channelStatus();
	console.log(
		`  channels: telegram ${ch.telegram ? "LIVE" : "staged"} · gmail ${ch.gmail ? "LIVE" : "staged"} · voice ${voiceEnabled() ? "LIVE" : "staged"} · catalog ${catalogEnabled() ? `${catalogSize()} products` : "staged"}`,
	);

	// Real live surface: a judge texts the bot → the crew runs → a real reply goes back.
	if (ch.telegram) {
		tgPoll(async ({ text, chatId, from }) => {
			pushLog("telegram", `↙ ${from}: ${text.slice(0, 60)}`);
			const r = await handleInbound(text, {
				customer: String(chatId),
				channel: "telegram",
			});
			ingestResult(r, { to: String(chatId), channel: "telegram" });
			pushLog(
				"crew",
				`${r.specialist} → ${r.stage} · ${r.verdict?.rule ?? ""} · $${r.totals.costUsd.toFixed(4)}`,
			);
			if (r.stage === "done" && r.draft) {
				await tgSend(chatId, r.draft);
				pushLog("send", `✓ replied to ${from} on telegram`);
			} else {
				await tgSend(
					chatId,
					"Thanks — got your message. I'm checking this against the shop's rules and the owner will confirm shortly.",
				);
			}
		});
		console.log(
			`  ✓ Telegram poller running — text your bot and watch the crew reply.\n`,
		);
	} else {
		console.log(
			`  ℹ Set TELEGRAM_BOT_TOKEN to go live (BotFather → token → export it → restart).\n`,
		);
	}
});
