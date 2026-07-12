import { useCallback, useEffect, useRef, useState } from "react";
import type { StreamItem } from "./brainLayer";

export type NotifState = "granted" | "denied" | "unrequested" | "unsupported";

interface UseNotificationsResult {
  state: NotifState;
  requestPermission: () => void;
}

/**
 * Fires a desktop browser Notification whenever a *new* stream item enters the
 * "awaiting" stage. Only fires once per item — if an item is approved/declined
 * (leaves awaiting) and later re-enters it can notify again.
 *
 * Permission is not auto-requested on mount. Call `requestPermission()` on user
 * gesture (clicking the bell button) to trigger the browser's permission prompt.
 */
export function useNotifications(
  stream: StreamItem[],
  bizName: string
): UseNotificationsResult {
  const [state, setState] = useState<NotifState>(() => {
    if (!("Notification" in window)) return "unsupported";
    if (Notification.permission === "granted") return "granted";
    if (Notification.permission === "denied") return "denied";
    return "unrequested";
  });

  // IDs of awaiting items we've already notified about this session.
  const notifiedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (state !== "granted") return;

    const awaiting = stream.filter((s) => s.stage === "awaiting");
    const already = notifiedRef.current;

    for (const item of awaiting) {
      if (already.has(item.id)) continue;
      already.add(item.id);

      const title = item.customer
        ? `${item.customer} · needs your OK`
        : "Action needed";

      const body =
        item.title.length > 100
          ? item.title.slice(0, 97) + "…"
          : item.title;

      try {
        const n = new Notification(`${bizName || "Hermes SME"} — ${title}`, {
          body,
          tag: `hermes-await-${item.id}`,
          silent: false,
        });
        n.onclick = () => {
          window.focus();
          n.close();
        };
      } catch {
        /* Notification may throw in sandboxed iframes or headless mode */
      }
    }

    // Clean up: remove IDs for items that are no longer awaiting (were
    // approved/declined). If they re-enter awaiting we'll re-notify.
    const currentIds = new Set(awaiting.map((s) => s.id));
    for (const id of already) {
      if (!currentIds.has(id)) already.delete(id);
    }
  }, [stream, state, bizName]);

  const requestPermission = useCallback(() => {
    if (!("Notification" in window)) return;
    if (Notification.permission !== "default") return;
    Notification.requestPermission().then((perm) => {
      setState(perm === "granted" ? "granted" : "denied");
    });
  }, []);

  return { state, requestPermission };
}
