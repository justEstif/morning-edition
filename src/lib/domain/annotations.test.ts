import { describe, expect, it } from "vitest";
import {
  MAX_QUOTE_CHARS,
  MIN_MARK_CHARS,
  paragraphSegments,
  paragraphSpans,
  reduceAnnotations,
  storeQuoteContext,
  validateAnnotation,
  verifyAnchor,
  type AnnotationRow,
} from "./annotations.js";

const deps = {
  now: () => "2026-10-26T12:00:00.000Z",
  newId: (() => {
    let n = 0;
    return () => `id-${++n}`;
  })(),
};

const TEXT =
  "Short lead.\n\nThis is the first real paragraph of the piece.\n\nAnd a closing one.\n\n\n\nTrailing after a fat separator.";

describe("paragraphSpans", () => {
  it("mirrors the renderer's split exactly while carrying offsets", () => {
    const spans = paragraphSpans(TEXT);
    expect(spans.map((s) => s.text)).toEqual(
      TEXT.split(/\n{2,}/)
        .map((p) => p.trim())
        .filter(Boolean),
    );
    // every span slice must reproduce its text from the ORIGINAL string
    for (const s of spans) expect(TEXT.slice(s.start, s.end)).toBe(s.text);
  });

  it("skips empty blocks and anchors at trimmed bounds", () => {
    const spans = paragraphSpans("A.\n\n   B core  \n\n\n\n\nC.");
    expect(spans).toEqual([
      { text: "A.", start: 0, end: 2 },
      { text: "B core", start: 7, end: 13 },
      { text: "C.", start: 20, end: 22 },
    ]);
  });

  it("handles a single paragraph with no separators", () => {
    expect(paragraphSpans("just one")).toEqual([{ text: "just one", start: 0, end: 8 }]);
  });
});

describe("verifyAnchor", () => {
  const text = "alpha beta gamma delta";
  it("passes when the stored text still says the quote at the offsets", () => {
    expect(verifyAnchor({ start: 6, end: 10, quote: "beta" }, text)).toEqual({ ok: true });
  });
  it("detects drift and reports where the quote wandered (read-only)", () => {
    const moved = "prefix alpha beta gamma delta";
    expect(verifyAnchor({ start: 0, end: 4, quote: "beta" }, moved)).toEqual({
      ok: false,
      drift: true,
      relocatedAt: 13,
    });
  });
  it("reports a vanished quote as drift with relocatedAt null", () => {
    expect(verifyAnchor({ start: 0, end: 4, quote: "omega" }, text)).toEqual({
      ok: false,
      drift: true,
      relocatedAt: null,
    });
  });
  it("never mutates anything — offsets stay as stored", () => {
    const mark = { start: 6, end: 10, quote: "beta" };
    verifyAnchor(mark, "totally other words");
    expect(mark).toEqual({ start: 6, end: 10, quote: "beta" });
  });
});

describe("reduceAnnotations", () => {
  const mark = (id: string): AnnotationRow => ({
    id,
    ts: "2026-10-26T12:00:00.000Z",
    schema_v: 1,
    type: "highlight",
    item_id: "readeck-x",
    edition_date: "2026-10-26",
    start: 0,
    end: 5,
    quote: "alpha",
  });

  it("attaches notes and comments to their highlight", () => {
    const views = reduceAnnotations([
      mark("a-1"),
      { id: "n-1", ts: "t", schema_v: 1, type: "note", target: "a-1", text: "short note" },
      { id: "c-1", ts: "t", schema_v: 1, type: "comment", target: "a-1", text: "longer comment" },
    ]);
    expect(views).toHaveLength(1);
    expect(views[0].notes.map((n) => n.text)).toEqual(["short note"]);
    expect(views[0].comments.map((c) => c.text)).toEqual(["longer comment"]);
  });

  it("retracts a highlight and drops its attachments (never orphaned)", () => {
    const views = reduceAnnotations([
      mark("a-1"),
      { id: "n-1", ts: "t", schema_v: 1, type: "note", target: "a-1", text: "note" },
      { id: "d-1", ts: "t", schema_v: 1, type: "retract", target: "a-1" },
    ]);
    expect(views).toHaveLength(0);
  });

  it("drops attachments that target an unknown id", () => {
    const views = reduceAnnotations([
      mark("a-2"),
      { id: "n-9", ts: "t", schema_v: 1, type: "note", target: "a-ghost", text: "x" },
    ]);
    expect(views).toHaveLength(1);
    expect(views[0].notes).toHaveLength(0);
  });

  it("is idempotent over repeated retracts and re-reductions", () => {
    const rows: AnnotationRow[] = [
      mark("a-1"),
      { id: "d-1", ts: "t", schema_v: 1, type: "retract", target: "a-1" },
      { id: "d-2", ts: "t", schema_v: 1, type: "retract", target: "a-1" },
    ];
    expect(reduceAnnotations(rows)).toEqual([]);
    expect(reduceAnnotations(rows)).toEqual([]);
  });
});

