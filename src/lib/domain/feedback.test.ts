import { describe, expect, it } from "vitest";
import {
  attachFlipMs,
  EXPOSURE_MIN_MS,
  referentiallyValid,
  rejectionRecordFor,
  stampAudience,
  summarizeCorrections,
  validateCorrection,
  validateImpression,
  validateImpressionBatch,
  validateSyncEvent,
  type LedgerEvent,
  type StampDeps,
  type VerdictEvent,
} from "./feedback.js";

/** Fixed clock + id factory — the domain never touches time or randomness
 *  itself, so tests pin both. */
const deps: StampDeps = {
  now: () => "2026-10-25T12:00:00.000Z",
  newId: () => "e-testid0000",
};

const VERDICT_BODY = {
  type: "verdict",
  value: "deep-read",
  session_id: "sess-abc",
  item_id: "readeck-1",
  item_url: "https://example.com/1",
  source: "readeck",
  edition_date: "2026-10-25",
  reason: "wrong-angle",
};

describe("validateCorrection — valid v2 events pass", () => {
  it("canonicalizes a verdict with injected id/ts and server-stamped schema_v", () => {
    const ev = validateCorrection(VERDICT_BODY, deps);
    expect(ev).toEqual({
      id: "e-testid0000",
      ts: "2026-10-25T12:00:00.000Z",
      schema_v: 2,
      session_id: "sess-abc",
      item_id: "readeck-1",
      item_url: "https://example.com/1",
      source: "readeck",
      edition_date: "2026-10-25",
      type: "verdict",
      value: "deep-read",
      reason: "wrong-angle",
    });
  });

  it("accepts supersedes on a verdict", () => {
    const ev = validateCorrection({ ...VERDICT_BODY, supersedes: "e-prev" }, deps);
    expect((ev as { supersedes?: string }).supersedes).toBe("e-prev");
  });

  it("accepts a click with url", () => {
    const ev = validateCorrection(
      {
        type: "click",
        url: "https://example.com/1",
        session_id: "s",
        item_id: "i",
        edition_date: "2026-10-25",
      },
      deps,
    );
    expect(ev).toMatchObject({ type: "click", url: "https://example.com/1", schema_v: 2 });
  });

  it("accepts an escalate (depth ladder, t_2f96c207) — envelope-only, additive", () => {
    const ev = validateCorrection(
      {
        type: "escalate",
        session_id: "s",
        item_id: "miniflux-1239",
        item_url: "https://example.com/1",
        source: "miniflux",
        edition_date: "2026-10-25",
      },
      deps,
    );
    expect(ev).toEqual({
      id: "e-testid0000",
      ts: "2026-10-25T12:00:00.000Z",
      schema_v: 2,
      session_id: "s",
      item_id: "miniflux-1239",
      item_url: "https://example.com/1",
      source: "miniflux",
      edition_date: "2026-10-25",
      type: "escalate",
    });
  });
});

describe("validateCorrection — malformed input fails", () => {
  const bad = (body: unknown, msg: RegExp) => () =>
    expect(() => validateCorrection(body, deps)).toThrow(msg);

  it("wrong item_id shapes fail", () => {
    bad({ ...VERDICT_BODY, item_id: 42 }, /item_id required/);
    bad({ ...VERDICT_BODY, item_id: "" }, /item_id required/);
    bad({ ...VERDICT_BODY, item_id: "x".repeat(201) }, /item_id required/);
    bad({ ...VERDICT_BODY, item_id: undefined }, /item_id required/);
  });

  it("bad verdict value fails", () => {
    bad({ ...VERDICT_BODY, value: "capture" }, /verdict value must be deep-read\|skim\|drop/);
    bad({ ...VERDICT_BODY, value: 7 }, /verdict value/);
  });

  it("unknown reason chip fails", () => {
    bad({ ...VERDICT_BODY, reason: "boring" }, /reason must be one of/);
  });

  it("implicit sync types never enter through the public surface", () => {
    for (const type of ["star", "read_progress", "capture", "highlight"]) {
      expect(() => validateCorrection({ ...VERDICT_BODY, type }, deps)).toThrow(
        /type must be verdict\|click/,
      );
    }
  });

  it("bad edition_date, missing session_id, missing click url, non-object body fail", () => {
    bad({ ...VERDICT_BODY, edition_date: "10/25/2026" }, /edition_date must be YYYY-MM-DD/);
    bad({ ...VERDICT_BODY, session_id: "" }, /session_id required/);
    bad(
      { type: "click", session_id: "s", item_id: "i", edition_date: "2026-10-25" },
      /click requires url/,
    );
    bad("not an object", /body must be a JSON object/);
    bad(null, /body must be a JSON object/);
  });

  it("over-long supersedes fails", () => {
    bad({ ...VERDICT_BODY, supersedes: "x".repeat(101) }, /supersedes must be an event id/);
  });
});

