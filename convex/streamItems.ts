import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// Upsert one agent run (insert, or update its stage when approved/declined).
export const upsert = mutation({
  args: { id: v.string(), item: v.string(), draft: v.union(v.string(), v.null()) },
  handler: async (ctx, { id, item, draft }) => {
    const existing = await ctx.db
      .query("streamItems")
      .withIndex("by_itemId", (q) => q.eq("itemId", id))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { item, draft });
    } else {
      await ctx.db.insert("streamItems", { itemId: id, item, draft, createdAt: Date.now() });
    }
  },
});

// Remove one run by its id (used to clear stray/test rows).
export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const row = await ctx.db
      .query("streamItems")
      .withIndex("by_itemId", (q) => q.eq("itemId", id))
      .unique();
    if (row) await ctx.db.delete(row._id);
  },
});

// Recent runs, newest first — hydrates the cockpit's Live Feed on boot.
export const list = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const rows = await ctx.db
      .query("streamItems")
      .withIndex("by_createdAt")
      .order("desc")
      .take(limit ?? 100);
    return rows.map((r) => ({ item: r.item, draft: r.draft }));
  },
});
