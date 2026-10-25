import { describe, expect, it } from "vitest";
import {
  MAX_DWELL_MS,
  validateDwell,
  validateSyncEvent,
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
});

describe("validateDwell — rejects garbage", () => {
  const cases: Array<[string, Record<string, unknown> | string]> = [
    ["missing url", { ...DWELL_BODY, url: "" }],
    ["zero dwell", { ...DWELL_BODY, dwell_ms: 0 }],
    ["negative dwell", { ...DWELL_BODY, dwell_ms: -5 }],
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
