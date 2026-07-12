// Product catalog — a live pull from the store's real Shopify product export.
//
// The Admin API token was blocked by the store's Dev-Dashboard migration, so
// instead of hallucinating, the crew answers product questions from the real
// exported catalog (server/catalog.csv). When a customer asks "do you have a
// navy jacket for men?", the manager flags it, we search the catalog, and the
// specialist replies with real titles, prices, and options.

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const CSV = process.env.CATALOG_CSV || join(dirname(fileURLToPath(import.meta.url)), "catalog.csv");

// Minimal RFC-4180 CSV parser (handles quoted fields with commas/newlines/"").
function parseCSV(text) {
  const rows = [];
  let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const strip = (s) => (s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

let _products = null;
function load() {
  if (_products) return _products;
  if (!existsSync(CSV)) { _products = []; return _products; }
  const rows = parseCSV(readFileSync(CSV, "utf8"));
  const head = rows[0];
  const col = (name) => head.indexOf(name);
  const iTitle = col("Title"), iVendor = col("Vendor"), iType = col("Type"),
    iTags = col("Tags"), iPrice = col("Variant Price"), iBody = col("Body (HTML)"),
    iStatus = col("Status"), iCompare = col("Variant Compare At Price");
  const seen = new Set();
  _products = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const title = row[iTitle]?.trim();
    if (!title || seen.has(title)) continue; // one row per product (skip extra image rows)
    if (iStatus >= 0 && row[iStatus]?.trim() && row[iStatus].trim() !== "active") continue;
    seen.add(title);
    _products.push({
      title,
      vendor: row[iVendor]?.trim() || "",
      type: row[iType]?.trim() || "",
      tags: row[iTags]?.trim() || "",
      price: row[iPrice]?.trim() || "",
      compareAt: iCompare >= 0 ? row[iCompare]?.trim() || "" : "",
      desc: strip(row[iBody]).slice(0, 160),
    });
  }
  return _products;
}

export const catalogEnabled = () => load().length > 0;
export const catalogSize = () => load().length;

// Aggregate stats for the owner-facing chat ("how many products, categorise them").
export function catalogStats() {
  const p = load();
  const byAudience = {}, byType = {}, byVendor = {};
  let min = Infinity, max = 0;
  const bump = (o, k) => { if (k) o[k] = (o[k] || 0) + 1; };
  for (const x of p) {
    const tags = x.tags.toLowerCase();
    const aud = /women/.test(tags) ? "Women" : /\bmen\b/.test(tags) ? "Men" : /girls/.test(tags) ? "Girls" : /boys/.test(tags) ? "Boys" : /unisex/.test(tags) ? "Unisex" : "Other";
    bump(byAudience, aud);
    bump(byType, x.type || "Other");
    bump(byVendor, x.vendor || "Other");
    const pr = parseFloat(x.price);
    if (!isNaN(pr)) { min = Math.min(min, pr); max = Math.max(max, pr); }
  }
  return { count: p.length, byAudience, byType, byVendor, min: isFinite(min) ? min : 0, max };
}

// Keyword search over title/tags/type/vendor/desc. Returns a compact summary.
export function searchCatalog(query, limit = 6) {
  const products = load();
  if (!products.length) return { found: false, summary: "Catalog is empty.", items: [] };
  const tokens = String(query || "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  const scored = products.map((p) => {
    const title = p.title.toLowerCase();
    const hay = `${title} ${p.tags} ${p.type} ${p.vendor} ${p.desc}`.toLowerCase();
    let score = 0;
    for (const t of tokens) { if (title.includes(t)) score += 3; else if (hay.includes(t)) score += 1; }
    return { p, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);

  const items = (scored.length ? scored.map((x) => x.p) : products.slice(0, 3));
  const summary = items
    .map((p) => `• ${p.title} — ₹${p.price}${p.tags ? ` [${p.tags}]` : ""}`)
    .join("\n");
  return { found: scored.length > 0, summary, items };
}
