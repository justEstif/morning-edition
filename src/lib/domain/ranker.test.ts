import { describe, expect, it } from "vitest";
import {
  computeGateStats,
  computeRankerWeights,
  decayFactor,
  multiplierFor,
  parseRankerWeights,
  shadowOrder,
  shadowScore,
  signalValue,
  suggestVerdict,
  type RankerEvent,
  type RankerInputs,
} from "./ranker.js";

const AS_OF = "2026-10-26";
const FRESH = "2026-10-26T10:00:00Z"; // same calendar day as AS_OF → decay 1.0

function ev(over: Partial<RankerEvent> & { type: string }): RankerEvent {
  return { ts: FRESH, item_id: "x-1", source: "miniflux", ...over } as RankerEvent;
}

const ITEMS = {
  "miniflux-1": { source: "miniflux", topic: "rust-os", author: "Foo Blog" },
  "miniflux-2": { source: "miniflux", topic: "ai-at-work" },
  "hn-1": { source: "hn", topic: "rust-os" },
  "readeck-1": { source: "readeck", topic: "captured" },
};

function baseInputs(over: Partial<RankerInputs> = {}): RankerInputs {
  return {
    asOf: AS_OF,
    events: [],
    items: ITEMS,
    negativeStories: [],
    registryStories: 0,
    ledgerRead: true,
    ...over,
  };
}

describe("signalValue (raw, before burst × decay)", () => {
  it("maps verdicts/grades/votes to the documented values", () => {
    expect(signalValue(ev({ type: "verdict", value: "deep-read" }))).toBe(1.0);
    expect(signalValue(ev({ type: "verdict", value: "skim" }))).toBe(-0.4);
    expect(signalValue(ev({ type: "verdict", value: "drop" }))).toBe(-0.7);
    expect(signalValue(ev({ type: "verdict", value: "skip" }))).toBe(-1.0); // strongest explicit negative, t_1e178af7
    expect(signalValue(ev({ type: "grade", value: "capture" }))).toBe(0.6); // legacy v1
    expect(signalValue(ev({ type: "vote", value: "up" }))).toBe(0.5);
    expect(signalValue(ev({ type: "vote", value: "down" }))).toBe(-0.7);
  });

  it("maps implicit signals; impressions carry no value", () => {
    expect(signalValue(ev({ type: "click" }))).toBe(0.3);
    expect(signalValue(ev({ type: "dwell", dwell_ms: 120_000 }))).toBe(0.4);
    expect(signalValue(ev({ type: "capture" }))).toBe(0.6);
    expect(signalValue(ev({ type: "star", starred: true }))).toBe(0.5);
    expect(signalValue(ev({ type: "star", starred: false }))).toBe(null);
    expect(signalValue(ev({ type: "read_progress", progress_pct: 40 }))).toBeCloseTo(0.2, 10);
    expect(signalValue(ev({ type: "read_progress", progress_pct: 0 }))).toBe(null);
    expect(signalValue(ev({ type: "skip", confidence: 0.5 }))).toBeCloseTo(-0.1, 10);
    expect(signalValue(ev({ type: "impression", seen_ms: 5000 }))).toBe(null);
    expect(signalValue(ev({ type: "something-new" }))).toBe(null); // never guessed
  });
});

describe("multiplierFor (bounded)", () => {
  it("is 1.0 at zero signal and clamps at 0.5 / 2.0", () => {
    expect(multiplierFor(0)).toBe(1.0);
    expect(multiplierFor(10)).toBe(2.0); // exp(1) = 2.718 → ceiling
    expect(multiplierFor(-10)).toBe(0.5); // exp(-1) = 0.368 → floor
    expect(multiplierFor(1000)).toBe(2.0); // a hot week cannot exceed the band
  });
});

describe("decayFactor (30-day half-life → weights decay toward 1.0)", () => {
  it("is 1.0 for same-day signals and halves every 30 days", () => {
    expect(decayFactor(FRESH, AS_OF)).toBe(1.0);
    expect(decayFactor("2026-09-26T10:00:00Z", AS_OF)).toBeCloseTo(0.5, 6);
    expect(decayFactor("2026-08-27T10:00:00Z", AS_OF)).toBeCloseTo(0.25, 6);
  });
});

