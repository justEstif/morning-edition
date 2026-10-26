import { describe, expect, it } from "vitest";
import {
  acceptRewrittenHeadline,
  applyEditorialTitle,
  briefRestatesHeadline,
  inspectFeedTitle,
} from "./headlines.js";

describe("inspectFeedTitle", () => {
  it("flags the known-bad shapes the pass exists to fix", () => {
    expect(inspectFeedTitle("https://example.com/story/12345").broken).toBe(true);
    expect(inspectFeedTitle("https://example.com/story/12345").reason).toContain("URL");
    expect(inspectFeedTitle("RUST 1.90 SHIPS ASYNC CLOSURES AND EVERYONE WINS TODAY").broken).toBe(
      true,
    );
    expect(inspectFeedTitle("The Verge: Something Happened Somewhere Today").broken).toBe(true);
    expect(
      inspectFeedTitle(
        "A very long headline that keeps going well past the ninety character budget agreed on the card and still has more to say",
      ).broken,
    ).toBe(true);
  });

  it("passes clean house-register titles and legit subtitle colons", () => {
    expect(inspectFeedTitle("Postgres 18: the release notes are the feature").broken).toBe(false);
    expect(inspectFeedTitle("io_uring: where it breaks in production").broken).toBe(false);
    expect(inspectFeedTitle("Async Rust, two years in").broken).toBe(false);
    // acronyms don't trip the ALL-CAPS flag on an otherwise normal title
    expect(inspectFeedTitle("The LLM benchmark that actually predicts rework").broken).toBe(false);
  });
});

describe("acceptRewrittenHeadline", () => {
  const FEED = "https://example.com/spam";

  it("accepts a clean rewrite of a broken feed title", () => {
    const v = acceptRewrittenHeadline(FEED, "The quiet return of the mechanical watch");
    expect(v.ok).toBe(true);
  });

  it("rejects junk rewrites: URL, ALL-CAPS, site prefix, sprawl, echo", () => {
    expect(acceptRewrittenHeadline(FEED, "https://example.com/again").ok).toBe(false);
    expect(acceptRewrittenHeadline(FEED, "THIS HEADLINE SHOUTS AT EVERY READER TODAY").ok).toBe(
      false,
    );
    expect(acceptRewrittenHeadline(FEED, "TechCrunch: A Headline Wearing A Prefix").ok).toBe(false);
    expect(
      acceptRewrittenHeadline(
        FEED,
        "A headline so long it carries its own subtitle two clauses deep and still keeps going well past every budget",
      ).ok,
    ).toBe(false);
    expect(acceptRewrittenHeadline("Existing title", "Existing title").ok).toBe(false);
    expect(acceptRewrittenHeadline(FEED, "Too short").ok).toBe(false);
  });
});

describe("applyEditorialTitle — the seeded acceptance test (card t_21c0c195)", () => {
  const rewritten = (title: string, headline: string | undefined, hasText: boolean) =>
    applyEditorialTitle({ id: "x-1", title, hasText }, headline);

  it("known-bad titles + extracted text -> rewritten headline; original_title preserved", () => {
    for (const feed of [
      "https://example.com/story/9999",
      "RUST 1.90 SHIPS ASYNC CLOSURES AND EVERYONE WINS TODAY",
      "Ars Technica: The Story Behind The Story Today",
    ]) {
      const dec = rewritten(feed, "A clean headline grounded in the article", true);
      expect(dec.applied).toBe(true);
      expect(dec.title).toBe("A clean headline grounded in the article");
      expect(dec.original_title).toBe(feed);
    }
  });

  it("extraction-failed item keeps the feed title — never rewrite from title alone", () => {
    const feed = "https://example.com/paywalled";
    const dec = rewritten(feed, "A perfectly good headline that must not be used", false);
    expect(dec.applied).toBe(false);
    expect(dec.title).toBe(feed);
    expect(dec.original_title).toBe(feed);
    expect(dec.reason).toContain("never rewrite from title alone");
  });

  it("a junk rewrite falls back to the feed title with a loud reason", () => {
    const dec = rewritten("Plain feed title", "https://example.com/lazy", true);
    expect(dec.applied).toBe(false);
    expect(dec.title).toBe("Plain feed title");
    expect(dec.reason).toContain("rewrite rejected");
  });

  it("no headline proposal keeps the feed title (rewriter declined)", () => {
    const dec = rewritten("Plain feed title", undefined, true);
    expect(dec.applied).toBe(false);
    expect(dec.title).toBe("Plain feed title");
  });

  it("backfills original_title from the title when the classification predates the field", () => {
    const dec = applyEditorialTitle(
      { id: "x-2", title: "Old edition item", hasText: false },
      undefined,
    );
    expect(dec.original_title).toBe("Old edition item");
  });
});

describe("briefRestatesHeadline — the complementary-pair rule", () => {
  const HEADLINE = "The quiet return of the mechanical watch";

  it("flags a brief that merely re-phrases the headline", () => {
    const brief =
      "The mechanical watch is quietly making a return. Watches are coming back because the quiet mechanical watch repair culture endures.";
    expect(briefRestatesHeadline(HEADLINE, brief)).toBe(true);
  });

  it("passes a brief that shares the subject but adds substance + takeaway", () => {
    // shares 3 of the headline's 4 content words (mechanical, watch, return)
    // — below the restating floor, because the brief adds the takeaway
    const brief =
      "Repair benches report months-long waiting lists, and the return concentrates in heirloom pieces where a full service costs less than replacement. Mechanical watch ownership now implies a maintenance calendar, not a drawer.";
    expect(briefRestatesHeadline(HEADLINE, brief)).toBe(false);
  });

  it("passes a brief that complements the headline with substance + takeaway", () => {
    const brief =
      "Repair benches report waiting lists measured in months as owners choose servicing over replacement. The craft's economics only work above a certain price point, which is why the revival concentrated in heirloom pieces.";
    expect(briefRestatesHeadline(HEADLINE, brief)).toBe(false);
  });

  it("is silent when the headline has too few content words to judge", () => {
    expect(briefRestatesHeadline("It happened again", "Anything at all. Second sentence.")).toBe(
      false,
    );
  });
});
