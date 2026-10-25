import { describe, expect, it } from "vitest";
import { READER_MAX_CHARS, parseReaderArticles } from "./reader.js";

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
});
