import { describe, expect, it } from "vitest";
import {
  READER_MAX_CHARS,
  TRUNCATION_NOTE,
  parseReaderArticles,
  readerGate,
  truncateForReader,
} from "./reader.js";

const valid = {
  edition_date: "2026-10-25",
  articles: {
    "miniflux-1219": { url: "https://example.com/a", text: "Paragraph one.\n\nParagraph two." },
    "readeck-abc": { url: "https://example.com/b", text: "A captured piece.".repeat(50) },
  },
};

describe("parseReaderArticles", () => {
  it("accepts a well-formed reader-articles file", () => {
    const parsed = parseReaderArticles(valid);
    expect(parsed).not.toBeNull();
    expect(parsed?.edition_date).toBe("2026-10-25");
    expect(Object.keys(parsed?.articles ?? {}).sort()).toEqual(["miniflux-1219", "readeck-abc"]);
  });

  it("accepts an empty articles map (every extraction failed — all fallbacks)", () => {
    const parsed = parseReaderArticles({ edition_date: "2026-10-25", articles: {} });
    expect(parsed).not.toBeNull();
    expect(parsed?.articles).toEqual({});
  });

  it("rejects non-objects, bad dates, and non-object article maps", () => {
    expect(parseReaderArticles(null)).toBeNull();
    expect(parseReaderArticles("x")).toBeNull();
    expect(parseReaderArticles([])).toBeNull();
    expect(parseReaderArticles({ ...valid, edition_date: "2026-2-5" })).toBeNull();
    expect(parseReaderArticles({ ...valid, articles: [] })).toBeNull();
  });

  it("rejects malformed article entries (parsed, never trusted)", () => {
    expect(
      parseReaderArticles({ edition_date: "2026-10-25", articles: { x: "string" } }),
    ).toBeNull();
    expect(
      parseReaderArticles({ edition_date: "2026-10-25", articles: { x: { url: "", text: "t" } } }),
    ).toBeNull();
    expect(
      parseReaderArticles({
        edition_date: "2026-10-25",
        articles: { x: { url: "https://a.b", text: "" } },
      }),
    ).toBeNull();
  });

  it("rejects text over the reader cap (corrupt file, not a longer article)", () => {
    const huge = "a".repeat(READER_MAX_CHARS + 1);
    expect(
      parseReaderArticles({
        edition_date: "2026-10-25",
        articles: { x: { url: "https://a.b", text: huge } },
      }),
    ).toBeNull();
  });

  it("accepts text at exactly the cap", () => {
    const at = "a".repeat(READER_MAX_CHARS);
    expect(
      parseReaderArticles({
        edition_date: "2026-10-25",
        articles: { x: { url: "https://a.b", text: at } },
      }),
    ).not.toBeNull();
  });

  it("accepts a digest on an entry and keeps it (card t_b3782402)", () => {
    const parsed = parseReaderArticles({
      edition_date: "2026-10-25",
      articles: {
        x: { url: "https://a.b", text: "thin text", digest: "A short, honest digest." },
        y: { url: "https://c.d", text: "full text" }, // digest stays optional
      },
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.articles.x?.digest).toBe("A short, honest digest.");
    expect(parsed?.articles.y?.digest).toBeUndefined();
  });

  it("rejects a malformed digest (empty, whitespace, oversized)", () => {
    for (const digest of ["", "   ", "d".repeat(READER_MAX_CHARS + 1)]) {
      expect(
        parseReaderArticles({
          edition_date: "2026-10-25",
          articles: { x: { url: "https://a.b", text: "t", digest } },
        }),
      ).toBeNull();
    }
  });
});

/* Reader quality gate (card t_b3782402): seeded decisions — full → digest →
   wire-note, each tier honest about how much the source gave. */
describe("readerGate", () => {
  const THIN = 1_500;

  it("a 400-char extraction with a digest → digest mode (seeded)", () => {
    const text = "w".repeat(400);
    const gate = readerGate(text, "A grounded two-sentence digest of the fragment.", THIN);
    expect(gate).toEqual({
      has_reader: true,
      reader_mode: "digest",
      digest: "A grounded two-sentence digest of the fragment.",
      store: true,
    });
  });

  it("a thin extraction whose digest is longer than the source is not compression — wire-note tier", () => {
    const gate = readerGate("w".repeat(400), "d".repeat(400), THIN);
    expect(gate).toEqual({ has_reader: false, store: false });
  });

  it("a 4,000-char extraction → full mode, unchanged (seeded)", () => {
    const gate = readerGate("w".repeat(4_000), "an ignored digest", THIN);
    expect(gate).toEqual({ has_reader: true, store: true });
    expect(gate.reader_mode).toBeUndefined();
  });

  it("a thin extraction with NO digest → wire-note tier (never a hollow article)", () => {
    expect(readerGate("w".repeat(400), undefined, THIN)).toEqual({
      has_reader: false,
      store: false,
    });
    expect(readerGate("w".repeat(400), "   ", THIN)).toEqual({ has_reader: false, store: false });
  });

  it("no extracted text → wire-note tier, exactly as before (seeded)", () => {
    expect(readerGate(undefined, "digest", THIN)).toEqual({ has_reader: false, store: false });
  });

  it("the threshold is inclusive: text at exactly thinChars is full", () => {
    expect(readerGate("w".repeat(THIN), undefined, THIN)).toEqual({
      has_reader: true,
      store: true,
    });
  });
});

describe("truncateForReader (card t_5c435af7, copied to the shared domain)", () => {
  it("passes short text through untouched", () => {
    const t = "Para one.\n\nPara two.";
    expect(truncateForReader(t, READER_MAX_CHARS)).toEqual({ text: t, truncated: false });
  });

  it("cuts at a paragraph boundary and appends the note, within the cap", () => {
    const paras = Array.from({ length: 500 }, (_, i) => `Paragraph ${i} ${"word ".repeat(30)}`);
    const text = paras.join("\n\n");
    const res = truncateForReader(text, READER_MAX_CHARS);
    expect(res.truncated).toBe(true);
    expect(res.text.length).toBeLessThanOrEqual(READER_MAX_CHARS);
    expect(res.text.endsWith(TRUNCATION_NOTE)).toBe(true);
    const body = res.text.slice(0, res.text.length - TRUNCATION_NOTE.length - 2);
    expect(text.startsWith(body)).toBe(true);
    expect(/^\s*\n\n/.test(text.slice(body.length))).toBe(true);
  });

  it("falls back to a word boundary when there is no paragraph break", () => {
    const wall = `${"word ".repeat(40_000)}end`;
    const res = truncateForReader(wall, READER_MAX_CHARS);
    expect(res.truncated).toBe(true);
    expect(res.text.length).toBeLessThanOrEqual(READER_MAX_CHARS);
    expect(res.text.endsWith(TRUNCATION_NOTE)).toBe(true);
    const body = res.text.slice(0, res.text.length - TRUNCATION_NOTE.length - 2);
    expect(/\S$/.test(body)).toBe(true); // never cuts mid-word
  });
});
