import { describe, expect, it } from "vitest";
import {
  assessEditionHealth,
  exposureStats,
  ledgerCounts,
  reinstateCandidate,
  restoreDecision,
} from "./admin.js";
import type { LedgerEvent, StampDeps } from "./feedback.js";

const deps: StampDeps = {
  now: () => "2026-10-26T09:00:00.000Z",
  newId: () => "e-testadmin0",
};

const verdictRow: LedgerEvent = {
  id: "e-abc",
  ts: "2026-10-25T08:00:00.000Z",
  schema_v: 2,
  session_id: "s1",
  item_id: "miniflux-1",
  edition_date: "2026-10-25",
  type: "verdict",
  value: "deep-read",
};
const clickRow: LedgerEvent = {
  id: "e-def",
  ts: "2026-10-25T08:05:00.000Z",
  schema_v: 2,
  session_id: "s1",
  item_id: "miniflux-2",
  edition_date: "2026-10-25",
  type: "click",
  url: "https://example.com/x",
};
/** Impression + dwell rows land via the signal-capture cards; the reducer
 *  must handle them structurally. */
const impressionRow = {
  id: "e-imp1",
  ts: "2026-10-25T07:30:00.000Z",
  schema_v: 2,
  session_id: "s2",
  item_id: "readeck-1",
  edition_date: "2026-10-25",
  type: "impression",
  position: 1,
  section: "captured",
  tier: "lead",
  seen_ms: 4200,
};
const exploreRow = { ...impressionRow, id: "e-imp2", item_id: "readeck-9", explore_flag: true };
const dwellRow = {
  id: "e-dw1",
  ts: "2026-10-25T09:00:00.000Z",
  schema_v: 2,
  session_id: "s1",
  item_id: "miniflux-2",
  edition_date: "2026-10-25",
  type: "dwell",
  url: "https://example.com/x",
  dwell_ms: 45000,
  opened_at: "2026-10-25T08:05:00.000Z",
};

describe("assessEditionHealth", () => {
  it("current: served == newest, no staleness", () => {
    const h = assessEditionHealth({
      servedDate: "2026-10-25",
      availableDates: ["2026-10-24", "2026-10-25"],
      today: "2026-10-25",
    });
    expect(h).toEqual({
      servedDate: "2026-10-25",
      newestDate: "2026-10-25",
      behindNewest: false,
      daysBehindToday: 0,
    });
  });

  it("behind: an unserved newer edition exists", () => {
    const h = assessEditionHealth({
      servedDate: "2026-10-24",
      availableDates: ["2026-10-24", "2026-10-25"],
      today: "2026-10-25",
    });
    expect(h.behindNewest).toBe(true);
  });

  it("stale: newest edition is days behind today", () => {
    const h = assessEditionHealth({
      servedDate: "2026-10-20",
      availableDates: ["2026-10-20"],
      today: "2026-10-25",
    });
    expect(h.behindNewest).toBe(false);
    expect(h.daysBehindToday).toBe(5);
  });

  it("nothing served / nothing on disk", () => {
    expect(
      assessEditionHealth({ servedDate: null, availableDates: [], today: "2026-10-25" }),
    ).toEqual({
      servedDate: null,
      newestDate: null,
      behindNewest: false,
      daysBehindToday: null,
    });
  });
});

describe("restoreDecision", () => {
  const dates = ["2026-10-24", "2026-10-25"];
  it("a date on disk passes", () => {
    expect(restoreDecision("2026-10-24", dates)).toBeNull();
  });
  it("unknown / malformed dates are refused", () => {
    expect(restoreDecision("2026-10-26", dates)).toBe("2026-10-26 is not on disk");
    expect(restoreDecision("not-a-date", dates)).toBe("pick a dated edition (YYYY-MM-DD)");
    expect(restoreDecision(undefined, dates)).toBe("pick a dated edition (YYYY-MM-DD)");
    expect(restoreDecision("../etc", dates)).toBe("pick a dated edition (YYYY-MM-DD)");
  });
});

describe("ledgerCounts", () => {
  it("tallies by type and edition, including unmodelled types", () => {
    const c = ledgerCounts([
      verdictRow,
      clickRow,
      impressionRow,
      {
        ts: "2026-10-24T08:00:00.000Z",
        type: "vote",
        value: "up",
        item_id: "x",
        edition_date: "2026-10-24",
      },
    ] as unknown as LedgerEvent[]);
    expect(c.total).toBe(4);
    expect(c.byType).toEqual({ verdict: 1, click: 1, impression: 1, vote: 1 });
    expect(c.byEdition).toEqual({ "2026-10-25": 3, "2026-10-24": 1 });
  });
});