describe("validateCorrection — legacy v1 rows still parse", () => {
  it("vote row (byte-identical canonical schema)", () => {
    const ev = validateCorrection(
      { type: "vote", value: "up", item_id: "miniflux-9", edition_date: "2026-10-01" },
      deps,
    );
    expect(ev).toEqual({
      ts: "2026-10-25T12:00:00.000Z",
      type: "vote",
      value: "up",
      item_id: "miniflux-9",
      edition_date: "2026-10-01",
    });
    expect(ev.schema_v).toBeUndefined();
  });

  it("grade rows, including capture", () => {
    const g = validateCorrection(
      { type: "grade", value: "deep-read", item_id: "readeck-1", edition_date: "2026-10-01" },
      deps,
    );
    expect(g).toMatchObject({ type: "grade", value: "deep-read" });
    const c = validateCorrection(
      { type: "grade", value: "capture", item_id: "readeck-1", edition_date: "2026-10-01" },
      deps,
    );
    expect(c).toMatchObject({ type: "grade", value: "capture" });
  });

  it("invalid legacy values fail", () => {
    expect(() =>
      validateCorrection(
        { type: "vote", value: "meh", item_id: "i", edition_date: "2026-10-01" },
        deps,
      ),
    ).toThrow(/vote value must be up\|down/);
    expect(() =>
      validateCorrection(
        { type: "grade", value: "drop", item_id: "i", edition_date: "2026-10-01" },
        deps,
      ),
    ).toThrow(/grade value must be deep-read\|skim\|capture/);
  });
});

describe("validateSyncEvent — trusted path only", () => {
  it("accepts a Readeck highlight with note", () => {
    const ev = validateSyncEvent(
      {
        type: "highlight",
        session_id: "sync-readeck",
        item_id: "readeck-1",
        item_url: "https://example.com/1",
        source: "readeck",
        edition_date: "2026-10-25",
        annotation_id: "ann-1",
        text: "make taste compound",
        created: "2026-10-15T09:00:00Z",
        note: "his note",
      },
      deps,
    );
    expect(ev).toMatchObject({
      type: "highlight",
      kind: "highlight",
      annotation_id: "ann-1",
      note: "his note",
    });
  });

  it("accepts star / capture / read_progress with their payloads", () => {
    const base = { session_id: "sync-miniflux", item_id: "miniflux-2", edition_date: "2026-10-25" };
    expect(validateSyncEvent({ ...base, type: "star", starred: true }, deps)).toMatchObject({
      type: "star",
      origin: "miniflux",
      starred: true,
    });
    expect(
      validateSyncEvent({ ...base, type: "read_progress", progress_pct: 55 }, deps),
    ).toMatchObject({ type: "read_progress", origin: "readeck", progress_pct: 55 });
    expect(
      validateSyncEvent(
        {
          session_id: "sync-readeck",
          item_id: "readeck-1",
          edition_date: "2026-10-25",
          type: "capture",
        },
        deps,
      ),
    ).toMatchObject({ type: "capture", origin: "readeck" });
  });

  it("rejects public types, missing sync- session prefix, bad payloads", () => {
    expect(() => validateSyncEvent({ ...VERDICT_BODY, type: "verdict" }, deps)).toThrow(
      /read_progress\|star\|capture\|highlight/,
    );
    const base = { session_id: "grader-1", item_id: "i", edition_date: "2026-10-25" };
    expect(() => validateSyncEvent({ ...base, type: "star", starred: true }, deps)).toThrow(
      /sync-/,
    );
    expect(() => validateSyncEvent({ ...base, session_id: "sync-x", type: "star" }, deps)).toThrow(
      /starred/,
    );
    expect(() =>
      validateSyncEvent(
        { ...base, session_id: "sync-x", type: "read_progress", progress_pct: 120 },
        deps,
      ),
    ).toThrow(/progress_pct/);
    expect(() =>
      validateSyncEvent({ ...base, session_id: "sync-x", type: "highlight" }, deps),
    ).toThrow(/annotation_id/);
  });
});

