import { describe, expect, it } from "vitest";
import {
  assignTiers,
  editionItemIds,
  longDate,
  markFor,
  parseEdition,
  parseEditionItem,
  shapeEdition,
  type EditionItem,
  type RawEdition,
} from "./edition.js";

const VALID: { edition_date: string; items: Array<EditionItem & Record<string, unknown>> } = {
  edition_date: "2026-10-25",
  items: [
    {
      id: "readeck-1",
      title: "Lead story",
      url: "https://example.com/1",
      source: "readeck",
      section: "captured",
      kind: "captured",
      tier: "lead",
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
      tier: "secondary",
    },
    {
      id: "hn-3",
      title: "Suggestion",
      url: "https://example.com/3",
      source: "hn",
      section: "might-like",
      kind: "brief",
      tier: "brief",
      shadow_score: 0.7, // builder-only field, tolerated
    },
  ],
};

describe("parseEditionItem", () => {
  it("accepts a well-formed item and tolerates unknown extra keys", () => {
    const item = parseEditionItem(VALID.items[2]);
    expect(item).not.toBeNull();
    expect(item!.id).toBe("hn-3");
    expect(item!.tier).toBe("brief");
  });

  it("accepts original_title (feed-title provenance, t_21c0c195) and rejects a non-string", () => {
    const withProvenance = parseEditionItem({
      ...VALID.items[0],
      original_title: "Raw feed title",
    });
    expect(withProvenance).not.toBeNull();
    expect(withProvenance!.original_title).toBe("Raw feed title");
    expect(parseEditionItem({ ...VALID.items[0], original_title: 42 })).toBeNull();
    // absence stays valid — the schema change is additive
    expect(parseEditionItem(VALID.items[0])).not.toBeNull();
  });

  it("accepts skim_summary (AI skim merge, t_1e178af7) and rejects a non-string", () => {
    const withSummary = parseEditionItem({
      ...VALID.items[0],
      skim_summary: "- bullet one\n- bullet two",
    });
    expect(withSummary).not.toBeNull();
    expect(withSummary!.skim_summary).toBe("- bullet one\n- bullet two");
    expect(parseEditionItem({ ...VALID.items[0], skim_summary: 7 })).toBeNull();
    // absence stays valid — most items were never skimmed
    expect(parseEditionItem(VALID.items[0])).not.toBeNull();
  });

  it("rejects non-objects and missing/non-string required fields", () => {
    expect(parseEditionItem(null)).toBeNull();
    expect(parseEditionItem("x")).toBeNull();
    expect(parseEditionItem([])).toBeNull();
    expect(parseEditionItem({ ...VALID.items[0], title: 5 })).toBeNull();
    expect(parseEditionItem({ id: "x" })).toBeNull();
    expect(parseEditionItem({ ...VALID.items[0], brief: 9 })).toBeNull();
  });

  it("REJECTS a missing or unknown tier (required since the broadsheet amendment)", () => {
    const tierless: Record<string, unknown> = { ...VALID.items[0] };
    delete tierless.tier;
    expect(parseEditionItem(tierless)).toBeNull();
    expect(parseEditionItem({ ...VALID.items[0], tier: "splash" })).toBeNull();
    expect(parseEditionItem({ ...VALID.items[0], tier: 3 })).toBeNull();
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

  it("accepts has_reader (in-paper reader flag) and keeps it on the item", () => {
    const item = parseEditionItem({ ...VALID.items[0], has_reader: true });
    expect(item).not.toBeNull();
    expect(item!.has_reader).toBe(true);
    expect(parseEditionItem({ ...VALID.items[1], has_reader: false })!.has_reader).toBe(false);
  });

  it("rejects a non-boolean has_reader and tolerates its absence (pre-reader editions)", () => {
    expect(parseEditionItem({ ...VALID.items[0], has_reader: "yes" })).toBeNull();
    expect(parseEditionItem(VALID.items[0])!.has_reader).toBeUndefined();
  });

  it("accepts reader_mode:'digest' and keeps it (card t_b3782402)", () => {
    const item = parseEditionItem({ ...VALID.items[0], reader_mode: "digest" });
    expect(item).not.toBeNull();
    expect(item!.reader_mode).toBe("digest");
  });

  it("rejects any reader_mode other than 'digest' and tolerates its absence (full mode)", () => {
    expect(parseEditionItem({ ...VALID.items[0], reader_mode: "full" })).toBeNull();
    expect(parseEditionItem({ ...VALID.items[0], reader_mode: 1 })).toBeNull();
    expect(parseEditionItem(VALID.items[0])!.reader_mode).toBeUndefined();
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

  it("rejects a legacy tierless edition (the builder is the only writer)", () => {
    const legacy = {
      edition_date: "2026-10-24",
      items: VALID.items.map((it) => {
        const row: Record<string, unknown> = { ...it };
        delete row.tier;
        return row;
      }),
    };
    expect(parseEdition(legacy)).toBeNull();
  });
});

describe("assignTiers", () => {
  it("first item per section is lead, next three secondary, rest briefs", () => {
    const mk = (id: string, section: string): EditionItem => ({
      id,
      title: id,
      url: `https://example.com/${id}`,
      source: "hn",
      section,
      kind: "brief",
      tier: "brief",
    });
    const items = [
      mk("a", "rust-os"),
      mk("b", "rust-os"),
      mk("c", "rust-os"),
      mk("d", "rust-os"),
      mk("e", "rust-os"),
      mk("f", "rust-os"),
      mk("g", "ai-at-work"),
    ];
    const tiers = Object.fromEntries(assignTiers(items).map((i) => [i.id, i.tier]));
    expect(tiers).toEqual({
      a: "lead",
      b: "secondary",
      c: "secondary",
      d: "secondary",
      e: "brief",
      f: "brief",
      g: "lead", // per-section: one lead each, however small the section
    });
  });

  it("is pure — input items are not mutated, order is preserved", () => {
    const mk = (id: string): EditionItem => ({
      id,
      title: id,
      url: "https://example.com/x",
      source: "hn",
      section: "rust-os",
      kind: "brief",
      tier: "brief",
    });
    const items = [mk("a"), mk("b")];
    const out = assignTiers(items);
    expect(items.map((i) => i.tier)).toEqual(["brief", "brief"]);
    expect(out.map((i) => i.id)).toEqual(["a", "b"]);
    expect(out[0].tier).toBe("lead");
    expect(out[0]).not.toBe(items[0]);
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

  it("partitions each section by tier (sectionLead/secondary/briefs)", () => {
    const ed: RawEdition = parseEdition({
      edition_date: "2026-10-25",
      items: [
        { ...VALID.items[2], id: "m1", tier: "lead" },
        { ...VALID.items[2], id: "m2", tier: "secondary" },
        { ...VALID.items[2], id: "m3", tier: "secondary" },
        { ...VALID.items[2], id: "m4", tier: "brief" },
      ],
    })!;
    const shaped = shapeEdition(ed);
    expect(shaped.lead!.id).toBe("m1"); // first tier-lead in SECTION_ORDER... might-like is last; captured empty
    const ml = shaped.sections.find((s) => s.key === "might-like")!;
    expect(ml.sectionLead!.id).toBe("m1");
    expect(ml.secondary.map((i) => i.id)).toEqual(["m2", "m3"]);
    expect(ml.briefs.map((i) => i.id)).toEqual(["m4"]);
    // items stays the full partition source, priority order
    expect(ml.items.map((i) => i.id)).toEqual(["m1", "m2", "m3", "m4"]);
  });

  it("the page lead is the first tier-lead in section order, not merely the first item", () => {
    const ed: RawEdition = parseEdition({
      edition_date: "2026-10-25",
      items: [
        { ...VALID.items[2], id: "rust-brief", section: "rust-os", tier: "brief" },
        { ...VALID.items[2], id: "might-lead", section: "might-like", tier: "lead" },
      ],
    })!;
    expect(shapeEdition(ed).lead!.id).toBe("might-lead");
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
