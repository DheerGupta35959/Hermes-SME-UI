// Cloudflare Pages Function — waitlist capture backed by D1 (SQLite).
// POST /api/waitlist { email } → stores the email. GET /api/waitlist → { count }.
// Mentors can verify signups live: `wrangler d1 execute alera-waitlist --command "SELECT * FROM waitlist"`.

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  let body = {};
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid body" }, 400);
  }
  const email = String(body.email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "valid email required" }, 400);

  const ref = request.headers.get("referer") || null;
  try {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO waitlist (email, referrer, created_at) VALUES (?, ?, ?)"
    )
      .bind(email, ref, new Date().toISOString())
      .run();
    return json({ ok: true });
  } catch (e) {
    return json({ error: "store failed", detail: String(e).slice(0, 120) }, 500);
  }
}

export async function onRequestGet(context) {
  const { env } = context;
  try {
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM waitlist").first();
    return json({ count: row?.n ?? 0 });
  } catch {
    return json({ count: 0 });
  }
}