describe("referentiallyValid (pure)", () => {
  const ids = new Set(["readeck-1", "miniflux-2"]);
  const v2 = validateCorrection(VERDICT_BODY, deps);
  it("passes when the item was presented", () => {
    expect(referentiallyValid(v2, ids)).toBe(true);
  });
  it("fails when the item_id is absent from its edition", () => {
    expect(referentiallyValid(v2, new Set(["miniflux-2"]))).toBe(false);
  });
  it("fails open when no edition exists yet", () => {
    expect(referentiallyValid(v2, null)).toBe(true);
  });
  it("legacy rows predate edition-carried ids and always pass", () => {
    const legacy = validateCorrection(
      { type: "vote", value: "down", item_id: "ghost", edition_date: "2026-10-01" },
      deps,
    );
    expect(referentiallyValid(legacy, new Set())).toBe(true);
  });
});

describe("rejectionRecordFor", () => {
  it("carries the reason and the safe fields only", () => {
    const rec = rejectionRecordFor(validateCorrection(VERDICT_BODY, deps), deps);
    expect(rec).toEqual({
      ts: "2026-10-25T12:00:00.000Z",
      reason: "item_id readeck-1 absent from edition 2026-10-25",
      session_id: "sess-abc",
      type: "verdict",
      value: "deep-read",
      url: undefined,
    });
  });
});

describe("attachFlipMs — burst window", () => {
  const prev: LedgerEvent = validateCorrection(VERDICT_BODY, deps);
  const laterBody = { ...VERDICT_BODY, value: "skim" as const };

  it("stamps flip_ms when the verdict landed <2s after the previous one", () => {
    const ev = validateCorrection(
      { ...laterBody, session_id: "sess-abc", item_id: "readeck-1", edition_date: "2026-10-25" },
      { ...deps, now: () => "2026-10-25T12:00:01.000Z" },
    );
    attachFlipMs(ev, prev);
    expect(ev).toMatchObject({ flip_ms: 1000 });
  });

  it("does not stamp >=2s, backwards, or non-verdict/mismatched events", () => {
    const ev = validateCorrection(laterBody, { ...deps, now: () => "2026-10-25T12:00:03.000Z" });
    attachFlipMs(ev, prev);
    expect(ev).not.toHaveProperty("flip_ms");
    const back = validateCorrection(laterBody, { ...deps, now: () => "2026-10-25T11:59:00.000Z" });
    attachFlipMs(back, prev);
    expect(back).not.toHaveProperty("flip_ms");
    const click = validateCorrection(
      {
        type: "click",
        url: "https://x",
        session_id: "s",
        item_id: "i",
        edition_date: "2026-10-25",
      },
      { ...deps, now: () => "2026-10-25T12:00:01.000Z" },
    );
    attachFlipMs(click, prev);
    expect(click).not.toHaveProperty("flip_ms");
    const noPrev = validateCorrection(laterBody, {
      ...deps,
      now: () => "2026-10-25T12:00:01.000Z",
    });
    attachFlipMs(noPrev, null); // no previous verdict — no-op
    expect(noPrev).not.toHaveProperty("flip_ms");
  });
});

