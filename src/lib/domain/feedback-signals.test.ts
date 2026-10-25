import { describe, expect, it } from "vitest";
import {
  MAX_DWELL_MS,
  MIN_DWELL_MS,
  validateDwell,
  validateSyncEvent,
  validateTelemetryBatch,
  type DwellEvent,
  type SkipEvent,
  type StampDeps,
} from "./feedback.js";

const deps: StampDeps = {
  now: () => "2026-10-25T18:00:00.000Z",
  newId: () => "e-testid0000",
};

const DWELL_BODY = {
  type: "dwell",
  url: "https://example.com/a",
  dwell_ms: 45_000,
  opened_at: "2026-10-25T17:59:00.000Z",
  session_id: "sess-abc",
  item_id: "readeck-1",
  item_url: "https://example.com/a",
  source: "readeck",
  edition_date: "2026-10-25",
};

describe("validateDwell — valid events pass", () => {
  it("canonicalizes with injected id/ts and schema_v", () => {
    const ev = validateDwell(DWELL_BODY, deps);
    expect(ev).toEqual({
      id: "e-testid0000",
      ts: "2026-10-25T18:00:00.000Z",
      schema_v: 2,
      session_id: "sess-abc",
      item_id: "readeck-1",
      item_url: "https://example.com/a",
      source: "readeck",
      edition_date: "2026-10-25",
      type: "dwell",
      url: "https://example.com/a",
      dwell_ms: 45_000,
      opened_at: "2026-10-25T17:59:00.000Z",
    } satisfies DwellEvent);
  });

  it("accepts a dwell exactly at the MIN_DWELL_MS noise floor", () => {
    const ev = validateDwell({ ...DWELL_BODY, dwell_ms: MIN_DWELL_MS }, deps);
    expect(ev.dwell_ms).toBe(MIN_DWELL_MS);
  });

  it("accepts a dwell exactly at MAX_DWELL_MS", () => {
    const ev = validateDwell({ ...DWELL_BODY, dwell_ms: MAX_DWELL_MS }, deps);
    expect(ev.dwell_ms).toBe(MAX_DWELL_MS);
  });
});

describe("validateDwell — rejects garbage", () => {
  const cases: Array<[string, Record<string, unknown> | string]> = [
    ["missing url", { ...DWELL_BODY, url: "" }],
    ["zero dwell", { ...DWELL_BODY, dwell_ms: 0 }],
    ["negative dwell", { ...DWELL_BODY, dwell_ms: -5 }],
    ["bounce dwell under the noise floor", { ...DWELL_BODY, dwell_ms: MIN_DWELL_MS - 1 }],
    ["non-finite dwell", { ...DWELL_BODY, dwell_ms: Number.NaN }],
    ["lost-tab dwell over MAX_DWELL_MS", { ...DWELL_BODY, dwell_ms: MAX_DWELL_MS + 1 }],
    ["missing opened_at", { ...DWELL_BODY, opened_at: "" }],
    ["bad edition_date", { ...DWELL_BODY, edition_date: "10/25/2026" }],
    ["missing session_id", { ...DWELL_BODY, session_id: "" }],
    ["non-object", "dwell"],
  ];
  for (const [name, body] of cases) {
    it(`rejects ${name}`, () => {
      expect(() => validateDwell(body, deps)).toThrow();
    });
  }
  it("names the bounds in the dwell_ms error", () => {
    expect(() => validateDwell({ ...DWELL_BODY, dwell_ms: 1 }, deps)).toThrow(
      `${MIN_DWELL_MS}-${MAX_DWELL_MS}`,
    );
  });
});

describe("validateTelemetryBatch — impressions + dwell on one append path", () => {
  const IMPRESSION_BODY = {
    type: "impression",
    session_id: "sess-abc",
    item_id: "readeck-1",
    edition_date: "2026-10-25",
    position: 1,
    section: "captured",
    tier: "deep read",
    seen_ms: 900,
  };

  it("validates a mixed batch, dispatching on type", () => {
    const events = validateTelemetryBatch(
      { events: [IMPRESSION_BODY, { ...DWELL_BODY, item_id: "readeck-2" }] },
      deps,
    );
    expect(events.map((e) => e.type)).toEqual(["impression", "dwell"]);
    expect(events[0].item_id).toBe("readeck-1");
    expect(events[1].item_id).toBe("readeck-2");
  });

  it("rejects the whole batch on one bad event (all-or-nothing)", () => {
    expect(() =>
      validateTelemetryBatch({ events: [IMPRESSION_BODY, { ...DWELL_BODY, dwell_ms: 1 }] }, deps),
    ).toThrow(`${MIN_DWELL_MS}-${MAX_DWELL_MS}`);
  });

  it("rejects unknown or missing event types", () => {
    expect(() =>
      validateTelemetryBatch({ events: [{ ...DWELL_BODY, type: "verdict" }] }, deps),
    ).toThrow('type must be "impression" or "dwell"');
    expect(() =>
      validateTelemetryBatch({ events: [{ ...IMPRESSION_BODY, type: undefined }] }, deps),
    ).toThrow('type must be "impression" or "dwell"');
  });

  it("keeps the impression-batch contract (empty, shape, size)", () => {
    expect(() => validateTelemetryBatch({ events: [] }, deps)).toThrow("must not be empty");
    expect(() => validateTelemetryBatch({ nope: true }, deps)).toThrow("{events: [...]}");
    expect(() => validateTelemetryBatch("x", deps)).toThrow("JSON object");
  });
});

const SKIP_BODY = {
  type: "skip",
  confidence: 0.6,
  impressions: 2,
  seen_ms: 4200,
  session_id: "sync-derived",
  item_id: "hn-999",
  edition_date: "2026-10-25",
};

describe("validateSyncEvent — skip (R5 derived negative, trusted path)", () => {
  it("accepts a confidence-weighted skip with exposure evidence", () => {
    const ev = validateSyncEvent(SKIP_BODY, deps);
    expect(ev).toEqual({
      id: "e-testid0000",
      ts: "2026-10-25T18:00:00.000Z",
      schema_v: 2,
      session_id: "sync-derived",
      item_id: "hn-999",
      item_url: undefined,
      source: undefined,
      edition_date: "2026-10-25",
      type: "skip",
      origin: "derived",
      confidence: 0.6,
      impressions: 2,
      seen_ms: 4200,
    } satisfies SkipEvent);
  });

  it("rejects confidence outside 0-1", () => {
    expect(() => validateSyncEvent({ ...SKIP_BODY, confidence: 1.5 }, deps)).toThrow("confidence");
  });

  it("rejects impressions < 1", () => {
    expect(() => validateSyncEvent({ ...SKIP_BODY, impressions: 0 }, deps)).toThrow("impressions");
  });

  it("rejects a non-sync- prefixed session (public path would let a human fake a derived skip)", () => {
    expect(() => validateSyncEvent({ ...SKIP_BODY, session_id: "sess-human" }, deps)).toThrow(
      "sync-",
    );
  });
});
