/* Domain — Edition.
   Pure types + validators + shaping for the edition JSON the builder emits.
   Zero I/O, zero framework imports, zero node builtins (architecture rule:
   src/lib/domain imports nothing outward — see src/lib/domain/ports.ts for
   the seams adapters implement).

   The builder (pipeline, TypeScript, builder/build_edition.ts) is the source of truth; edition
   JSON read from disk or over HTTP is parsed, never trusted — parseEdition
   is the only sanctioned way to turn raw JSON into an Edition.

   Locked rules (parent card t_05ddeae1): section order captured → rust-os →
   ai-at-work → might-like; empty sections omitted; first captured item is the
   lead feature; marks are typographic only: † deep read, ‡ brief, ❦ captured,
   ✳ suggested (might-like items); shadow_score is never rendered.

   Broadsheet hierarchy (card t_6000c019, scope amendment: no backward
   compatibility): every item carries a REQUIRED `tier` — "lead" | "secondary"
   | "brief". The builder is the only writer (assignTiers); the validator
   rejects missing or unknown tiers, so legacy tierless editions no longer
   parse. The edition-wide page lead is the first tier-lead in SECTION_ORDER. */

/** ISO calendar date, "YYYY-MM-DD". */
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Presentation tiers, in descending prominence. */
export const TIERS = ["lead", "secondary", "brief"] as const;
export type Tier = (typeof TIERS)[number];

/** Why-shown metadata riding every edition item (research R3): the rubric
 *  score at presentation time + why it was shown ("rubric", or the explore
 *  reason for explore slots). Data-only — nothing renders it. */
export interface ItemPropensity {
  score: number;
  why?: string;
}

/** One item as it appears in raw edition JSON (builder output). */
export interface EditionItem {
  id: string;
  title: string;
  url: string;
  source: string;
  section: string;
  kind: string;
  /** Broadsheet prominence (required since t_6000c019 amendment): the
   *  builder assigns it deterministically; parse rejects absence. */
  tier: Tier;
  brief?: string;
  captured_at?: string;
  /** Explore-slot marker (research R3, shadow-mode): data only, never
   *  rendered — the paper must not feel like an algorithm apologizing. */
  explore_flag?: boolean;
  /** Why-shown log: rubric score + reason, on every item. */
  propensity?: ItemPropensity;
  /** In-paper reader (card t_f06c164b): true when the pipeline extracted the
   *  item's full article text (reader-articles.json) — the paper's item links
   *  point at /read/<id> instead of the external URL. Absent → external link
   *  (the pre-reader behavior; extraction failures fall back gracefully). */
  has_reader?: boolean;
  /** Reader quality gate (card t_b3782402): "digest" when the extraction came
   *  back THIN — the /read page leads with the paper's LLM digest (labeled,
   *  marginalia register) and demotes the raw extract below the fold. Absent
   *  → full mode, unchanged. Set by the builder only; parsed, never trusted. */
  reader_mode?: "digest";
  /** Editorial provenance (card t_21c0c195): the feed title as fetched, kept
   *  beside the co-written headline the page displays. The fallback source
   *  for owner-mode revert (v2, t_e86490c0) and the anchor of the per-edition
   *  rewrite audit log (headline-rewrites.json). Present on every item the
   *  pipeline builds; parse rejects a non-string, never its absence (older
   *  editions stay valid — the change is additive, ids stable). */
  original_title?: string;
}

/** Raw edition JSON written by the builder. */
export interface RawEdition {
  edition_date: string;
  items: EditionItem[];
}

/** Deterministic tier assignment (card t_6000c019 — dumb, no ML): within
 *  each section, counting in array order, the first item is that section's
 *  lead, the next three are secondary, the rest are briefs. Pure — returns
 *  NEW items in the input order; never mutates. The edition-wide page lead
 *  is the first tier-lead in SECTION_ORDER (captured pins first). */
export function assignTiers(items: EditionItem[]): EditionItem[] {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const n = seen.get(item.section) ?? 0;
    seen.set(item.section, n + 1);
    const tier: Tier = n === 0 ? "lead" : n <= 3 ? "secondary" : "brief";
    return { ...item, tier };
  });
}

/** A shaped section for rendering (empty sections omitted by shapeEdition).
 *  items is the full section in priority order; sectionLead/secondary/
 *  briefs are the same items partitioned by tier for the broadsheet layout. */
export interface ShapedSection {
  key: string;
  title: string;
  items: EditionItem[];
  sectionLead: EditionItem | null;
  secondary: EditionItem[];
  briefs: EditionItem[];
}

/** Edition JSON shaped for rendering — shapeEdition's return shape. */
export interface ShapedEdition {
  date: string;
  dateLong: string;
  lead: EditionItem | null;
  leadSide: EditionItem | null;
  glance: string;
  sections: ShapedSection[];
  itemCount: number;
}

/** markFor output: typographic mark + label. */
export interface MarkInfo {
  mark: string;
  label: string;
}

export const SECTION_ORDER = ["captured", "rust-os", "ai-at-work", "might-like"];

export const SECTION_TITLES: Record<string, string> = {
  captured: "Captured",
  "rust-os": "Rust & Operating Systems",
  "ai-at-work": "AI at Work",
  "might-like": "Might Like — Outside Your Usual Topics",
};

