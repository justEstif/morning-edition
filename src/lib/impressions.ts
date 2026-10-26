/* Client impression capture (card t_41df1f78, research R1).
   A Svelte action per edition/panel item wires an IntersectionObserver
   (threshold = the domain's EXPOSURE_RATIO, no scroll handlers — zero
   observer churn while scrolling, zero layout shift). An exposure qualifies
   only at ≥EXPOSURE_RATIO intersection held ≥EXPOSURE_MIN_MS (both live in
   the domain so client + server share one definition). Qualified exposures
   batch up and flush: debounced while reading, then via
   navigator.sendBeacon on visibilitychange/pagehide (fallback fetch
   keepalive) and on SvelteKit client-side navigation (action destroy).
   One impression per item+session+edition — the dedupe set lives here. */
import { EXPOSURE_MIN_MS, EXPOSURE_RATIO } from "./domain/feedback.js";

/** What the action needs to know about the item it watches. */
export interface ImpressionInfo {
  item_id: string;
  edition_date: string;
  section: string;
  tier: string;
  /** 1-based within the section as rendered. */
  position: number;
  item_url?: string;
  source?: string;
  explore_flag?: boolean;
  propensity?: { score: number; why?: string };
}

/** One queued wire event (session_id + server-side envelope come at flush
 *  time / on the server, per the v2 envelope contract). */
type QueuedImpression = ImpressionInfo & { session_id: string; seen_ms: number };

const sessionId = crypto.randomUUID();
/** item_ids already qualified this session+edition — dedupe repeat
 *  impressions (rapid scroll in/out never re-fires an item). */
const qualified = new Set<string>();
const pending: QueuedImpression[] = [];
const watching = new Map<Element, { info: ImpressionInfo; since: number | null }>();
const deferred: Array<{ node: HTMLElement; info: ImpressionInfo }> = [];
let observer: IntersectionObserver | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let pageListenersBound = false;

const FLUSH_DEBOUNCE_MS = 4000;
const FLUSH_MAX_BATCH = 25;

/** No observers in tiny viewports (below the smallest phone) — the card's
 *  a11y/perf floor; 640px and up tracks normally. */
function viewportTooSmall(): boolean {
  return window.innerWidth < 320 || window.innerHeight < 240;
}

function ensureObserver(): IntersectionObserver | null {
  if (observer) return observer;
  if (viewportTooSmall()) return null;
  observer = new IntersectionObserver(onIntersect, { threshold: [EXPOSURE_RATIO] });
  if (!pageListenersBound) {
    pageListenersBound = true;
    // Tab hidden: finalize exposures currently on screen, then beacon out.
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        finalizeVisible();
        flush({ beacon: true });
      }
    });
    window.addEventListener("pagehide", () => flush({ beacon: true }));
  }
  return observer;
}

function onIntersect(entries: IntersectionObserverEntry[]) {
  const now = performance.now();
  for (const entry of entries) {
    const w = watching.get(entry.target);
    if (!w) continue;
    if (entry.isIntersecting && entry.intersectionRatio >= EXPOSURE_RATIO) {
      if (w.since === null) w.since = now;
    } else if (w.since !== null) {
      qualify(w, now - w.since);
      w.since = null;
      observer?.unobserve(entry.target);
      watching.delete(entry.target);
    }
  }
}

/** Close out an exposure: ≥threshold held ≥min → queue one impression. */
function qualify(w: { info: ImpressionInfo; since: number | null }, seenMs: number) {
  if (seenMs < EXPOSURE_MIN_MS || qualified.has(w.info.item_id)) return;
  qualified.add(w.info.item_id);
  pending.push({ ...w.info, session_id: sessionId, seen_ms: Math.round(seenMs) });
  if (pending.length >= FLUSH_MAX_BATCH) flush();
  else if (!flushTimer) flushTimer = setTimeout(() => flush(), FLUSH_DEBOUNCE_MS);
}

/** Exposures still on screen when the page goes away count too. */
function finalizeVisible() {
  const now = performance.now();
  for (const [el, w] of watching) {
    if (w.since !== null) {
      qualify(w, now - w.since);
      w.since = null;
      observer?.unobserve(el);
      watching.delete(el);
    }
  }
}

function flush({ beacon = false }: { beacon?: boolean } = {}) {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (pending.length === 0) return;
  const events = pending.splice(0, pending.length);
  const body = JSON.stringify({ events });
  try {
    if (
      beacon &&
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
    // impression tracking must never break reading
  }
}

/** Svelte action: `use:impression={info}` on any edition/panel item element.
 *  `info = null` opts the element out entirely — the public reader pages
 *  pass null for anonymous visitors (reading is public, writes are
 *  owner-only, card t_43e48cd0) so an anonymous read never tracks.
 *  Exposed exposures are finalized and flushed on destroy so SvelteKit
 *  client-side navigation doesn't drop them. */
export function impression(node: HTMLElement, info: ImpressionInfo | null) {
  if (!info) return {}; // anonymous: no exposure, no observer, no writes
  if (qualified.has(info.item_id)) return {}; // already counted this session
  if (viewportTooSmall()) return {}; // tiny viewport: no tracking at all

  if (document.hidden) {
    // Tab hidden at mount: no observer while hidden — watch once it becomes
    // visible. If it never does, nothing qualifies and nothing is sent.
    deferred.push({ node, info });
    return {
      destroy() {
        const i = deferred.findIndex((d) => d.node === node);
        if (i !== -1) deferred.splice(i, 1);
      },
    };
  }

  const obs = ensureObserver();
  if (obs) {
    watching.set(node, { info, since: null });
    obs.observe(node);
  }
  return {
    destroy() {
      const w = watching.get(node);
      if (w) {
        if (w.since !== null) {
          qualify(w, performance.now() - w.since);
          // Client-side nav has no pagehide — flush synchronously via fetch
          // keepalive (the beacon path only exists for pagehide).
          flush();
        }
        observer?.unobserve(node);
        watching.delete(node);
      }
    },
  };
}

// Hidden-at-mount items start tracking when the tab first becomes visible.
// Browser-only module state — the pages using this action are SSR'd.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && deferred.length > 0) {
      const obs = ensureObserver();
      if (!obs) {
        deferred.length = 0;
        return;
      }
      for (const { node, info } of deferred.splice(0, deferred.length)) {
        watching.set(node, { info, since: null });
        obs.observe(node);
      }
    }
  });
}
