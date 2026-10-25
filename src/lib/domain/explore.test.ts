import { describe, expect, it } from "vitest";
import {
  exploreBudget,
  EXPLORE_BUDGET_MAX,
  EXPLORE_SCORE_CEILING,
  laneScore,
  LANE_SCORES,
  selectExplore,
  type ExploreCandidate,
} from "./explore.js";

function cand(over: Partial<ExploreCandidate> = {}): ExploreCandidate {
  return {
    item_id: "hn-1",
    section: "might-like",
    source: "hn",
    score: LANE_SCORES["might-like"],
    ...over,
  };
}

const DATE = "2026-10-25";

describe("laneScore (rubric v0 baseline)", () => {
  it("scores the reader's own saves highest, might-like lowest", () => {
    expect(laneScore("captured")).toBeGreaterThan(laneScore("rust-os"));
    expect(laneScore("rust-os")).toBeGreaterThan(laneScore("ai-at-work"));
    expect(laneScore("ai-at-work")).toBeGreaterThan(laneScore("might-like"));
  });

  it("unknown lanes score like might-like (not a top lane)", () => {
    expect(laneScore("somewhere-new")).toBe(LANE_SCORES["might-like"]);
    expect(laneScore("somewhere-new")).toBeLessThan(EXPLORE_SCORE_CEILING);
  });
});

describe("exploreBudget", () => {
  it("is 0 for an empty pool", () => {
    expect(exploreBudget(0)).toBe(0);
  });

  it("stays inside the 1–3 slot band for every pool size", () => {
    for (let n = 1; n <= 500; n++) {
      const b = exploreBudget(n);
      expect(b).toBeGreaterThanOrEqual(1);
      expect(b).toBeLessThanOrEqual(EXPLORE_BUDGET_MAX);
    }
  });

  it("tracks ~EXPLORE_RATE of the pool, clamped", () => {
    expect(exploreBudget(35)).toBe(1); // round(0.7)
    expect(exploreBudget(100)).toBe(2); // round(2.0)
    expect(exploreBudget(500)).toBe(EXPLORE_BUDGET_MAX); // clamp at 3
  });
});

describe("selectExplore — determinism", () => {
  const pool: ExploreCandidate[] = Array.from({ length: 40 }, (_, i) =>
    cand({ item_id: `hn-${i + 1}`, source: i % 3 === 0 ? "HN Weekly" : "hn" }),
  );

  it("same date + pool → same picks across rebuilds", () => {
    expect(selectExplore(pool, DATE)).toEqual(selectExplore(pool, DATE));
  });

  it("pool ORDER never changes the decision (sorted canonical form)", () => {
    const shuffled = [...pool].reverse();
    expect(selectExplore(shuffled, DATE)).toEqual(selectExplore(pool, DATE));
  });

  it("different date → (almost surely) different slots from the same pool", () => {
    const a = selectExplore(pool, "2026-10-25").map((p) => p.item_id);
    const b = selectExplore(pool, "2026-10-26").map((p) => p.item_id);
    expect(a).not.toEqual(b);
  });

  it("never exceeds the budget", () => {
    expect(selectExplore(pool, DATE).length).toBe(exploreBudget(pool.length));
  });
});

describe("selectExplore — eligibility", () => {
  it("only picks items OUTSIDE the top lanes (below the ceiling)", () => {
    const pool = [
      cand({ item_id: "miniflux-1", section: "rust-os", score: LANE_SCORES["rust-os"] }),
      cand({ item_id: "miniflux-2", section: "ai-at-work", score: LANE_SCORES["ai-at-work"] }),
      cand({ item_id: "readeck-1", section: "captured", score: LANE_SCORES.captured }),
      cand({ item_id: "hn-1", section: "might-like" }),
      cand({ item_id: "hn-2", section: "might-like" }),
      cand({ item_id: "hn-3", section: "might-like" }),
    ];
    const ids = selectExplore(pool, DATE).map((p) => p.item_id);
    for (const id of ids) expect(["hn-1", "hn-2", "hn-3"]).toContain(id);
  });

  it("never spends the budget on captured items, even in the fallback", () => {
    const pool = [
      cand({ item_id: "readeck-1", section: "captured", score: LANE_SCORES.captured }),
      cand({ item_id: "miniflux-9", section: "rust-os", score: LANE_SCORES["rust-os"] }),
    ];
    const picks = selectExplore(pool, DATE);
    expect(picks.map((p) => p.item_id)).toEqual(["miniflux-9"]); // lowest-scored non-captured
    expect(picks[0].reason).toBe("low-score");
  });

  it("prefers unseen sources, then falls back to the rest of the pool", () => {
    const pool = [
      cand({ item_id: "hn-1", source: "hn" }),
      cand({ item_id: "hn-2", source: "hn" }),
      cand({ item_id: "rss-1", source: "some-rare-feed" }),
    ];
    const picks = selectExplore(pool, DATE);
    expect(picks.length).toBe(1);
    expect(picks[0].item_id).toBe("rss-1");
    expect(picks[0].reason).toBe("unseen-source");
  });

  it("mixes unseen-source and low-score picks when the budget allows", () => {
    const pool = Array.from({ length: 100 }, (_, i) =>
      cand({
        item_id: `hn-${i + 1}`,
        source: i === 0 ? "rare-feed" : "hn",
        section: "might-like",
      }),
    );
    const picks = selectExplore(pool, DATE);
    expect(picks.length).toBe(2); // round(100 * EXPLORE_RATE)
    expect(picks[0]).toEqual({
      item_id: "hn-1",
      reason: "unseen-source",
      propensity: LANE_SCORES["might-like"],
    });
    expect(picks[1].reason).toBe("low-score");
    // propensity logged = the rubric score the item was shown under
    for (const p of picks) expect(p.propensity).toBe(LANE_SCORES["might-like"]);
  });

  it("returns [] for an empty pool", () => {
    expect(selectExplore([], DATE)).toEqual([]);
  });
});
