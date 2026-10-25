/* Client dwell capture (card t_ea679b5a, research R2).
   Pairs an edition/panel item click with the reader's return: the click
   records an open (epoch timestamp + item) in sessionStorage; the return is
   settled on whichever fires first —
     · the next page load of this app (same-tab back-navigation, and the
       sessionStorage copy a ctrl/target=_blank click hands to the new tab),
     · this tab becoming visible again (visibilitychange — the article was
       read in another tab and this page never reloaded),
     · pagehide (session-end cap: an open older than NAV_GRACE_MS settles at
       leave time; a younger one just navigated out and belongs to its
       return, so it stays pending).
   Settled opens post ONE dwell event each to /api/impressions (the shared
   telemetry append path) when the gap is inside [MIN_DWELL_MS, MAX_DWELL_MS]
   — shorter is mis-click noise, longer is a lost tab; out-of-bounds opens
   are simply dropped, never sent. Direct URL entry starts with empty
   sessionStorage (no origin open) → no event. One pending open per item_id
   (a re-click overwrites with the latest open). Multiple tabs: sessionStorage
   is per-tab, and the browser hands a COPY to a tab opened from the click —
   if the article tab later loads this app it settles its copy too, so one
   click can yield two events (one per tab); shadow-mode analysis dedupes on
   item_id+opened_at.
   SHADOW-MODE: capture only — no rubric, recommender, or builder logic
   consumes dwell yet. */
import { MAX_DWELL_MS, MIN_DWELL_MS } from "./domain/feedback.js";

/** What the action needs to know about the clicked item. */
export interface DwellInfo {
  item_id: string;
  edition_date: string;
  url: string;
  item_url?: string;
  source?: string;
}

/** One recorded open (sessionStorage wire shape). */
interface PendingOpen extends DwellInfo {
  /** Session that made the click (the settle-side event carries its own). */
  session_id: string;
  /** Date.now() at the outbound click — epoch ms survives page loads. */
  t0: number;
  /** ISO-8601 of the outbound click (goes on the event). */
  opened_at: string;
}

const STORE_KEY = "me-dwell-opens";
/** pagehide settles only opens older than this: anything younger is the
 *  out-navigation this very click started — its dwell belongs to the return
 *  (settled at the next load / visibilitychange). */
const NAV_GRACE_MS = 10_000;

function storage(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null; // storage blocked (privacy mode) — no dwell capture
  }
}

function readOpens(): Record<string, PendingOpen> {
  const s = storage();
  if (!s) return {};
  try {
    const raw = s.getItem(STORE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, PendingOpen>;
  } catch {
    return {};
  }
}

function writeOpens(opens: Record<string, PendingOpen>) {
  const s = storage();
  if (!s) return;
  try {
    if (Object.keys(opens).length === 0) s.removeItem(STORE_KEY);
    else s.setItem(STORE_KEY, JSON.stringify(opens));
  } catch {
    // storage full/blocked — dwell tracking must never break reading
  }
}

/** Record the outbound click: `use:`-less, called from the item's onclick
 *  right next to the click-event POST. */
export function dwellOpen(info: DwellInfo) {
  const s = storage();
  if (!s) return;
  const now = Date.now();
  writeOpens({
    ...readOpens(),
    [info.item_id]: {
      ...info,
      session_id: crypto.randomUUID(),
      t0: now,
      opened_at: new Date(now).toISOString(),
    },
  });
}

/** Wire shape of one settled open (envelope id/ts/schema_v are
 *  server-stamped; the server batch validator dispatches on `type`). */
type DwellWire = DwellInfo & {
  type: "dwell";
  session_id: string;
  dwell_ms: number;
  opened_at: string;
};

function send(events: DwellWire[], { beacon }: { beacon: boolean }) {
  if (events.length === 0) return;
  const body = JSON.stringify({ events });
  try {
    if (
      beacon &&
      typeof navigator !== "undefined" &&
      typeof navigator.sendBeacon === "function" &&
      navigator.sendBeacon("/api/impressions", new Blob([body], { type: "application/json" }))
    ) {
      return;
    }
    fetch("/api/impressions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      keepalive: true,
      body,
    }).catch(() => {});
  } catch {
    // dwell tracking must never break reading
  }
}

/** Settle pending opens: compute dwell = now − t0, send the in-bounds ones
 *  (one event per open), and clear the store either way — a stale open is
 *  dropped, never retried. mode "leave" (pagehide) skips opens younger than
 *  NAV_GRACE_MS: they are mid-navigation and settle on return. */
function settle({ mode }: { mode: "return" | "leave" }) {
  const opens = readOpens();
  const ids = Object.keys(opens);
  if (ids.length === 0) return;
  const now = Date.now();
  const events: DwellWire[] = [];
  const remaining: Record<string, PendingOpen> = {};
  for (const id of ids) {
    const open = opens[id];
    const dwellMs = now - open.t0;
    if (mode === "leave" && dwellMs < NAV_GRACE_MS) {
      remaining[id] = open; // just navigated out — the return owns this one
      continue;
    }
    if (dwellMs >= MIN_DWELL_MS && dwellMs <= MAX_DWELL_MS) {
      events.push({
        type: "dwell",
        item_id: open.item_id,
        edition_date: open.edition_date,
        url: open.url,
        item_url: open.item_url,
        source: open.source,
        session_id: crypto.randomUUID(),
        dwell_ms: Math.round(dwellMs),
        opened_at: open.opened_at,
      });
    }
    // out-of-bounds (bounce or lost tab): dropped, never sent
  }
  writeOpens(remaining);
  send(events, { beacon: mode === "leave" });
}

// Browser-only module state — the pages using this are SSR'd.
if (typeof document !== "undefined") {
  // Same-tab back-navigation and the new-tab sessionStorage handoff both
  // land here: a fresh page load settles whatever opens this tab still
  // carries.
  settle({ mode: "return" });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) settle({ mode: "return" });
  });
  window.addEventListener("pagehide", () => settle({ mode: "leave" }));
}