describe("paragraphSegments", () => {
  const para = { start: 100, end: 130, text: "the quick brown fox jumps" };
  it("renders an unmarked paragraph as one plain segment", () => {
    expect(paragraphSegments(para, [])).toEqual([{ text: para.text, markId: null }]);
  });
  it("slices around a mark", () => {
    // "the quick brown fox jumps" with "quick" marked (abs 104..109)
    expect(paragraphSegments(para, [{ id: "m1", start: 104, end: 109 }])).toEqual([
      { text: "the ", markId: null },
      { text: "quick", markId: "m1" },
      { text: " brown fox jumps", markId: null },
    ]);
  });
  it("clips marks that spill across the paragraph bounds", () => {
    expect(paragraphSegments(para, [{ id: "m1", start: 90, end: 105 }])).toEqual([
      { text: "the q", markId: "m1" },
      { text: "uick brown fox jumps", markId: null },
    ]);
  });
  it("ignores marks outside the paragraph and drops overlaps (earlier wins)", () => {
    const segs = paragraphSegments(para, [
      { id: "outside", start: 0, end: 50 },
      { id: "m1", start: 100, end: 110 },
      { id: "overlap", start: 105, end: 115 },
    ]);
    expect(segs).toEqual([
      { text: "the quick ", markId: "m1" },
      { text: "brown fox jumps", markId: null },
    ]);
  });
});

describe("validateAnnotation", () => {
  it("accepts an offset-only highlight (no client words)", () => {
    const row = validateAnnotation(
      { type: "highlight", item_id: "readeck-x", edition_date: "2026-10-26", start: 10, end: 40 },
      deps,
    );
    expect(row).toMatchObject({ type: "highlight", start: 10, end: 40, quote: "" });
    expect(row.id).toBe("id-1");
    expect(row.ts).toBe("2026-10-26T12:00:00.000Z");
  });
  it("rejects degenerate marks below MIN_MARK_CHARS", () => {
    expect(() =>
      validateAnnotation(
        {
          type: "highlight",
          item_id: "x",
          edition_date: "2026-10-26",
          start: 10,
          end: 10 + MIN_MARK_CHARS - 1,
        },
        deps,
      ),
    ).toThrow(/end must be/);
  });
  it("rejects non-integer or negative offsets", () => {
    expect(() =>
      validateAnnotation(
        { type: "highlight", item_id: "x", edition_date: "2026-10-26", start: -1, end: 10 },
        deps,
      ),
    ).toThrow(/start/);
    expect(() =>
      validateAnnotation(
        { type: "highlight", item_id: "x", edition_date: "2026-10-26", start: 1.5, end: 10 },
        deps,
      ),
    ).toThrow(/start/);
  });
  it("rejects a bad edition date and unknown types", () => {
    expect(() =>
      validateAnnotation(
        { type: "highlight", item_id: "x", edition_date: "oct 26", start: 0, end: 9 },
        deps,
      ),
    ).toThrow(/edition_date/);
    expect(() => validateAnnotation({ type: "star", target: "a-1" }, deps)).toThrow(/type must be/);
  });
  it("note/comment require bounded text; retract needs only a target", () => {
    expect(() => validateAnnotation({ type: "note", target: "a-1", text: "" }, deps)).toThrow(
      /text/,
    );
    expect(() =>
      validateAnnotation(
        { type: "note", target: "a-1", text: "y".repeat(MAX_QUOTE_CHARS + 1) },
        deps,
      ),
    ).not.toThrow();
    expect(validateAnnotation({ type: "retract", target: "a-1" }, deps)).toMatchObject({
      type: "retract",
      target: "a-1",
    });
  });
});

describe("storeQuoteContext", () => {
  it("slices quote + context from the STORED text, overwriting the client's nothing", () => {
    const text = "0123456789".repeat(30); // 300 chars
    const row = validateAnnotation(
      { type: "highlight", item_id: "x", edition_date: "2026-10-26", start: 100, end: 105 },
      deps,
    );
    storeQuoteContext(row, text);
    expect((row as { quote: string }).quote).toBe(text.slice(100, 105));
    // default context = MAX_CONTEXT_CHARS, clamped at the text's edges
    expect((row as { prefix?: string }).prefix).toBe(text.slice(0, 100));
    expect((row as { suffix?: string }).suffix).toBe(text.slice(105, 300));
  });
  it("honors a smaller context window when asked", () => {
    const text = "0123456789".repeat(30);
    const row = validateAnnotation(
      { type: "highlight", item_id: "x", edition_date: "2026-10-26", start: 100, end: 105 },
      deps,
    );
    storeQuoteContext(row, text, 20);
    expect((row as { prefix?: string }).prefix).toBe(text.slice(80, 100));
    expect((row as { suffix?: string }).suffix).toBe(text.slice(105, 125));
  });
  it("throws when the offsets fall outside the stored text", () => {
    const row = validateAnnotation(
      { type: "highlight", item_id: "x", edition_date: "2026-10-26", start: 0, end: 10 },
      deps,
    );
    expect(() => storeQuoteContext(row, "short")).toThrow(/past end of stored text/);
  });
  it("leaves non-highlight rows untouched", () => {
    const row = validateAnnotation({ type: "note", target: "a-1", text: "x" }, deps);
    storeQuoteContext(row, "whatever");
    expect(row).not.toHaveProperty("quote");
  });
});