describe("summarizeCorrections — latest event per item wins", () => {
  const validated = validateCorrection(VERDICT_BODY, deps) as VerdictEvent;
  const v1: VerdictEvent = {
    ...validated,
    id: "e-1",
    reason: "wrong-angle",
  };
  const v2Superseding: VerdictEvent = {
    ...v1,
    id: "e-2",
    value: "skim",
    reason: undefined,
  };
  const vote: LedgerEvent = {
    ts: "2026-10-25T11:00:00.000Z",
    type: "vote" as const,
    value: "up" as const,
    item_id: "miniflux-2",
    edition_date: "2026-10-25",
  };
  const captureGrade = {
    ts: "2026-10-25T11:30:00.000Z",
    type: "grade" as const,
    value: "capture" as const,
    item_id: "hn-3",
    edition_date: "2026-10-25",
  };
  const implicit = {
    id: "e-9",
    ts: "2026-10-25T11:45:00.000Z",
    schema_v: 2 as const,
    session_id: "sync-readeck",
    item_id: "readeck-1",
    item_url: "https://example.com/1",
    source: "readeck",
    edition_date: "2026-10-25",
    type: "capture" as const,
    origin: "readeck" as const,
  };

  it("maps v2 verdicts, legacy vote/grade; implicit rows count but fill no slot", () => {
    const sum = summarizeCorrections([v1, v2Superseding, vote, captureGrade, implicit]);
    expect(sum.count).toBe(5);
    expect(sum.last["readeck-1"]).toEqual({
      verdict: "skim",
      reason: undefined,
      ev: "e-2",
    }); // superseding verdict without a reason clears it
    expect(sum.last["miniflux-2"]).toEqual({ vote: "up" });
    expect(sum.last["hn-3"]).toEqual({ grade: "capture" });
  });

  it("filters by edition_date", () => {
    const other: LedgerEvent = { ...vote, edition_date: "2026-10-24" };
    expect(summarizeCorrections([v1, other], "2026-10-25")).toEqual({
      count: 1,
      last: { "readeck-1": { verdict: "deep-read", reason: "wrong-angle", ev: "e-1" } },
    });
  });

  it("counts escalate rows but fills no verdict slot (additive kind, t_2f96c207)", () => {
    const escalate: LedgerEvent = {
      id: "e-esc",
      ts: "2026-10-25T13:00:00.000Z",
      schema_v: 2,
      session_id: "s",
      item_id: "miniflux-1239",
      source: "miniflux",
      edition_date: "2026-10-25",
      type: "escalate",
    };
    const sum = summarizeCorrections([escalate]);
    expect(sum.count).toBe(1);
    expect(sum.last["miniflux-1239"]).toEqual({});
  });
});

const IMPRESSION_BODY = {
  session_id: "sess-abc",
  item_id: "readeck-1",
  item_url: "https://example.com/1",
  source: "readeck",
  edition_date: "2026-10-25",
  position: 2,
  section: "captured",
  tier: "captured",
  seen_ms: 1400,
};

