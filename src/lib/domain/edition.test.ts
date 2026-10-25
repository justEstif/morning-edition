import { describe, expect, it } from "vitest";
import {
  editionItemIds,
  longDate,
  markFor,
  parseEdition,
  parseEditionItem,
  shapeEdition,
  type RawEdition,
} from "./edition.js";

const VALID = {
  edition_date: "2026-10-25",
  items: [
    {
      id: "readeck-1",
      title: "Lead story",
      url: "https://example.com/1",
      source: "readeck",
      section: "captured",
      kind: "captured",
      brief: "the lead",
      captured_at: "2026-10-24T10:00:00Z",
    },
    {
      id: "miniflux-2",
      title: "Second capture",
      url: "https://example.com/2",
      source: "miniflux",
      section: "captured",
      kind: "brief",
    },
    {
      id: "hn-3",
      title: "Suggestion",
      url: "https://example.com/3",
      source: "hn",
      section: "might-like",
      kind: "brief",
      shadow_score: 0.7, // builder-only field, tolerated
    },
  ],
};

describe("parseEditionItem", () => {
  it("accepts a well-formed item and tolerates unknown extra keys", () => {
    const item = parseEditionItem(VALID.items[2]);
    expect(item).not.toBeNull();
    expect(item!.id).toBe("hn-3");
  });

  it("rejects non-objects and missing/non-string required fields", () => {
    expect(parseEditionItem(null)).toBeNull();
    expect(parseEditionItem("x")).toBeNull();
    expect(parseEditionItem([])).toBeNull();
    expect(parseEditionItem({ ...VALID.items[0], title: 5 })).toBeNull();
    expect(parseEditionItem({ id: "x" })).toBeNull();
    expect(parseEditionItem({ ...VALID.items[0], brief: 9 })).toBeNull();
  });

  it("accepts explore metadata (flag + propensity) and keeps it on the item", () => {
    const item = parseEditionItem({
      ...VALID.items[2],
      explore_flag: true,
      propensity: { score: 0.4, why: "explore:unseen-source" },
    });
    expect(item).not.toBeNull();
    expect(item!.explore_flag).toBe(true);
    expect(item!.propensity).toEqual({ score: 0.4, why: "explore:unseen-source" });
  });

  it("rejects malformed explore metadata", () => {
    expect(parseEditionItem({ ...VALID.items[0], explore_flag: "yes" })).toBeNull();
    expect(parseEditionItem({ ...VALID.items[0], propensity: "high" })).toBeNull();
    expect(parseEditionItem({ ...VALID.items[0], propensity: { score: "0.4" } })).toBeNull();
    expect(parseEditionItem({ ...VALID.items[0], propensity: { score: NaN } })).toBeNull();
    expect(parseEditionItem({ ...VALID.items[0], propensity: { score: 0.4, why: 7 } })).toBeNull();
  });

  it("tolerates items without explore metadata (pre-R3 editions stay valid)", () => {
    expect(parseEditionItem(VALID.items[0])!.propensity).toBeUndefined();
    expect(parseEditionItem(VALID.items[0])!.explore_flag).toBeUndefined();
  });
});

describe("parseEdition", () => {
  it("accepts a valid raw edition (parsed, never trusted)", () => {
    const ed = parseEdition(VALID);
    expect(ed).not.toBeNull();
    expect(ed!.edition_date).toBe("2026-10-25");
    expect(ed!.items).toHaveLength(3);
  });

  it("rejects corrupt shapes", () => {
    expect(parseEdition(null)).toBeNull();
    expect(parseEdition("json")).toBeNull();
    expect(parseEdition({ items: [] })).toBeNull(); // no edition_date
    expect(parseEdition({ edition_date: "Oct 25 2026", items: [] })).toBeNull();
    expect(parseEdition({ edition_date: "2026-10-25", items: "nope" })).toBeNull();
    expect(parseEdition({ edition_date: "2026-10-25", items: [{ id: 1 }] })).toBeNull();
  });
});

describe("editionItemIds", () => {
  it("collects every presented id", () => {
    expect(editionItemIds(parseEdition(VALID)!)).toEqual(
      new Set(["readeck-1", "miniflux-2", "hn-3"]),
    );
  });
});

describe("shapeEdition", () => {
  it("locks section order, omits empty sections, picks the captured lead", () => {
    const shaped = shapeEdition(parseEdition(VALID));
    expect(shaped.date).toBe("2026-10-25");
    expect(shaped.lead!.id).toBe("readeck-1");
    expect(shaped.leadSide!.id).toBe("miniflux-2");
    expect(shaped.sections.map((s) => s.key)).toEqual(["might-like"]); // both captures consumed by lead + side well
    expect(shaped.itemCount).toBe(3);
    expect(shaped.dateLong).toBe(longDate("2026-10-25"));
    expect(shaped.glance).toContain("1 captures pinned");
  });

  it("returns the empty shape for null", () => {
    const shaped = shapeEdition(null);
    expect(shaped.date).toBe("");
    expect(shaped.lead).toBeNull();
    expect(shaped.sections).toEqual([]);
  });
});

describe("markFor", () => {
  it("uses the typographic marks; ✳︎ (VS15) wins for might-like", () => {
    expect(markFor({ ...VALID.items[0], kind: "captured" })).toEqual({
      mark: "❦",
      label: "Captured",
    });
    expect(markFor({ ...VALID.items[0], kind: "deep-read" }).mark).toBe("†");
    expect(markFor(VALID.items[2]).mark).toBe("✳\uFE0E");
    expect(markFor(VALID.items[2]).label).toBe("Brief"); // kind label rides along
  });
});

describe("edition round-trip", () => {
  it("a valid edition survives parse + shape unchanged in count", () => {
    const ed: RawEdition = parseEdition(VALID)!;
    expect(shapeEdition(ed).itemCount).toBe(ed.items.length);
  });
});
