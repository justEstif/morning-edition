import { describe, expect, it } from "vitest";
import {
  backfillFromEditions,
  baseTitle,
  compactRegistry,
  continuationTitle,
  matchEntry,
  MAX_EDITION_APPEARANCES,
  NEGATIVE_SIGNAL_APPEARANCES,
  normalizeUrl,
  parseRegistry,
  planAppearances,
  planCandidate,
  rollupEngagement,
  storyIdFor,
  titleSimilarity,
  type RegistryEntry,
  type StoryRegistry,
} from "./registry.js";

const D1 = "2026-10-24";
const D2 = "2026-10-25";

const cand = (over: Partial<{ url: string; title: string; source: string }> = {}) => ({
  url: "https://example.com/rust-kernel-post",
  title: "Writing a toy kernel in Rust",
  source: "miniflux",
  ...over,
});

function entry(over: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    story_id: "story-abc0000",
    canonical_url: "https://example.com/rust-kernel-post",
    title: "Writing a toy kernel in Rust",
    first_seen: D1,
    last_seen: D1,
    appearances: [D1],
    angles: [{ source: "miniflux", url: "https://example.com/rust-kernel-post", edition_date: D1 }],
    engagement_summary: { signals: 0, clicks: 0, verdicts: 0, deep_reads: 0, dwell_ms: 0 },
    negative_signal: false,
    ...over,
  };
}

describe("normalizeUrl — canonical identity", () => {
  it("collapses scheme, www, trailing slash and fragment", () => {
    const a = normalizeUrl("https://www.Example.com/rust-kernel-post/#top");
    const b = normalizeUrl("http://example.com/rust-kernel-post");
    expect(a).toBe("https://example.com/rust-kernel-post");
    expect(b).toBe("http://example.com/rust-kernel-post");
  });

  it("drops tracking params but keeps real ones, sorted", () => {
    const a = normalizeUrl("https://example.com/p?utm_source=feed&id=9&fbclid=x&q=rust");
    const b = normalizeUrl("https://example.com/p?q=rust&id=9");
    expect(a).toBe("https://example.com/p?id=9&q=rust");
    expect(b).toBe(a);
  });

  it("falls back to trimmed lowercase for unparsable input", () => {
    expect(normalizeUrl("  Not A URL ")).toBe("not a url");
  });

  it("empty stays empty", () => {
    expect(normalizeUrl("   ")).toBe("");
  });
});

describe("title similarity + story ids", () => {
  it("identical titles score 1, disjoint score 0", () => {
    expect(titleSimilarity("Writing a Toy Kernel!", "writing a toy kernel")).toBe(1);
    expect(titleSimilarity("Allana's design portfolio", "Kernel panics explained")).toBe(0);
  });

  it("near-duplicate aggregation headlines clear the threshold", () => {
    const sim = titleSimilarity(
      "Writing a toy kernel in Rust, part 2",
      "Writing a toy kernel in Rust",
    );
    expect(sim).toBeGreaterThanOrEqual(0.6);
  });

  it("story ids are deterministic and identity-driven", () => {
    expect(storyIdFor("https://www.example.com/a/", "T")).toBe(
      storyIdFor("https://example.com/a", "T"),
    );
    expect(storyIdFor("", "Some Title")).toBe(storyIdFor("", "some title!"));
    expect(storyIdFor("https://example.com/a", "T")).toMatch(/^story-/);
  });
});

describe("parseRegistry — parsed, never trusted", () => {
  it("accepts well-formed entries", () => {
    expect(parseRegistry([entry()])).toEqual([entry()]);
  });

  it("rejects garbage and malformed entries wholesale", () => {
    expect(parseRegistry("nope")).toBeNull();
    expect(parseRegistry([{ story_id: "x" }])).toBeNull();
    expect(parseRegistry([entry({ appearances: ["10/24"] })])).toBeNull();
    expect(parseRegistry([entry({ engagement_summary: { signals: -1 } as never })])).toBeNull();
  });
});

describe("the card's seeded scenario — two sources, two days, one story", () => {
  it("day 1 miniflux is fresh; day 2 HN is a continuation of ONE canonical entry", () => {
    const day1 = planAppearances([], [cand()], D1);
    expect(day1.pool.map((d) => d.action)).toEqual(["fresh"]);
    expect(day1.entries).toHaveLength(1);

    const day2 = planAppearances(
      day1.entries,
      [cand({ source: "hn", url: "https://news.example/agg" })],
      D2,
    );
    expect(day2.pool.map((d) => d.action)).toEqual(["continuation"]);
    expect(day2.entries).toHaveLength(1);
    const e = day2.entries[0];
    expect(e.story_id).toBe(day1.entries[0].story_id);
    expect(e.appearances).toEqual([D1, D2]);
    expect(e.angles.map((a) => a.source)).toEqual(["miniflux", "hn"]);
    expect(e.first_seen).toBe(D1);
    expect(e.last_seen).toBe(D2);
  });

  it("the same source re-presenting is a duplicate, never a continuation", () => {
    const day1 = planAppearances([], [cand()], D1);
    const day2 = planAppearances(day1.entries, [cand()], D2);
    expect(day2.pool.map((d) => d.action)).toEqual(["duplicate"]);
    expect(day2.entries[0].appearances).toEqual([D1]);
  });

  it("a title-only match (different URLs) still finds the story", () => {
    const reg: StoryRegistry = [entry()];
    const hit = matchEntry(reg, cand({ url: "https://other.dev/toy-kernel-rust" }));
    expect(hit?.story_id).toBe("story-abc0000");
  });

  it("an unrelated story matches nothing", () => {
    expect(
      matchEntry(
        [entry()],
        cand({ title: "Sourdough starter journal, week 12", url: "https://x.y/sourdough" }),
      ),
    ).toBeNull();
  });
});