describe("exposureStats", () => {
  const sectionOf = new Map([
    ["miniflux-1", "captured"],
    ["miniflux-2", "rust-os"],
    ["readeck-9", "might-like"],
  ]);

  it("no impression events → impressions null, CTR null (never a fake denominator)", () => {
    const s = exposureStats([verdictRow, clickRow], sectionOf);
    expect(s.hasImpressionData).toBe(false);
    expect(s.totals).toEqual({ verdict: 1, click: 1 });
    const captured = s.perSection.find((p) => p.section === "captured");
    expect(captured?.impressions).toBeNull();
    expect(captured?.ctr).toBeNull();
    expect(captured?.clicks).toBe(0);
  });

  it("impression events carry their own section; clicks/verdicts map through sectionOf", () => {
    const s = exposureStats([impressionRow, clickRow, verdictRow], sectionOf);
    expect(s.hasImpressionData).toBe(true);
    const captured = s.perSection.find((p) => p.section === "captured");
    expect(captured?.impressions).toBe(1);
    expect(captured?.ctr).toBe(0); // no clicks on captured
    const rust = s.perSection.find((p) => p.section === "rust-os");
    expect(rust?.clicks).toBe(1);
    expect(rust?.impressions).toBeNull(); // no impressions for that section
  });

  it("explore slots are a visible subset (explore_flag impressions + clicks on those items)", () => {
    const exploreClick = {
      ...clickRow,
      id: "e-click9",
      item_id: "readeck-9",
      url: "https://example.com/9",
    };
    const s = exposureStats([impressionRow, exploreRow, exploreClick], sectionOf);
    // the explore impression sits where it was rendered (captured — the
    // event's own section field); the explore click maps via sectionOf to
    // the explore item's slot (might-like)
    const captured = s.perSection.find((p) => p.section === "captured");
    expect(captured?.exploreImpressions).toBe(1);
    const ml = s.perSection.find((p) => p.section === "might-like");
    expect(ml?.exploreClicks).toBe(1);
  });

  it("dwell lands in the right buckets", () => {
    const s = exposureStats(
      [
        { ...dwellRow, dwell_ms: 20000 },
        { ...dwellRow, dwell_ms: 400000 },
      ],
      sectionOf,
    );
    expect(s.dwellBuckets).toEqual({ b0_30s: 1, b30s_2m: 0, b2m_10m: 1, b10m_30m: 0 });
  });

  it("topItems sorts busiest-first and caps at 10", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      ...clickRow,
      id: `e-c${i}`,
      item_id: `item-${i}`,
    }));
    const s = exposureStats([...many, { ...clickRow, item_id: "item-3" }], sectionOf);
    expect(s.topItems[0]).toEqual({ itemId: "item-3", clicks: 2 });
    expect(s.topItems.length).toBe(10);
  });
});

describe("reinstateCandidate", () => {
  it("a public-surface row revalidates to a canonical append", () => {
    const c = reinstateCandidate(verdictRow, deps);
    expect(c).toMatchObject({ type: "verdict", value: "deep-read", id: "e-testadmin0" });
    expect(c?.ts).toBe("2026-10-26T09:00:00.000Z"); // re-stamped: fresh append
  });

  it("sync-path rows (trusted writer) validate through the second union", () => {
    const c = reinstateCandidate(
      {
        type: "read_progress",
        session_id: "sync-readeck",
        item_id: "readeck-1",
        edition_date: "2026-10-25",
        progress_pct: 40,
      },
      deps,
    );
    expect(c).toMatchObject({ type: "read_progress", progress_pct: 40 });
  });

  it("malformed rows return null — discard-only", () => {
    expect(reinstateCandidate({ garbage: true }, deps)).toBeNull();
    expect(reinstateCandidate({ type: "verdict" }, deps)).toBeNull();
    expect(reinstateCandidate("a string", deps)).toBeNull();
    // sync session_id without the sync- prefix is rejected by both unions
    expect(
      reinstateCandidate(
        {
          type: "star",
          session_id: "web",
          item_id: "x",
          edition_date: "2026-10-25",
          starred: true,
        },
        deps,
      ),
    ).toBeNull();
  });
});