describe("computeRankerWeights (seeded ledger, hand-computed deltas)", () => {
  const inputs = baseInputs({
    events: [
      ev({ type: "verdict", value: "deep-read", item_id: "miniflux-1" }), // +1.0
      ev({ type: "verdict", value: "skim", item_id: "miniflux-2" }), // −0.4
      ev({ type: "click", item_id: "hn-1", source: "hn" }), // +0.3
      ev({
        type: "dwell",
        item_id: "readeck-1",
        source: "readeck",
        dwell_ms: 120_000,
        opened_at: "2026-10-26T09:00:00Z",
      }), // +0.4
      ev({ type: "impression", item_id: "readeck-1", source: "readeck", seen_ms: 4000 }), // 0
    ],
  });
  const w = computeRankerWeights(inputs);

  it("accumulates per-topic scores into clamped multipliers", () => {
    // rust-os S = 1.0 + 0.3 = 1.3 → exp(0.13) = 1.13883
    expect(w.weights.topics["rust-os"]).toBe(1.1388);
    // ai-at-work S = −0.4 → exp(−0.04) = 0.96079
    expect(w.weights.topics["ai-at-work"]).toBe(0.9608);
    // captured S = 0.4 → exp(0.04) = 1.04081
    expect(w.weights.topics["captured"]).toBe(1.0408);
  });

  it("accumulates per-source and per-author buckets", () => {
    // miniflux S = 1.0 − 0.4 = 0.6 → exp(0.06) = 1.06184
    expect(w.weights.sources["miniflux"]).toBe(1.0618);
    expect(w.weights.sources["hn"]).toBe(1.0305); // exp(0.03)
    expect(w.weights.sources["readeck"]).toBe(1.0408); // exp(0.04)
    expect(w.weights.authors["Foo Blog"]).toBe(1.1052); // exp(0.1), S = 1.0
  });

  it("books impressions as signals-counted but weight-silent", () => {
    expect(w.inputs.events_by_type["impression"]).toBe(1);
    expect(w.inputs.weighted_events).toBe(4);
  });

  it("carries the audit evidence beside every multiplier", () => {
    expect(w.evidence.topics["rust-os"]).toEqual({ score: 1.3, events: 2 });
    expect(w.evidence.authors["Foo Blog"]).toEqual({ score: 1.0, events: 1 });
  });
});

describe("boundedness + decay behavior", () => {
  it("a hot streak clamps at the ceiling; a cold one at the floor", () => {
    const hot = baseInputs({
      events: Array.from({ length: 50 }, () =>
        ev({ type: "verdict", value: "deep-read", item_id: "miniflux-1" }),
      ),
    });
    expect(computeRankerWeights(hot).weights.topics["rust-os"]).toBe(2.0);
    const cold = baseInputs({
      events: Array.from({ length: 50 }, () =>
        ev({ type: "verdict", value: "drop", item_id: "miniflux-1" }),
      ),
    });
    expect(computeRankerWeights(cold).weights.topics["rust-os"]).toBe(0.5);
  });

  it("a 29-day-old signal weighs ~half a fresh one; 30 days back is out of window", () => {
    const monthOld = baseInputs({
      events: [
        ev({
          ts: "2026-09-27T10:00:00Z",
          type: "verdict",
          value: "deep-read",
          item_id: "miniflux-1",
        }),
      ],
    });
    // decay(29d) = 2^(-29/30) ≈ 0.5117 → S ≈ 0.5117 → exp(0.1·S) ≈ 1.0525
    expect(computeRankerWeights(monthOld).weights.topics["rust-os"]).toBe(1.0525);
    const ancient = baseInputs({
      events: [
        ev({
          ts: "2026-09-26T10:00:00Z",
          type: "verdict",
          value: "deep-read",
          item_id: "miniflux-1",
        }),
      ],
    });
    const w = computeRankerWeights(ancient);
    expect(w.inputs.weighted_events).toBe(0);
    expect(w.weights.topics).toEqual({});
  });

  it("burst verdicts (flip_ms) down-weight to 10%", () => {
    const w = computeRankerWeights(
      baseInputs({
        events: [ev({ type: "verdict", value: "deep-read", item_id: "miniflux-1", flip_ms: 800 })],
      }),
    );
    expect(w.weights.topics["rust-os"]).toBe(1.0101); // exp(0.1 × 0.1)
  });

  it("multi-tab dwell double-settles dedupe on item_id + opened_at (max wins)", () => {
    const w = computeRankerWeights(
      baseInputs({
        events: [
          ev({
            type: "dwell",
            item_id: "readeck-1",
            source: "readeck",
            dwell_ms: 90_000,
            opened_at: "2026-10-26T09:00:00Z",
          }),
          ev({
            type: "dwell",
            item_id: "readeck-1",
            source: "readeck",
            dwell_ms: 120_000,
            opened_at: "2026-10-26T09:00:00Z",
          }),
        ],
      }),
    );
    expect(w.inputs.events_by_type["dwell"]).toBe(1); // one dwell, not two
    expect(w.weights.sources["readeck"]).toBe(1.0408); // S = 0.4 once
  });

  it("registry zero-engagement negatives push their source down, decayed by staleness", () => {
    const w = computeRankerWeights(
      baseInputs({
        negativeStories: [{ sources: ["readeck"], last_seen: "2026-10-20" }], // 6d old
        registryStories: 42,
      }),
    );
    // S = −0.5 × 2^(−6/30) = −0.43527 → exp(0.1·S) = 0.95742
    expect(w.weights.sources["readeck"]).toBe(0.9574);
    expect(w.inputs.negative_stories).toBe(1);
    expect(w.inputs.registry_stories).toBe(42);
  });
});

