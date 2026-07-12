// Convex store — the crew's live product state (agent runs) in Convex.
//
// When CONVEX_URL is set, every stream item is written to Convex and the feed
// hydrates from it on boot. Convex is the real backend of record for product
// state; SQLite remains a local fallback when Convex isn't configured.
//
// Set up: `npx convex dev` (authenticates + deploys convex/), which writes
// CONVEX_URL into .env.local. Copy it into server/.env for the adapter.

import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";

const URL = process.env.CONVEX_URL || "";
export const convexEnabled = () => Boolean(URL);

const client = URL ? new ConvexHttpClient(URL) : null;

export async function cxUpsert(item, draft) {
  if (!client) return;
  await client.mutation(anyApi.streamItems.upsert, {
    id: item.id,
    item: JSON.stringify(item),
    draft: draft ? JSON.stringify(draft) : null,
  });
}

export async function cxList(limit = 100) {
  if (!client) return [];
  const rows = await client.query(anyApi.streamItems.list, { limit });
  return rows.map((r) => ({ item: JSON.parse(r.item), draft: r.draft ? JSON.parse(r.draft) : null }));
}
