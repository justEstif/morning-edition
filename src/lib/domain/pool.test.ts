import { describe, expect, it } from "vitest";
import {
  effectiveState,
  isEligible,
  markUsed,
  mergeIntoPool,
  TTL_HOURS,
  type PoolCandidate,
} from "./pool.js";

const HOUR = 3_600_000;

function candidate(over: Partial<PoolCandidate> = {}): PoolCandidate {
  return {
    candidate_id: "hn-1",
    source: "hn",
    url: "https://example.com/1",
    title: "T",
    fetched_at: "2026-10-25T06:00:00.000Z",
    last_fetched_at: "2026-10-25T06:00:00.000Z",
    state: "fresh",
    times_presented: 0,
    last_presented: null,
    ...over,
  };
}

describe("effectiveState — aging policy", () => {
  it("fresh inside 24h", () => {
    expect(effectiveState(candidate(), Date.parse(candidate().fetched_at) + 2 * HOUR)).toBe(
      "fresh",
    );
  });

  it("aged after 24h but inside TTL", () => {
    expect(effectiveState(candidate(), Date.parse(candidate().fetched_at) + 30 * HOUR)).toBe(
      "aged",
    );
  });

  it("expired past the per-source TTL", () => {
    const hn = candidate();
    expect(effectiveState(hn, Date.parse(hn.fetched_at) + (TTL_HOURS.hn + 1) * HOUR)).toBe(
      "expired",
    );
    // readeck saves live 14 days
    const rd = candidate({ source: "readeck", candidate_id: "readeck-1" });
    const pastHnTtl = Date.parse(rd.fetched_at) + (TTL_HOURS.hn + 1) * HOUR;
    expect(effectiveState(rd, pastHnTtl)).toBe("aged");
  });

  it("used is sticky regardless of age", () => {
    const c = candidate({ state: "used" });
    expect(effectiveState(c, Date.parse(c.fetched_at) + 1000 * HOUR)).toBe("used");
  });

  it("unparseable fetched_at is expired (never eligible on bad data)", () => {
    expect(effectiveState(candidate({ fetched_at: "nope" }), Date.now())).toBe("expired");
  });
});

describe("isEligible", () => {
  it("fresh and aged eligible; used and expired not", () => {
    const base = Date.parse(candidate().fetched_at);
    expect(isEligible(candidate(), base + HOUR)).toBe(true);
    expect(isEligible(candidate(), base + 30 * HOUR)).toBe(true);
    expect(isEligible(candidate({ state: "used" }), base + HOUR)).toBe(false);
    expect(isEligible(candidate(), base + (TTL_HOURS.hn + 2) * HOUR)).toBe(false);
  });
});

describe("mergeIntoPool — idempotent by candidate_id", () => {
  it("first sight wins for fetched_at; refetch refreshes last_fetched_at only", () => {
    const pool = mergeIntoPool(
      [],
      [
        {
          candidate_id: "hn-1",
          source: "hn",
          url: "https://example.com/1",
          title: "T",
          fetched_at: "2026-10-24T06:00:00.000Z",
          last_fetched_at: "2026-10-24T06:00:00.000Z",
        },
      ],
    );
    const again = mergeIntoPool(pool, [
      {
        candidate_id: "hn-1",
        source: "hn",
        url: "https://example.com/1",
        title: "T (edited)",
        fetched_at: "2026-10-25T06:00:00.000Z",
        last_fetched_at: "2026-10-25T06:00:00.000Z",
      },
    ]);
    expect(again).toHaveLength(1);
    expect(again[0].fetched_at).toBe("2026-10-24T06:00:00.000Z");
    expect(again[0].last_fetched_at).toBe("2026-10-25T06:00:00.000Z");
    expect(again[0].title).toBe("T"); // first sight wins
    expect(again[0].state).toBe("fresh");
  });

  it("keeps used rows used across refetches (registry memory)", () => {
    const used = candidate({ state: "used", times_presented: 1, last_presented: "2026-10-24" });
    const again = mergeIntoPool(
      [used],
      [
        {
          candidate_id: used.candidate_id,
          source: used.source,
          url: used.url,
          title: used.title,
          fetched_at: used.fetched_at,
          last_fetched_at: "2026-10-25T06:00:00.000Z",
        },
      ],
    );
    expect(again[0].state).toBe("used");
    expect(again[0].times_presented).toBe(1);
  });
});

describe("markUsed", () => {
  it("stamps state, count and edition date", () => {
    const rows = [candidate(), candidate({ candidate_id: "hn-2" })];
    markUsed(rows, "2026-10-25");
    expect(rows.every((r) => r.state === "used")).toBe(true);
    expect(rows[1].times_presented).toBe(1);
    expect(rows[1].last_presented).toBe("2026-10-25");
  });
});