describe("determinism (recompute idempotence)", () => {
  it("the same inputs produce byte-identical artifacts", () => {
    const inputs = baseInputs({
      events: [
        ev({ type: "verdict", value: "deep-read", item_id: "miniflux-1" }),
        ev({ type: "click", item_id: "hn-1", source: "hn" }),
        ev({
          type: "dwell",
          item_id: "readeck-1",
          source: "readeck",
          dwell_ms: 60_000,
          opened_at: "2026-10-26T08:00:00Z",
        }),
      ],
      negativeStories: [{ sources: ["readeck"], last_seen: "2026-10-20" }],
      registryStories: 7,
    });
    const a = JSON.stringify(computeRankerWeights(inputs));
    // re-fed in reverse event order — accumulation is order-independent
    const c = JSON.stringify(
      computeRankerWeights({ ...inputs, events: [...inputs.events].reverse() }),
    );
    expect(a).toBe(c);
  });

  it("survives a parse→stringify round trip via the validator", () => {
    const w = computeRankerWeights(
      baseInputs({
        events: [ev({ type: "verdict", value: "skim", item_id: "miniflux-2" })],
      }),
    );
    expect(parseRankerWeights(JSON.parse(JSON.stringify(w)))).toEqual(w);
  });
});

describe("shadow ordering (static stays served; this only logs)", () => {
  it("orders by shadow score desc with stable ties", () => {
    const weights = { topics: { "rust-os": 2.0 }, sources: {}, authors: {} };
    const ids = ["a", "b", "c", "d"];
    const scores = {
      a: shadowScore(0.9, "rust-os", "hn", undefined, weights), // 1.8
      b: shadowScore(0.8, "ai-at-work", "hn", undefined, weights), // 0.8
      c: shadowScore(0.4, "might-like", "hn", undefined, weights), // 0.4
      d: shadowScore(0.4, "might-like", "hn", undefined, weights), // 0.4 (tie with c)
    };
    expect(shadowOrder(ids, scores)).toEqual(["a", "b", "c", "d"]); // c before d: static order
    const inverted = { ...scores, c: 0.1 };
    expect(shadowOrder(ids, inverted)).toEqual(["a", "b", "d", "c"]);
  });

  it("defaults missing weights to 1.0 (no signal, no nudge)", () => {
    expect(
      shadowScore(0.8, "ai-at-work", "miniflux", undefined, {
        topics: {},
        sources: {},
        authors: {},
      }),
    ).toBe(0.8);
  });
});

