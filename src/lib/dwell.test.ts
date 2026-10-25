/* Client dwell capture behavior (card t_ea679b5a) — runs the REAL
   src/lib/dwell.ts in a node-env harness with stubbed browser globals:
   sessionStorage handoff, visibilitychange/pagehide settling, and the
   MIN/MAX dwell bounds, all against mock fetch/sendBeacon. */
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { MAX_DWELL_MS, MIN_DWELL_MS } from "./domain/feedback.js";

type Handler = () => void;

const ITEM = {
  item_id: "readeck-1",
  edition_date: "2026-10-25",
  url: "https://example.com/a",
  item_url: "https://example.com/a",
  source: "readeck",
};

function stubBrowser() {
  const docHandlers: Record<string, Handler> = {};
  const winHandlers: Record<string, Handler> = {};
  const store = new Map<string, string>();
  const fetchMock: Mock = vi.fn(() => Promise.resolve());
  const beaconMock: Mock = vi.fn((_url: unknown, _blob: unknown) => true);
  let uuid = 0;
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("navigator", { sendBeacon: beaconMock });
  vi.stubGlobal("crypto", { randomUUID: () => `uuid-${++uuid}` });
  vi.stubGlobal("document", {
    hidden: false,
    addEventListener: (t: string, h: Handler) => {
      docHandlers[t] = h;
    },
  });
  vi.stubGlobal("window", {
    addEventListener: (t: string, h: Handler) => {
      winHandlers[t] = h;
    },
  });
  return { docHandlers, winHandlers, store, fetchMock, beaconMock };
}

async function load() {
  vi.resetModules();
  return await import("./dwell.js");
}

/** Seed a pending open aged ageMs, as a previous page load would have left it. */
function seedOpen(store: Map<string, string>, itemId: string, ageMs: number) {
  const t0 = Date.now() - ageMs;
  store.set(
    "me-dwell-opens",
    JSON.stringify({
      [itemId]: {
        ...ITEM,
        item_id: itemId,
        session_id: "clicker-session",
        t0,
        opened_at: new Date(t0).toISOString(),
      },
    }),
  );
}

function postedBody(mock: Mock, call: number): { events: Array<Record<string, unknown>> } {
  return JSON.parse((mock.mock.calls[call]?.[1]?.body ?? "{}") as string);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("dwell capture — open recording", () => {
  it("records the open on click and sends nothing yet", async () => {
    const b = stubBrowser();
    const dwell = await load();
    dwell.dwellOpen(ITEM);
    expect(b.fetchMock).not.toHaveBeenCalled();
    expect(b.beaconMock).not.toHaveBeenCalled();
    const opens = JSON.parse(b.store.get("me-dwell-opens") as string);
    expect(opens["readeck-1"].item_id).toBe("readeck-1");
    expect(typeof opens["readeck-1"].t0).toBe("number");
    expect(new Date(opens["readeck-1"].opened_at).toISOString()).toBe(opens["readeck-1"].opened_at);
  });
});

describe("dwell capture — settle on return", () => {
  it("sends exactly one dwell event on visibilitychange → visible", async () => {
    const b = stubBrowser();
    const dwell = await load();
    dwell.dwellOpen(ITEM);
    seedOpen(b.store, "readeck-1", 45_000); // age the open like a real read
    b.docHandlers.visibilitychange();
    expect(b.fetchMock).toHaveBeenCalledTimes(1);
    const body = postedBody(b.fetchMock, 0);
    expect(body.events).toHaveLength(1);
    const ev = body.events[0];
    expect(ev.type).toBe("dwell");
    expect(ev.item_id).toBe("readeck-1");
    expect(ev.dwell_ms).toBeGreaterThanOrEqual(MIN_DWELL_MS);
    expect(ev.dwell_ms).toBeLessThanOrEqual(MAX_DWELL_MS);
    expect(ev.opened_at).toBeTruthy();
    expect(b.store.has("me-dwell-opens")).toBe(false); // consumed once
  });

  it("drops sub-floor bounces silently (< MIN_DWELL_MS, never sent)", async () => {
    const b = stubBrowser();
    const dwell = await load();
    dwell.dwellOpen(ITEM);
    seedOpen(b.store, "readeck-1", MIN_DWELL_MS - 500);
    b.docHandlers.visibilitychange();
    expect(b.fetchMock).not.toHaveBeenCalled();
    expect(b.beaconMock).not.toHaveBeenCalled();
    expect(b.store.has("me-dwell-opens")).toBe(false);
  });

  it("drops lost-tab gaps over the cap (> MAX_DWELL_MS, never sent)", async () => {
    const b = stubBrowser();
    const dwell = await load();
    dwell.dwellOpen(ITEM);
    seedOpen(b.store, "readeck-1", MAX_DWELL_MS + 60_000);
    b.docHandlers.visibilitychange();
    expect(b.fetchMock).not.toHaveBeenCalled();
    expect(b.store.has("me-dwell-opens")).toBe(false);
  });

  it("settles opens left by a previous load at module init (full-navigation handoff)", async () => {
    const b = stubBrowser();
    seedOpen(b.store, "readeck-1", 30_000);
    await load();
    expect(b.fetchMock).toHaveBeenCalledTimes(1);
    expect(postedBody(b.fetchMock, 0).events[0].type).toBe("dwell");
    expect(b.store.has("me-dwell-opens")).toBe(false);
  });

  it("is a no-op on return with no pending opens (direct entry, no clicks)", async () => {
    stubBrowser();
    await load();
    // module-init settle ran against an empty store — nothing posted
  });
});

describe("dwell capture — pagehide (session end)", () => {
  it("keeps a just-clicked open pending: it belongs to its return", async () => {
    const b = stubBrowser();
    const dwell = await load();
    dwell.dwellOpen(ITEM); // age ~0 — the out-navigation this click started
    b.winHandlers.pagehide();
    expect(b.fetchMock).not.toHaveBeenCalled();
    expect(b.beaconMock).not.toHaveBeenCalled();
    expect(b.store.has("me-dwell-opens")).toBe(true);
    seedOpen(b.store, "readeck-1", 20_000); // the reader comes back
    b.docHandlers.visibilitychange();
    expect(b.fetchMock).toHaveBeenCalledTimes(1);
  });

  it("settles an old open via sendBeacon at leave (session-end cap)", async () => {
    const b = stubBrowser();
    const dwell = await load();
    dwell.dwellOpen(ITEM);
    seedOpen(b.store, "readeck-1", 60_000); // the reader never came back
    b.winHandlers.pagehide();
    expect(b.beaconMock).toHaveBeenCalledTimes(1);
    const blob = b.beaconMock.mock.calls[0][1] as Blob;
    const body = JSON.parse(await blob.text());
    expect(body.events[0].type).toBe("dwell");
    expect(body.events[0].dwell_ms).toBeGreaterThanOrEqual(MIN_DWELL_MS);
    expect(b.store.has("me-dwell-opens")).toBe(false);
  });
});
