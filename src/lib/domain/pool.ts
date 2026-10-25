/* Domain — candidate pool (research R7, cards t_57a6a03b + t_48954836 build
   the adapters; this file is the schema + aging policy they share).

   The pool decouples fetch cadence from build cadence: fetching is cheap and
   can run continuously; the 7am LLM build stays the only expensive step.
   Every fetched candidate lands here (idempotent by candidate identity) and
   stays eligible across builds until its TTL expires — good candidates stop
   evaporating just because they arrived at the wrong hour.

   Zero I/O, zero node builtins — aging is a pure function of (candidate,
   nowMs); the adapter owns the file/DB and the clock. */

/** Which source produced the candidate. Same vocabulary as the ledger's
 *  `source` envelope field. */
export type PoolSource = "miniflux" | "readeck" | "hn";

/** Lifecycle state. `fresh` = recently fetched; `aged` = within TTL but past
 *  a day (build may down-rank, never drop); `expired` = past TTL, forced
 *  drop/derived-skip territory; `used` = already ran in an edition (kept for
 *  the story registry's cross-day memory — never re-presented). */
export type PoolState = "fresh" | "aged" | "expired" | "used";

/** One row of the persistent candidate pool (candidates.json on the data
 *  volume). Identity is `candidate_id` = "<src>-<source-native-id>" — the
 *  same id space edition items use (miniflux-1200, readeck-abc…), so pool
 *  rows, edition items and ledger events join by id with no URL fuzz. */
export interface PoolCandidate {
  candidate_id: string;
  source: PoolSource;
  url: string;
  title: string;
  /** First time this candidate was ever seen (ISO-8601) — idempotent
   *  refetches keep the original. */
  fetched_at: string;
  /** Most recent fetch that still saw it (ISO-8601) — distinguishes "still
   *  unread/saved upstream" from "gone upstream but still in TTL". */
  last_fetched_at: string;
  /** Last-known state; recompute with effectiveState before use (time
   *  moves on between writes). */
  state: PoolState;
  /** How many editions presented it (builder-maintained). */
  times_presented: number;
  /** Edition date that last used it, null if never. */
  last_presented: string | null;
}

/** Per-source TTL, in hours (domain constant table — not magic; research
 *  R7: hard TTL 3–4 days for news-ish items, longer for deliberate saves). */
export const TTL_HOURS: Record<PoolSource, number> = {
  hn: 96, // news-ish: 4 days
  miniflux: 96, // feed items: same news horizon
  readeck: 336, // deliberate saves: essays/long reads, 14 days
};

/** A candidate counts as "aged" (down-rankable, still eligible) after this
 *  many hours, even inside its TTL. */
export const AGE_THRESHOLD_HOURS = 24;

function elapsedHours(c: PoolCandidate, nowMs: number): number {
  const fetched = Date.parse(c.fetched_at);
  if (Number.isNaN(fetched)) return Number.POSITIVE_INFINITY;
  return (nowMs - fetched) / 3_600_000;
}

/** The state that matters right now: `used` is sticky (registry memory);
 *  everything else is recomputed from fetched_at against the source TTL —
 *  the stored `state` is only a cache of the last write. */
export function effectiveState(c: PoolCandidate, nowMs: number): PoolState {
  if (c.state === "used") return "used";
  const hours = elapsedHours(c, nowMs);
  if (hours > TTL_HOURS[c.source]) return "expired";
  if (hours > AGE_THRESHOLD_HOURS) return "aged";
  return "fresh";
}

/** Is this candidate eligible for TODAY'S build? used → never; expired →
 *  never (the builder records a derived skip elsewhere); fresh/aged → yes. */
export function isEligible(c: PoolCandidate, nowMs: number): boolean {
  const s = effectiveState(c, nowMs);
  return s === "fresh" || s === "aged";
}

/** Fold fetched candidates into the pool (pure merge — the adapter writes
 *  the result). Idempotent by candidate_id: first sight wins for
 *  fetched_at/url/title; every refetch refreshes last_fetched_at. */
export function mergeIntoPool(
  pool: PoolCandidate[],
  incoming: Array<Omit<PoolCandidate, "state" | "times_presented" | "last_presented">>,
): PoolCandidate[] {
  const byId = new Map(pool.map((c) => [c.candidate_id, c]));
  for (const n of incoming) {
    const existing = byId.get(n.candidate_id);
    if (existing) {
      existing.last_fetched_at = n.last_fetched_at;
    } else {
      byId.set(n.candidate_id, {
        ...n,
        state: "fresh",
        times_presented: 0,
        last_presented: null,
      });
    }
  }
  return [...byId.values()];
}

/** Mark the candidates an edition consumed (builder-side, after the edition
 *  is accepted). Mutates the given rows like the pool write it precedes. */
export function markUsed(candidates: PoolCandidate[], editionDate: string): void {
  for (const c of candidates) {
    c.state = "used";
    c.times_presented += 1;
    c.last_presented = editionDate;
  }
}
