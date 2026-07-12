import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Real product state lives in Convex: every agent run the crew produces (the
// cockpit's Live Feed) is stored here, so it survives restarts and is queryable
// from the Convex dashboard.
export default defineSchema({
  streamItems: defineTable({
    itemId: v.string(), // the run id
    item: v.string(), // JSON-serialized StreamItem projection
    draft: v.union(v.string(), v.null()), // JSON-serialized held draft (for approvals)
    createdAt: v.number(),
  })
    .index("by_itemId", ["itemId"])
    .index("by_createdAt", ["createdAt"]),
});
