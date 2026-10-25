/* Unit tests for the builder's title-normalization rule (card t_e9c6b1cc):
   no raw URL ever renders as a headline. */
import { describe, expect, it } from "vitest";
import { normalizeTitle } from "./build_edition.js";

const base = { url: "https://example.com/a", source: "miniflux" };

describe("normalizeTitle (card t_e9c6b1cc)", () => {
  it("passes a real title through untouched", () => {
    expect(normalizeTitle({ ...base, title: "Digital hygiene" })).toBe("Digital hygiene");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeTitle({ ...base, title: "  Digital hygiene  " })).toBe("Digital hygiene");
  });

  it("strips a bare tracking URL appended at the end of a real title", () => {
    expect(
      normalizeTitle({ ...base, title: "A lot of it can be read at https://t.co/ExDoCqmxdk" }),
    ).toBe("A lot of it can be read at");
  });

  it("strips a trailing x.com/i/article link with X's ` / X` attribution tail", () => {
    expect(
      normalizeTitle({
        ...base,
        title: 'Tristan on X: "hot mic, geolocation https://t.co/ExDoCqmxdk" / X',
      }),
    ).toBe('Tristan on X: "hot mic, geolocation');
  });

  it("keeps URLs that are not at the end of the title", () => {
    expect(
      normalizeTitle({ ...base, title: "Tunnel https://a.example to https://b.example today" }),
    ).toBe("Tunnel https://a.example to https://b.example today");
  });

  it("synthesizes from the first sentence of the brief when the title is a bare URL", () => {
    expect(
      normalizeTitle({
        ...base,
        title: "https://x.com/i/article/2114385531811319808",
        brief: "Samsung TVs ship an always-on hot mic. The rest is profiling.",
      }),
    ).toBe("Samsung TVs ship an always-on hot mic");
  });

  it("synthesizes '{source} · {domain}' when there is no brief", () => {
    expect(
      normalizeTitle({
        url: "https://x.com/i/article/2114385531811319808",
        source: "miniflux",
        title: "https://x.com/i/article/2114385531811319808",
      }),
    ).toBe("miniflux · x.com");
  });

  it("synthesizes '{source} · {domain}' for empty and whitespace titles", () => {
    expect(normalizeTitle({ ...base, title: "" })).toBe("miniflux · example.com");
    expect(normalizeTitle({ ...base, title: "   " })).toBe("miniflux · example.com");
  });

  it("strips www. from the synthesized domain", () => {
    expect(
      normalizeTitle({
        url: "https://www.theverge.com/gadgets/x",
        source: "hn",
        title: "https://t.co/x",
      }),
    ).toBe("hn · theverge.com");
  });

  it("caps a long synthesized first sentence on a word boundary", () => {
    const long =
      "A tongue-in-cheek Ask HN asks whether everyone is recreating popular apps in Rust now, and the answers are the real content of the thread today.";
    const out = normalizeTitle({
      ...base,
      title: "https://t.co/x",
      brief: `${long} Second sentence.`,
    });
    expect(out.length).toBeLessThanOrEqual(81); // 80 chars + ellipsis
    expect(out.endsWith("\u2026")).toBe(true);
  });

  it("is deterministic: same input, same output", () => {
    const item = { ...base, title: "https://t.co/x", brief: "First sentence here. Second." };
    expect(normalizeTitle(item)).toBe(normalizeTitle(item));
  });
});