describe("promotion-gate tracker (hand-counted synthetic ledger)", () => {
  const gateItems = {
    "m-1": { source: "miniflux", topic: "rust-os", url: "https://a.example/1" },
    "m-2": { source: "miniflux", topic: "rust-os", url: "https://a.example/2" },
    "m-3": { source: "miniflux", topic: "rust-os", url: "https://a.example/3" },
    "m-4": { source: "miniflux", topic: "rust-os", url: "https://a.example/4" },
    "m-6": { source: "miniflux", topic: "rust-os", url: "https://a.example/6" },
  };
  const gateEvents: RankerEvent[] = [
    // m-1: light engagement → suggest skim; verdict skim → AGREE
    ev({ ts: "2026-10-25T10:00:00Z", type: "click", item_id: "m-1" }),
    ev({ ts: "2026-10-25T11:00:00Z", type: "verdict", value: "skim", item_id: "m-1" }),
    // m-2: deep dwell → suggest deep-read; verdict skim → DISAGREE
    ev({
      ts: "2026-10-25T10:00:00Z",
      type: "dwell",
      item_id: "m-2",
      dwell_ms: 120_000,
      opened_at: "2026-10-25T09:00:00Z",
    }),
    ev({ ts: "2026-10-25T11:00:00Z", type: "verdict", value: "skim", item_id: "m-2" }),
    // m-3: zero engagement + registry negative → suggest drop; verdict drop → AGREE
    ev({ ts: "2026-10-25T11:00:00Z", type: "verdict", value: "drop", item_id: "m-3" }),
    // m-4: zero engagement, no negative flag → NO suggestion (unsuggestable)
    ev({ ts: "2026-10-25T11:00:00Z", type: "verdict", value: "deep-read", item_id: "m-4" }),
    // m-5: outside the 14-day window → not counted at all
    ev({ ts: "2026-10-10T11:00:00Z", type: "verdict", value: "skim", item_id: "m-1" }),
    // m-6: re-tap supersedes (latest verdict wins); unsuggestable either way
    ev({ ts: "2026-10-24T11:00:00Z", type: "verdict", value: "deep-read", item_id: "m-6" }),
    ev({ ts: "2026-10-25T12:00:00Z", type: "verdict", value: "skim", item_id: "m-6" }),
  ];
  const gate = computeGateStats(
    baseInputs({
      events: gateEvents,
      items: gateItems,
      negativeStories: [
        { canonical_url: "https://A.example/3", sources: ["miniflux"], last_seen: "2026-10-25" },
      ],
      registryStories: 6,
    }),
  );

  it("matches the hand count: 6 verdicts in window, 3 suggestable, 2 agreements", () => {
    // Hand count:
    //   in window: m-1, m-2, m-3, m-4, m-6(×2 re-taps) = 6 verdict events
    //   suggestable: m-1 (click→skim), m-2 (dwell→deep-read), m-3 (negative→drop)
    //   excluded: m-4, m-6 (no engagement, no negative flag)
    //   agreements: m-1 ✓, m-3 ✓ (m-2 ✗) = 2 → rate 2/3 = 0.6667 < 0.8 → FAIL
    expect(gate.verdicts_in_window).toBe(6);
    expect(gate.suggestable).toBe(3);
    expect(gate.agreements).toBe(2);
    expect(gate.agreement_rate).toBe(0.6667);
    expect(gate.passes).toBe(false);
  });

  it("matches canonical URLs insensitively for the negative-flag join", () => {
    expect(suggestVerdict([], true)).toBe("drop");
    expect(suggestVerdict([], false)).toBe(null);
  });

  it("a skip verdict counts in the drop bucket of the gate (t_1e178af7)", () => {
    // zero engagement + registry negative → suggest drop; verdict skip → AGREE
    const stats = computeGateStats(
      baseInputs({
        events: [
          ev({ ts: "2026-10-25T11:00:00Z", type: "verdict", value: "skip", item_id: "m-3" }),
        ],
        items: gateItems,
        negativeStories: [
          { canonical_url: "https://A.example/3", sources: ["miniflux"], last_seen: "2026-10-25" },
        ],
        registryStories: 6,
      }),
    );
    expect(stats.verdicts_in_window).toBe(1);
    expect(stats.suggestable).toBe(1);
    expect(stats.agreements).toBe(1);
    // and a skip disagrees with an engagement-derived skim/deep-read suggestion
    const disagree = computeGateStats(
      baseInputs({
        events: [
          ev({ ts: "2026-10-25T10:00:00Z", type: "click", item_id: "m-1" }),
          ev({ ts: "2026-10-25T11:00:00Z", type: "verdict", value: "skip", item_id: "m-1" }),
        ],
        items: gateItems,
      }),
    );
    expect(disagree.suggestable).toBe(1);
    expect(disagree.agreements).toBe(0);
  });

  it("a suggestion needs non-verdict engagement evidence", () => {
    expect(suggestVerdict([ev({ type: "click" })], false)).toBe("skim");
    expect(suggestVerdict([ev({ type: "dwell", dwell_ms: 61_000 })], false)).toBe("deep-read");
    expect(suggestVerdict([ev({ type: "dwell", dwell_ms: 59_000 })], false)).toBe("skim");
    expect(suggestVerdict([ev({ type: "read_progress", progress_pct: 80 })], false)).toBe(
      "deep-read",
    );
    expect(suggestVerdict([ev({ type: "impression", seen_ms: 9000 })], false)).toBe(null);
  });
});

describe("parseRankerWeights (parsed wire JSON, never trusted)", () => {
  const good = computeRankerWeights(
    baseInputs({ events: [ev({ type: "verdict", value: "deep-read", item_id: "miniflux-1" })] }),
  );

  it("accepts its own output", () => {
    expect(parseRankerWeights(good)).not.toBeNull();
  });

  it("rejects corrupt / out-of-band artifacts", () => {
    expect(parseRankerWeights(null)).toBeNull();
    expect(parseRankerWeights({})).toBeNull();
    expect(parseRankerWeights({ ...good, version: 99 })).toBeNull();
    expect(parseRankerWeights({ ...good, as_of: "not-a-date" })).toBeNull();
    expect(
      parseRankerWeights({
        ...good,
        weights: { ...good.weights, topics: { ...good.weights.topics, "rust-os": 3.0 } },
      }),
    ).toBeNull(); // outside the clamp band
    const noGate = { ...good } as Record<string, unknown>;
    delete noGate.promotion_gate;
    expect(parseRankerWeights(noGate)).toBeNull();
  });
});