const MARKS: Record<string, string> = { "deep-read": "†", brief: "‡", captured: "❦" };
const LABELS: Record<string, string> = {
  "deep-read": "Deep read",
  brief: "Brief",
  captured: "Captured",
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Validate one edition item (parsed wire JSON → EditionItem | null).
 *  Required string fields: id, title, url, source, section, kind, tier
 *  (tier must be one of TIERS — absent or unknown tiers invalidate the
 *  item, the builder is the only writer); optional string fields: brief,
 *  captured_at, original_title (feed-title provenance, card t_21c0c195); optional explore metadata: explore_flag (boolean) +
 *  propensity ({score: finite number, why?: string}) — malformed explore
 *  metadata invalidates the item (parsed, never trusted). has_reader is an
 *  optional boolean (in-paper reader availability, card t_f06c164b);
 *  reader_mode is an optional string, "digest" being its only value (reader
 *  quality gate, card t_b3782402). Unknown
 *  extra keys are tolerated — the builder may carry fields this app never
 *  renders. */
export function parseEditionItem(raw: unknown): EditionItem | null {
  if (!isPlainObject(raw)) return null;
  for (const key of ["id", "title", "url", "source", "section", "kind"]) {
    if (typeof raw[key] !== "string") return null;
  }
  if (typeof raw.tier !== "string" || !TIERS.includes(raw.tier as Tier)) return null;
  for (const key of ["brief", "captured_at"]) {
    if (raw[key] !== undefined && typeof raw[key] !== "string") return null;
  }
  if (raw.explore_flag !== undefined && typeof raw.explore_flag !== "boolean") return null;
  if (raw.has_reader !== undefined && typeof raw.has_reader !== "boolean") return null;
  if (raw.reader_mode !== undefined && raw.reader_mode !== "digest") return null;
  if (raw.original_title !== undefined && typeof raw.original_title !== "string") return null;
  if (raw.propensity !== undefined && raw.propensity !== null) {
    if (!isPlainObject(raw.propensity)) return null;
    if (typeof raw.propensity.score !== "number" || !Number.isFinite(raw.propensity.score))
      return null;
    if (raw.propensity.why !== undefined && typeof raw.propensity.why !== "string") return null;
  }
  return raw as unknown as EditionItem;
}

/** Validate raw edition JSON (parsed, never trusted): a dated object whose
 *  items are all well-formed EditionItems. Returns null on any mismatch —
 *  callers treat a corrupt edition exactly like an absent one. */
export function parseEdition(raw: unknown): RawEdition | null {
  if (!isPlainObject(raw)) return null;
  if (typeof raw.edition_date !== "string" || !DATE_RE.test(raw.edition_date)) return null;
  if (!Array.isArray(raw.items)) return null;
  const items: EditionItem[] = [];
  for (const entry of raw.items) {
    const item = parseEditionItem(entry);
    if (!item) return null;
    items.push(item);
  }
  return { edition_date: raw.edition_date, items };
}

/** The set of item ids a referential check validates against (empty edition
 *  → empty set; every presented id counts). */
export function editionItemIds(ed: RawEdition): Set<string> {
  return new Set(ed.items.map((i) => i.id));
}

/** Typographic mark + label for an item (✳︎ wins for might-like suggestions;
 *  VS15 forces text presentation so ✳ never renders as a green emoji). */
export function markFor(item: EditionItem): MarkInfo {
  if (item.section === "might-like")
    return { mark: "✳\uFE0E", label: LABELS[item.kind] || "Suggested" };
  return { mark: MARKS[item.kind] || "‡", label: LABELS[item.kind] || "Brief" };
}

/** "2026-10-25" → "Sunday, October 25, 2026" (UTC-stable). */
export function longDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Shape validated edition JSON for rendering.
 * Returns { date, dateLong, lead, leadSide, glance, sections, itemCount }.
 * lead = the edition-wide page lead (first tier-lead in SECTION_ORDER —
 * with the builder's assignTiers this is the first capture); leadSide =
 * second capture ("also captured" well); sections = non-empty sections in
 * locked order, the Captured section holding captures beyond the first two,
 * each partitioned into sectionLead/secondary/briefs by tier.
 */
export function shapeEdition(raw: RawEdition | null): ShapedEdition {
  const items: EditionItem[] = Array.isArray(raw?.items) ? raw.items : [];
  const bySection: Record<string, EditionItem[]> = Object.fromEntries(
    SECTION_ORDER.map((k): [string, EditionItem[]] => [k, []]),
  );
  for (const item of items) {
    if (bySection[item.section]) bySection[item.section].push(item);
  }
  const pageLead =
    SECTION_ORDER.map((k) => bySection[k].find((i) => i.tier === "lead")).find((i) => i) ?? null;
  const leadSide = bySection["captured"][1] ?? null; // "Also captured" well
  const rest: Record<string, EditionItem[]> = Object.fromEntries(
    Object.entries(bySection).map(([k, v]): [string, EditionItem[]] => [k, v]),
  );
  rest["captured"] = bySection["captured"].slice(2); // beyond lead + side well
  const sections: ShapedSection[] = SECTION_ORDER.map((key) => {
    const its = rest[key];
    return {
      key,
      title: SECTION_TITLES[key],
      items: its,
      sectionLead: its.find((i) => i.tier === "lead") ?? null,
      secondary: its.filter((i) => i.tier === "secondary"),
      briefs: its.filter((i) => i.tier === "brief"),
    };
  }).filter((s) => s.items.length > 0);
  const briefs = items.filter((i) => i.kind === "brief").length;
  const deepReads = items.filter((i) => i.kind === "deep-read").length;
  const captureCount = items.filter((i) => i.kind === "captured").length;
  const suggestions = bySection["might-like"].length;
  return {
    date: raw?.edition_date || "",
    dateLong: longDate(raw?.edition_date || "1970-01-01"),
    glance:
      `${sections.length} sections, ${deepReads} deep reads, ${briefs} briefs, ` +
      `${captureCount} captures pinned` +
      (suggestions
        ? `, ${suggestions} suggestion${suggestions === 1 ? "" : "s"} from outside your usual topics awaiting your verdict.`
        : "."),
    sections,
    itemCount: items.length,
    lead: pageLead,
    leadSide,
  };
}
