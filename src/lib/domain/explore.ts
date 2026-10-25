/* Domain — explore slot + propensity logging (research R3, card t_889bc508).

   The structural anti-filter-bubble mechanism: a tiny deterministic explore
   budget (Artifact ran 10–20% ε-greedy; at 35–102 items/edition this is a
   1–3 slot budget) flags items DELIBERATELY OUTSIDE the reader's top lanes,
   and every impression logs its propensity (rubric score + why shown) so a
   future recommender is offline-evaluable at n=1 (Yahoo bandit result:
   counterfactual evaluation works from logged propensities).

   SHADOW-MODE: nothing consumes these flags for ranking yet. The slot
   decision is a PURE function of (candidates, scores, edition_date) — the
   builder is just an adapter calling it; rebuilds of the same edition
   always reproduce the same slots.

   Zero I/O, zero node builtins, zero randomness — the "randomness" is a
   seeded PRNG keyed on the edition date, so shuffles in pool order can
   never change a decision. */

/** Rubric v0 (shadow baseline): one score per section lane. Captured items
 *  are the reader's own deliberate saves (score 1 — never explore targets);
 *  might-like is by definition outside his usual topics (score 0.4). When a
 *  real learned rubric exists this table is replaced by its output — the
 *  Explorer's contract doesn't change. */
export const LANE_SCORES: Record<string, number> = {
  captured: 1.0,
  "rust-os": 0.9,
  "ai-at-work": 0.8,
  "might-like": 0.4,
};

/** The current rubric score for a candidate (defaults low — an unknown lane
 *  is by definition not a top lane). */
export function laneScore(section: string): number {
  return LANE_SCORES[section] ?? 0.4;
}

/** One candidate the explorer may consider: the edition's items with their
 *  current rubric score attached. */
export interface ExploreCandidate {
  item_id: string;
  section: string;
  source: string;
  /** Current rubric score at presentation time (0..1]. */
  score: number;
}

/** Why an item was explore-slotted. */
export type ExploreReason = "low-score" | "unseen-source";

/** One explore decision — rides the item (explore_flag + propensity.why)
 *  and the per-edition decisions file for audit. */
export interface ExplorePick {
  item_id: string;
  reason: ExploreReason;
  /** The rubric score the item was shown under (its logged propensity). */
  propensity: number;
}

/** Explore rate (ε): budget ≈ 2% of the edition, clamped to 1–3 slots —
 *  the research card's "1–3 items/edition" band (a fraction of Artifact's
 *  10–20%, appropriate at n=1 where every slot is personally visible). */
export const EXPLORE_RATE = 0.02;
export const EXPLORE_BUDGET_MIN = 1;
export const EXPLORE_BUDGET_MAX = 3;

/** Scores below this are "outside the top lanes" — eligible explore
 *  territory. With the v0 lane table only might-like (0.4) qualifies. */
export const EXPLORE_SCORE_CEILING = 0.5;

/** A source appearing at most this many times in the whole pool counts as
 *  "unseen" — exploration prefers giving rare sources a slot. */
export const UNSEEN_SOURCE_MAX = 1;

/** The edition's explore budget: ~EXPLORE_RATE of the pool, clamped to
 *  1–3 (an empty pool gets 0 — nothing to explore with). */
export function exploreBudget(poolSize: number): number {
  if (poolSize <= 0) return 0;
  return Math.min(
    EXPLORE_BUDGET_MAX,
    Math.max(EXPLORE_BUDGET_MIN, Math.round(poolSize * EXPLORE_RATE)),
  );
}

/* --- seeded PRNG (FNV-1a → mulberry32): deterministic, order-free -------- */

function fnv1a32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** In-place Fisher–Yates driven by the seeded PRNG (pure input → pure
 *  output overall: callers pass a fresh sorted copy). */
function seededShuffle<T>(items: T[], rand: () => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/**
 * The explore-slot decision (pure): pick 1–3 items from today's pool as
 * explore slots, deterministically seeded by edition_date.
 *
 * Eligibility: deliberately outside the top lanes — score below
 * EXPLORE_SCORE_CEILING and not a captured item (the reader's own saves are
 * not exploration). Preference order: unseen sources first, then the rest
 * of the eligible pool — each group seeded-shuffled. If nothing qualifies
 * (no lane below the ceiling), fall back to the lowest-scored non-captured
 * items so the budget is always spent (an anti-filter-bubble budget that
 * silently spends zero is no budget).
 */
export function selectExplore(candidates: ExploreCandidate[], editionDate: string): ExplorePick[] {
  const budget = exploreBudget(candidates.length);
  if (budget === 0) return [];
  const rand = mulberry32(fnv1a32(editionDate));

  // Order-free: decisions are a function of the pool SET, not its order.
  const pool = [...candidates].sort((a, b) =>
    a.item_id < b.item_id ? -1 : a.item_id > b.item_id ? 1 : 0,
  );
  const sourceCount = new Map<string, number>();
  for (const c of pool) sourceCount.set(c.source, (sourceCount.get(c.source) ?? 0) + 1);

  const eligible = pool.filter((c) => c.section !== "captured" && c.score < EXPLORE_SCORE_CEILING);
  let chosen: Array<{ c: ExploreCandidate; reason: ExploreReason }>;
  if (eligible.length > 0) {
    const unseen = eligible.filter((c) => (sourceCount.get(c.source) ?? 0) <= UNSEEN_SOURCE_MAX);
    const rest = eligible.filter((c) => (sourceCount.get(c.source) ?? 0) > UNSEEN_SOURCE_MAX);
    chosen = [
      ...seededShuffle(unseen, rand).map((c) => ({ c, reason: "unseen-source" as const })),
      ...seededShuffle(rest, rand).map((c) => ({ c, reason: "low-score" as const })),
    ].slice(0, budget);
  } else {
    chosen = pool
      .filter((c) => c.section !== "captured")
      .sort((a, b) => a.score - b.score) // item_id ties broken by the sort above
      .slice(0, budget)
      .map((c) => ({ c, reason: "low-score" as const }));
  }
  return chosen.map(({ c, reason }) => ({ item_id: c.item_id, reason, propensity: c.score }));
}