describe("within-edition + cap policy", () => {
  it("two candidates for one story in the SAME edition: fresh then duplicate", () => {
    const r = planAppearances([], [cand(), cand({ source: "hn" })], D1);
    expect(r.pool.map((d) => d.action)).toEqual(["fresh", "duplicate"]);
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0].appearances).toEqual([D1]);
  });

  it("same-day rebuild: already-presented is accepted WITHOUT re-folding", () => {
    const reg: StoryRegistry = [entry({ appearances: [D1], first_seen: D1, last_seen: D1 })];
    const d = planCandidate(reg, cand(), D1);
    expect(d.action).toBe("already-presented");
    expect(d.entry_after).toBeNull();
    const r = planAppearances(reg, [cand(), cand({ source: "hn" })], D1);
    expect(r.pool.map((x) => x.action)).toEqual(["already-presented", "duplicate"]);
    expect(r.entries).toEqual(reg); // idempotent: a rebuild changes nothing
  });

  it("capped after MAX_EDITION_APPEARANCES, even with a new source", () => {
    const e = entry({
      appearances: [D1, "2026-10-23", "2026-10-22"],
      angles: [
        { source: "miniflux", edition_date: "2026-10-22" },
        { source: "hn", edition_date: "2026-10-23" },
        { source: "readeck", edition_date: D1 },
      ],
    });
    const d = planCandidate([e], cand({ source: "newsletter" }), D2);
    expect(d.action).toBe("capped");
  });

  it("cap constant is 3 (initial + two continuation angles)", () => {
    expect(MAX_EDITION_APPEARANCES).toBe(3);
  });

  it("continuationTitle is the newspaper-convention presentation", () => {
    expect(continuationTitle("Toy kernels", "hn")).toBe("Toy kernels (updated angle: hn)");
  });
});

describe("rollupEngagement — idempotent, URL-matched, shadow flag", () => {
  const reg: StoryRegistry = [
    entry({ appearances: [D1, D2, "2026-10-26"], canonical_url: normalizeUrl(cand().url) }),
  ];

  it("counts events by type and derives the negative flag from zero engagement", () => {
    const zeroed = rollupEngagement(reg, []);
    expect(zeroed[0].engagement_summary.signals).toBe(0);
    expect(zeroed[0].negative_signal).toBe(true); // 3 appearances, zero engagement

    const engaged = rollupEngagement(reg, [
      { type: "click", item_url: cand().url },
      { type: "verdict", url: cand().url + "/", verdict: "deep-read" },
      { type: "dwell", item_url: cand().url, dwell_ms: 45_000 },
      { type: "click", item_url: "https://unrelated.example/x" }, // no entry → ignored
    ]);
    expect(engaged[0].engagement_summary).toEqual({
      signals: 3,
      clicks: 1,
      verdicts: 1,
      deep_reads: 1,
      dwell_ms: 45_000,
    });
    expect(engaged[0].negative_signal).toBe(false);
  });

  it("is idempotent — re-rolling never double-counts", () => {
    const once = rollupEngagement(reg, [{ type: "click", item_url: cand().url }]);
    expect(rollupEngagement(once, [{ type: "click", item_url: cand().url }])).toEqual(once);
  });

  it("the flag needs NEGATIVE_SIGNAL_APPEARANCES appearances", () => {
    expect(NEGATIVE_SIGNAL_APPEARANCES).toBe(3);
    const twoShows = rollupEngagement([entry({ appearances: [D1, D2] })], []);
    expect(twoShows[0].negative_signal).toBe(false);
  });
});

describe("backfillFromEditions — cross-day memory from the archive", () => {
  it("replays days into one canonical entry with both angles", () => {
    const reg = backfillFromEditions([
      { edition_date: D1, items: [{ url: cand().url, title: cand().title, source: "miniflux" }] },
      {
        edition_date: D2,
        items: [
          { url: cand().url, title: cand().title, source: "miniflux" }, // dup within replay
          { url: "https://news.example/agg", title: cand().title, source: "hn" },
        ],
      },
    ]);
    expect(reg).toHaveLength(1);
    expect(reg[0].appearances).toEqual([D1, D2]);
    expect(reg[0].angles.map((a) => a.source)).toEqual(["miniflux", "hn"]);
  });
});

