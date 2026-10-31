import { describe, expect, it } from "vitest";
import {
  applyChannelDailyCap,
  effectiveState,
  isEligible,
  markUsed,
  mergeIntoPool,
  TTL_HOURS,
  YT_PER_CHANNEL_DAILY_CAP,
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
    // X posts (t_85621775) age out at 72h — inside hn's TTL, past their own
    const xp = candidate({ source: "x", candidate_id: "x-1" });
    const pastXttl = Date.parse(xp.fetched_at) + (TTL_HOURS.x + 1) * HOUR;
    expect(effectiveState(xp, pastXttl)).toBe("expired");
    expect(effectiveState(xp, Date.parse(xp.fetched_at) + (TTL_HOURS.x - 1) * HOUR)).toBe("aged");
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

describe("applyChannelDailyCap — per-channel per-day pool cap (t_9d9fffeb)", () => {
  function yt(id: string, over: Partial<Parameters<typeof applyChannelDailyCap>[0][number]> = {}) {
    return {
      candidate_id: `youtube-${id}`,
      source: "youtube" as const,
      fetched_at: "2026-10-31T22:00:00.000Z",
      channel: "UC-channel",
      published: "2026-10-30T00:00:00Z",
      ...over,
    };
  }

  it("caps rows fetched today per channel, keeping the newest uploads", () => {
    const rows = [
      yt("a", { published: "2026-10-28T00:00:00Z" }),
      yt("b", { published: "2026-10-30T00:00:00Z" }),
      yt("c", { published: "2026-10-29T00:00:00Z" }),
      yt("d", { published: "2026-10-27T00:00:00Z" }),
      yt("e", { published: "2026-10-26T00:00:00Z" }),
    ];
    const { kept, dropped } = applyChannelDailyCap(rows, "2026-10-31T22:05:00.000Z");
    expect(kept.map((r) => r.candidate_id)).toEqual(["youtube-b", "youtube-c", "youtube-a"]);
    expect(dropped).toEqual([
      { candidate_id: "youtube-d", channel: "UC-channel" },
      { candidate_id: "youtube-e", channel: "UC-channel" },
    ]);
  });

  it("groups by channel — one prolific channel never starves another", () => {
    const rows = [
      yt("a1", { channel: "UC-prolific" }),
      yt("a2", { channel: "UC-prolific" }),
      yt("a3", { channel: "UC-prolific" }),
      yt("a4", { channel: "UC-prolific" }),
      yt("b1", { channel: "UC-quiet" }),
    ];
    const { kept, dropped } = applyChannelDailyCap(rows, "2026-10-31T22:05:00.000Z");
    const keptIds = kept.map((r) => r.candidate_id);
    expect(keptIds).toContain("youtube-b1"); // the quiet channel keeps its slot
    expect(keptIds.filter((id) => id.startsWith("youtube-a"))).toHaveLength(
      YT_PER_CHANNEL_DAILY_CAP,
    );
    expect(dropped.map((d) => d.candidate_id)).toEqual(["youtube-a4"]);
  });

  it("only constrains rows fetched TODAY — carried-over rows pass untouched", () => {
    const rows = [
      yt("old1", { fetched_at: "2026-10-29T22:00:00.000Z" }),
      yt("old2", { fetched_at: "2026-10-29T22:00:00.000Z" }),
      yt("old3", { fetched_at: "2026-10-29T22:00:00.000Z" }),
      yt("old4", { fetched_at: "2026-10-29T22:00:00.000Z" }),
    ];
    const { kept, dropped } = applyChannelDailyCap(rows, "2026-10-31T22:05:00.000Z");
    expect(kept).toHaveLength(4);
    expect(dropped).toEqual([]);
  });

  it("never touches non-youtube rows, even from another channel key", () => {
    const rows = [
      yt("h1", { source: "hn" as const, channel: "hn" }),
      yt("m1", { source: "miniflux" as const, channel: "TLDR" }),
      yt("r1", { source: "readeck" as const, channel: "someblog" }),
    ];
    const { kept, dropped } = applyChannelDailyCap(rows, "2026-10-31T22:05:00.000Z");
    expect(kept).toHaveLength(3);
    expect(dropped).toEqual([]);
  });

  it("is deterministic on ties (stable id tiebreak)", () => {
    const rows = [
      yt("dup2", { published: "2026-10-30T00:00:00Z" }),
      yt("dup1", { published: "2026-10-30T00:00:00Z" }),
      yt("dup3", { published: "2026-10-30T00:00:00Z" }),
    ];
    const first = applyChannelDailyCap(rows, "2026-10-31T22:05:00.000Z");
    const second = applyChannelDailyCap(rows, "2026-10-31T22:05:00.000Z");
    expect(first.kept.map((r) => r.candidate_id)).toEqual(second.kept.map((r) => r.candidate_id));
    expect(first.kept.map((r) => r.candidate_id)).toEqual([
      "youtube-dup1",
      "youtube-dup2",
      "youtube-dup3",
    ]);
  });
});
