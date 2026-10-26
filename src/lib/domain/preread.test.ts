import { describe, expect, it } from "vitest";
import {
  PRE_READ_MAX_CHARS,
  PRE_READ_MIN_CHARS,
  PRE_READ_WPM,
  parsePreReads,
  preReadEligible,
  preReadWords,
  readingMinutes,
  validPreReadText,
} from "./preread.js";

const okText =
  "The piece argues that memory safety is a migration problem, not a rewrite problem. ".repeat(6); // well over PRE_READ_MIN_CHARS, plain prose

const valid = {
  edition_date: "2026-10-26",
  prereads: {
    "miniflux-1239": { text: okText, model: "glm-5.3-flash", generated_at: "2026-10-26T10:00:00Z" },
    "miniflux-1241": { text: okText },
  },
};

describe("preReadWords / readingMinutes", () => {
  it("counts whitespace-delimited words", () => {
    expect(preReadWords("one two three")).toBe(3);
    expect(preReadWords("  spaced \n\n out  words here ")).toBe(4);
    expect(preReadWords("")).toBe(0);
    expect(preReadWords("   ")).toBe(0);
  });

  it("derives the reading time from the word count at PRE_READ_WPM (never fixed)", () => {
    expect(readingMinutes("word ".repeat(PRE_READ_WPM))).toBe(1);
    expect(readingMinutes("word ".repeat(PRE_READ_WPM * 5))).toBe(5);
    // rounds, and never below one minute
    expect(readingMinutes("word ".repeat(40))).toBe(1);
    // 990 words = 4.5 min → rounds to 5
    expect(readingMinutes("word ".repeat(PRE_READ_WPM * 4 + PRE_READ_WPM / 2))).toBe(5);
  });

  it("matches the wpm constant contract", () => {
    expect(PRE_READ_WPM).toBe(220);
  });
});

describe("validPreReadText", () => {
  it("accepts text within the bounds", () => {
    expect(validPreReadText(okText)).toBe(true);
  });
  it("rejects non-strings, too-short, and over-cap text", () => {
    expect(validPreReadText(undefined)).toBe(false);
    expect(validPreReadText(42)).toBe(false);
    expect(validPreReadText("too short")).toBe(false);
    expect(validPreReadText("a".repeat(PRE_READ_MIN_CHARS - 1))).toBe(false);
    expect(validPreReadText("a".repeat(PRE_READ_MAX_CHARS + 1))).toBe(false);
  });
  it("bounds are ordered sensibly (a five-minute version fits between them)", () => {
    expect(PRE_READ_MIN_CHARS).toBeLessThan(PRE_READ_MAX_CHARS);
  });
});

describe("preReadEligible", () => {
  it("is true for wire items with extracted text", () => {
    expect(preReadEligible({ has_reader: true, section: "ai-at-work" })).toBe(true);
    expect(preReadEligible({ has_reader: true, section: "rust-os" })).toBe(true);
    expect(preReadEligible({ has_reader: true, section: "might-like" })).toBe(true);
  });
  it("is false for captured (Readeck) items — out of scope this round", () => {
    expect(preReadEligible({ has_reader: true, section: "captured" })).toBe(false);
  });
  it("is false when extraction failed (no reader text to ground in)", () => {
    expect(preReadEligible({ has_reader: false, section: "ai-at-work" })).toBe(false);
    expect(preReadEligible({ section: "ai-at-work" })).toBe(false);
  });
});

describe("parsePreReads", () => {
  it("accepts a well-formed prereads file", () => {
    const parsed = parsePreReads(valid);
    expect(parsed).not.toBeNull();
    expect(parsed?.edition_date).toBe("2026-10-26");
    expect(Object.keys(parsed?.prereads ?? {}).sort()).toEqual(["miniflux-1239", "miniflux-1241"]);
  });

  it("accepts an empty prereads map (nothing generated yet)", () => {
    const parsed = parsePreReads({ edition_date: "2026-10-26", prereads: {} });
    expect(parsed).not.toBeNull();
    expect(parsed?.prereads).toEqual({});
  });

  it("rejects non-objects, bad dates, and non-object maps", () => {
    expect(parsePreReads(null)).toBeNull();
    expect(parsePreReads("x")).toBeNull();
    expect(parsePreReads([])).toBeNull();
    expect(parsePreReads({ ...valid, edition_date: "2026-10-2" })).toBeNull();
    expect(parsePreReads({ ...valid, prereads: [] })).toBeNull();
  });

  it("rejects malformed entries (parsed, never trusted)", () => {
    expect(parsePreReads({ edition_date: "2026-10-26", prereads: { x: "string" } })).toBeNull();
    expect(parsePreReads({ edition_date: "2026-10-26", prereads: { x: { text: "" } } })).toBeNull();
    expect(
      parsePreReads({ edition_date: "2026-10-26", prereads: { x: { text: "short" } } }),
    ).toBeNull();
    expect(
      parsePreReads({
        edition_date: "2026-10-26",
        prereads: { x: { text: "a".repeat(PRE_READ_MAX_CHARS + 1) } },
      }),
    ).toBeNull();
  });

  it("rejects bad provenance fields but tolerates their absence", () => {
    expect(
      parsePreReads({ edition_date: "2026-10-26", prereads: { x: { text: okText, model: 7 } } }),
    ).toBeNull();
    expect(
      parsePreReads({
        edition_date: "2026-10-26",
        prereads: { x: { text: okText, generated_at: "" } },
      }),
    ).toBeNull();
    const parsed = parsePreReads({ edition_date: "2026-10-26", prereads: { x: { text: okText } } });
    expect(parsed?.prereads.x).toEqual({ text: okText });
  });

  it("keeps a corrupt file exactly equivalent to an absent one at the call site", () => {
    // any single bad entry invalidates the whole file — callers fall back to
    // "no pre-read tier", today's layout, per the reader.ts failure contract
    const corrupt = {
      edition_date: "2026-10-26",
      prereads: { a: { text: okText }, b: { text: null } },
    };
    expect(parsePreReads(corrupt)).toBeNull();
  });
});