describe("validateImpression — viewport-exposure events (card t_41df1f78)", () => {
  it("canonicalizes the envelope: injected id/ts, schema_v 2, exposure payload", () => {
    expect(validateImpression(IMPRESSION_BODY, deps)).toEqual({
      id: "e-testid0000",
      ts: "2026-10-25T12:00:00.000Z",
      schema_v: 2,
      session_id: "sess-abc",
      item_id: "readeck-1",
      item_url: "https://example.com/1",
      source: "readeck",
      edition_date: "2026-10-25",
      type: "impression",
      position: 2,
      section: "captured",
      tier: "captured",
      seen_ms: 1400,
    });
  });

  it("keeps explore_flag + propensity when the explore-slot card has landed", () => {
    const ev = validateImpression(
      {
        ...IMPRESSION_BODY,
        explore_flag: true,
        propensity: { score: 0.42, why: "lowest-rubric-coverage topic" },
      },
      deps,
    );
    expect(ev.explore_flag).toBe(true);
    expect(ev.propensity).toEqual({ score: 0.42, why: "lowest-rubric-coverage topic" });
    // explore_flag:false is dropped (absent until the explore card lands)
    expect(validateImpression({ ...IMPRESSION_BODY, explore_flag: false }, deps).explore_flag).toBe(
      undefined,
    );
  });

  it("rejects sub-threshold exposures — the domain owns the >=500ms floor", () => {
    expect(() =>
      validateImpression({ ...IMPRESSION_BODY, seen_ms: EXPOSURE_MIN_MS - 1 }, deps),
    ).toThrow(/seen_ms must be 500-/);
    expect(() => validateImpression({ ...IMPRESSION_BODY, seen_ms: 0 }, deps)).toThrow(/seen_ms/);
    expect(() => validateImpression({ ...IMPRESSION_BODY, seen_ms: "1400" }, deps)).toThrow(
      /seen_ms/,
    );
    expect(() => validateImpression({ ...IMPRESSION_BODY, seen_ms: 3_600_001 }, deps)).toThrow(
      /seen_ms/,
    );
  });

  it("rejects bad envelope/position/section/tier/explore_flag/propensity", () => {
    expect(() => validateImpression({ ...IMPRESSION_BODY, session_id: "" }, deps)).toThrow(
      /session_id required/,
    );
    expect(() => validateImpression({ ...IMPRESSION_BODY, item_id: "" }, deps)).toThrow(/item_id/);
    expect(() => validateImpression({ ...IMPRESSION_BODY, edition_date: "10-25" }, deps)).toThrow(
      /YYYY-MM-DD/,
    );
    expect(() => validateImpression({ ...IMPRESSION_BODY, position: 0 }, deps)).toThrow(/position/);
    expect(() => validateImpression({ ...IMPRESSION_BODY, position: 1.5 }, deps)).toThrow(
      /position/,
    );
    expect(() => validateImpression({ ...IMPRESSION_BODY, section: "" }, deps)).toThrow(/section/);
    expect(() => validateImpression({ ...IMPRESSION_BODY, tier: "" }, deps)).toThrow(/tier/);
    expect(() => validateImpression({ ...IMPRESSION_BODY, explore_flag: "yes" }, deps)).toThrow(
      /explore_flag/,
    );
    expect(() =>
      validateImpression({ ...IMPRESSION_BODY, propensity: { score: "high" } }, deps),
    ).toThrow(/propensity.score/);
    expect(() => validateImpression({ ...IMPRESSION_BODY, propensity: "0.9" }, deps)).toThrow(
      /propensity/,
    );
    expect(() => validateImpression("nope", deps)).toThrow(/JSON object/);
  });

  it("referentially validates like every v2 event (item must be in the edition)", () => {
    const ev = validateImpression(IMPRESSION_BODY, deps);
    expect(referentiallyValid(ev, new Set(["readeck-1"]))).toBe(true);
    expect(referentiallyValid(ev, new Set(["miniflux-9"]))).toBe(false);
    expect(referentiallyValid(ev, null)).toBe(true); // fail-open: no edition on disk
    const rec = rejectionRecordFor(ev, deps);
    expect(rec.reason).toBe("item_id readeck-1 absent from edition 2026-10-25");
    expect(rec).toMatchObject({ session_id: "sess-abc", type: "impression" });
  });
});

describe("validateImpressionBatch — batched POST body", () => {
  it("validates every event or throws; stamps each", () => {
    const events = validateImpressionBatch(
      { events: [IMPRESSION_BODY, { ...IMPRESSION_BODY, item_id: "miniflux-2", position: 1 }] },
      deps,
    );
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.type === "impression" && e.schema_v === 2)).toBe(true);
    expect(() =>
      validateImpressionBatch({ events: [IMPRESSION_BODY, { item_id: "x" }] }, deps),
    ).toThrow();
    expect(() => validateImpressionBatch({ events: [] }, deps)).toThrow(/must not be empty/);
    expect(() => validateImpressionBatch({ nope: true }, deps)).toThrow(/\{events: \[\.\.\.\]\}/);
    expect(() => validateImpressionBatch([IMPRESSION_BODY], deps)).toThrow(/JSON object/);
  });
});

describe("stampAudience — the classify-and-ignore classification (t_e86490c0)", () => {
  it("stamps every v2 event owner at write time", () => {
    const ev = validateCorrection(VERDICT_BODY, deps);
    stampAudience(ev, "owner");
    expect((ev as VerdictEvent).audience).toBe("owner");
  });
  it("leaves v1 legacy rows unstamped (they predate the field)", () => {
    const v1: LedgerEvent = {
      ts: deps.now(),
      type: "vote",
      value: "up",
      item_id: "x",
      edition_date: "2026-10-25",
    };
    stampAudience(v1, "owner");
    expect(v1).not.toHaveProperty("audience");
  });
});