describe("compactRegistry — backfill compaction (card t_00a5273f)", () => {
  it("baseTitle strips the continuation presentation suffix", () => {
    expect(baseTitle("Toy kernels (updated angle: hn)")).toBe("Toy kernels");
    expect(baseTitle("Toy kernels")).toBe("Toy kernels");
    expect(baseTitle("  Toy kernels (updated angle: hn) (updated angle: redeck) ")).toBe(
      "Toy kernels",
    );
  });

  it("the replay's known miss: a day-2 capture under a different URL + continuation-suffixed title re-seeds as a fresh entry — compaction merges it back", () => {
    // short base title: the 3 suffix tokens sink raw similarity below the
    // threshold ({toy,kernels} vs {toy,kernels,updated,angle,hn} = 2/5),
    // exactly the archived-presentation case the coarse seed re-seeds
    const base = "Toy kernels";
    const days = [
      { edition_date: D1, items: [{ url: cand().url, title: base, source: "miniflux" }] },
      {
        edition_date: D2,
        items: [
          // the live commit path strips this suffix before re-planning; the
          // coarse seed doesn't — so the replay misses the title fallback
          { url: "https://news.example/agg", title: continuationTitle(base, "hn"), source: "hn" },
        ],
      },
    ];
    const seed = backfillFromEditions(days);
    expect(seed).toHaveLength(2); // the inflation the card flags

    const compacted = compactRegistry(seed);
    expect(compacted).toHaveLength(1);
    const e = compacted[0];
    expect(e.title).toBe(base); // earliest entry keeps the identity
    expect(e.first_seen).toBe(D1);
    expect(e.last_seen).toBe(D2);
    expect(e.appearances).toEqual([D1, D2]);
    expect(e.angles.map((a) => a.source)).toEqual(["miniflux", "hn"]);
  });

  it("same canonical URL under different titles merges, earliest identity wins", () => {
    const compacted = compactRegistry([
      entry({ story_id: storyIdFor(cand().url, cand().title), first_seen: D1, last_seen: D1 }),
      entry({
        story_id: "story-other00",
        first_seen: D2,
        last_seen: D2,
        title: "A completely different headline for it",
        appearances: [D2],
        angles: [{ source: "hn", url: "https://news.example/agg", edition_date: D2 }],
      }),
    ]);
    expect(compacted).toHaveLength(1);
    expect(compacted[0].title).toBe(entry().title);
    expect(compacted[0].story_id).toBe(storyIdFor(cand().url, cand().title));
    expect(compacted[0].appearances).toEqual([D1, D2]);
    expect(compacted[0].angles.map((a) => a.source)).toEqual(["miniflux", "hn"]);
  });

  it("engagement summaries sum; negative_signal is recomputed from merged facts", () => {
    const a = entry({
      appearances: [D1],
      engagement_summary: { signals: 1, clicks: 1, verdicts: 0, deep_reads: 0, dwell_ms: 500 },
    });
    const b = entry({
      first_seen: D2,
      last_seen: D2,
      appearances: [D2, "2026-10-26"],
      angles: [{ source: "hn", url: "https://news.example/agg", edition_date: D2 }],
      negative_signal: true, // stale derivation on the pre-merge entry
    });
    const compacted = compactRegistry([a, b]);
    expect(compacted).toHaveLength(1);
    expect(compacted[0].engagement_summary).toEqual({
      signals: 1,
      clicks: 1,
      verdicts: 0,
      deep_reads: 0,
      dwell_ms: 500,
    });
    expect(compacted[0].negative_signal).toBe(false); // 3 appearances but engaged
  });

  it("distinct stories stay separate — no over-merge below the threshold", () => {
    const compacted = compactRegistry([
      entry(),
      entry({
        story_id: "story-other00",
        canonical_url: "https://example.com/sourdough",
        title: "Sourdough starter journal, week 12",
        angles: [{ source: "miniflux", url: "https://example.com/sourdough", edition_date: D1 }],
      }),
    ]);
    expect(compacted).toHaveLength(2);
  });

  it("invariant: no duplicate canonical_urls after compaction; idempotent", () => {
    const seed = backfillFromEditions([
      {
        edition_date: D1,
        items: [
          { url: "https://example.com/a", title: "One shared headline here", source: "miniflux" },
          { url: "https://example.com/b", title: "An unrelated other story", source: "hn" },
        ],
      },
      {
        edition_date: D2,
        items: [
          { url: "https://mirror.example/x", title: "One shared headline here", source: "hn" },
          {
            url: "https://example.com/a", // same URL, suffixed presentation
            title: "One shared headline here (updated angle: hn)",
            source: "readeck",
          },
        ],
      },
    ]);
    const once = compactRegistry(seed);
    const urls = once.map((e) => e.canonical_url);
    expect(new Set(urls).size).toBe(urls.length);
    expect(compactRegistry(once)).toEqual(once);
    // both captures of story A collapsed into one entry with both angles
    const a = once.find((e) => e.canonical_url === "https://example.com/a");
    expect(a?.appearances).toEqual([D1, D2]);
    expect(a?.angles.map((x) => x.source)).toEqual(["miniflux", "hn"]);
    expect(once).toHaveLength(2); // A merged; B untouched
  });
});
