/* Domain — persistent story registry (research R6, card t_48954836).
   Canonical story identity + cross-day memory: one entry per canonical story
   (never per day), so "we showed you this yesterday" and "this story never
   got engagement" are first-class facts the builder consults BEFORE edition
   assembly. Ground News/Artifact pattern at n=1: story clusters, not
   articles; repeats render as "(updated angle)" continuations per newspaper
   convention, not fresh items.

   Zero I/O, zero node builtins — identity, matching, merge and engagement
   rollup are pure functions of their inputs; the adapter owns the file and
   the clock (same split as feedback.ts / pool.ts).

   Identity policy (locked for this card):
   - canonical URL first: scheme/www/fragment/trailing-slash-insensitive,
     known tracking params dropped, remaining params sorted for stability;
   - title similarity fallback (token-set Jaccard >= TITLE_SIMILARITY_THRESHOLD)
     for captures of the same story under different URLs;
   - a repeat only earns a continuation when it brings a NEW source-angle —
     the same source re-presenting the same story is a duplicate (an item
     gets exactly one edition per source; it must earn its way back through
     a new capture). Same-edition repeats are always duplicates. */

export const TITLE_SIMILARITY_THRESHOLD = 0.6;

/** A story shown this many times with ZERO engagement becomes a topic-level
 *  negative signal (data-only flag; consumption is later/shadow). */
export const NEGATIVE_SIGNAL_APPEARANCES = 3;

/** Hard cap on editions a single story can appear in (initial + N-1
 *  continuation angles) — continuations self-extinguish. */
export const MAX_EDITION_APPEARANCES = 3;

/** Query params that identify a share/tracking hop, not the story. */
const TRACKING_PARAM_RE =
  /^(utm_|fbclid$|gclid$|mc_(cid|eid)$|ref$|ref_src$|ref_url$|igshid$|si$|share_id$|s?rid$|cmpid$|smid$|ns_campaign$|ns_mchannel$)/i;

/** What the builder feeds the registry for one candidate item. */
export interface StoryCandidate {
  url: string;
  title: string;
  source: string;
}

/** One source-angle: a distinct source's take on the canonical story. */
export interface RegistryAngle {
  /** Same vocabulary as the ledger's `source` field. */
  source: string;
  /** The angle's own URL (may differ per source for the same story). */
  url?: string;
  /** Edition date this angle ran. */
  edition_date: string;
}

/** Rollup of every ledger event matched to this story, across all its
 *  appearances. Recomputed from the ledger at registry-update time — never
 *  incremented in place, so a re-rollup is always idempotent. */
export interface EngagementSummary {
  /** Total matched events (any type) — the zero/non-zero bit drives the
   *  negative-signal flag. */
  signals: number;
  clicks: number;
  verdicts: number;
  /** Verdicts with value "deep-read" (the highest-trust positive at n=1). */
  deep_reads: number;
  /** Sum of dwell events' dwell_ms. */
  dwell_ms: number;
}

export interface RegistryEntry {
  /** Deterministic: "story-" + FNV-1a32 of the canonical identity, so the
   *  same story gets the same id on every machine, every day. */
  story_id: string;
  canonical_url: string;
  /** First-seen title — the canonical identity's title, never the suffixed
   *  continuation presentation. */
  title: string;
  /** Edition dates (YYYY-MM-DD), ascending — one per edition shown, so
   *  appearances.length == how many times we printed this story. */
  first_seen: string;
  last_seen: string;
  appearances: string[];
  /** One per distinct source-angle, chronological. */
  angles: RegistryAngle[];
  engagement_summary: EngagementSummary;
  /** Derived at rollup time: >= NEGATIVE_SIGNAL_APPEARANCES appearances and
   *  zero engagement. Data-only — nothing consumes it yet (shadow). */
  negative_signal: boolean;
}

export type StoryRegistry = RegistryEntry[];

/** Minimal ledger-row shape the rollup needs (v1 and v2 rows both carry a
 *  URL under one of these keys). */
export interface EngagementEvent {
  type?: string;
  item_url?: string;
  url?: string;
  dwell_ms?: number;
  verdict?: string;
}

/* ----- canonical identity (pure) ----- */

/** Normalized canonical form of a story URL: lowercase scheme/host, no
 *  `www.`, no fragment, tracking params dropped, remaining params sorted,
 *  no trailing slash. Unparsable input falls back to trimmed lowercase. */
export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  try {
    const u = new URL(trimmed);
    u.hash = "";
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    if (
      (u.protocol === "http:" && u.port === "80") ||
      (u.protocol === "https:" && u.port === "443")
    ) {
      u.port = "";
    }
    const keep: [string, string][] = [];
    for (const [k, v] of u.searchParams.entries()) {
      if (!TRACKING_PARAM_RE.test(k)) keep.push([k, v]);
    }
    keep.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    u.search = "";
    for (const [k, v] of keep) u.searchParams.append(k, v);
    // no trailing slash on the pathname (except the bare root "/")
    const path = u.pathname === "/" ? "/" : u.pathname.replace(/\/+$/, "");
    return u.origin + path + (u.search || "");
  } catch {
    return trimmed.toLowerCase();
  }
}

/** Canonical title form: lowercase, punctuation stripped, collapsed space. */
export function canonicalTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Token-set Jaccard similarity of two titles, 0..1. */
export function titleSimilarity(a: string, b: string): number {
  const at = new Set(canonicalTitle(a).split(" ").filter(Boolean));
  const bt = new Set(canonicalTitle(b).split(" ").filter(Boolean));
  if (at.size === 0 || bt.size === 0) return 0;
  let shared = 0;
  for (const t of at) if (bt.has(t)) shared += 1;
  return shared / (at.size + bt.size - shared);
}

/** FNV-1a 32-bit, base36 — pure, deterministic across machines. */
function fnv1a32(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36).padStart(7, "0");
}

/** story_id = "story-" + FNV-1a32(canonical URL, else canonical title). */
export function storyIdFor(url: string, title: string): string {
  const key = normalizeUrl(url) || canonicalTitle(title);
  return "story-" + fnv1a32(key);
}

/* ----- validation (parsed wire JSON, never trusted — parseEdition pattern) ----- */

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isDateString(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

function parseEngagement(raw: unknown): EngagementSummary | null {
  if (!isPlainObject(raw)) return null;
  const out: EngagementSummary = { signals: 0, clicks: 0, verdicts: 0, deep_reads: 0, dwell_ms: 0 };
  for (const k of ["signals", "clicks", "verdicts", "deep_reads", "dwell_ms"] as const) {
    if (typeof raw[k] !== "number" || !Number.isFinite(raw[k]) || raw[k] < 0) return null;
    out[k] = raw[k];
  }
  return out;
}

function parseEntry(raw: unknown): RegistryEntry | null {
  if (!isPlainObject(raw)) return null;
  if (typeof raw.story_id !== "string" || !raw.story_id) return null;
  if (typeof raw.canonical_url !== "string" || typeof raw.title !== "string") return null;
  if (!isDateString(raw.first_seen) || !isDateString(raw.last_seen)) return null;
  if (!Array.isArray(raw.appearances) || !raw.appearances.every(isDateString)) return null;
  const angles: RegistryAngle[] = [];
  const rawAngles = Array.isArray(raw.angles) ? raw.angles : [];
  for (const a of rawAngles) {
    if (!isPlainObject(a) || typeof a.source !== "string" || !isDateString(a.edition_date))
      return null;
    angles.push({
      source: a.source,
      url: typeof a.url === "string" ? a.url : undefined,
      edition_date: a.edition_date,
    });
  }
  const engagement = parseEngagement(raw.engagement_summary);
  if (!engagement) return null;
  return {
    story_id: raw.story_id,
    canonical_url: raw.canonical_url,
    title: raw.title,
    first_seen: raw.first_seen,
    last_seen: raw.last_seen,
    appearances: raw.appearances,
    angles,
    engagement_summary: engagement,
    negative_signal: raw.negative_signal === true,
  };
}

/** Validate parsed registry JSON (an array of entries). Returns null on any
 *  mismatch — callers treat a corrupt registry exactly like an absent one. */
export function parseRegistry(raw: unknown): StoryRegistry | null {
  if (!Array.isArray(raw)) return null;
  const entries: RegistryEntry[] = [];
  for (const e of raw) {
    const entry = parseEntry(e);
    if (!entry) return null;
    entries.push(entry);
  }
  return entries;
}

/* ----- matching + merge (pure) ----- */

/** The registry entry a candidate belongs to: canonical-URL hit first, then
 *  title-similarity fallback. Null = never seen before. */
export function matchEntry(registry: StoryRegistry, cand: StoryCandidate): RegistryEntry | null {
  const url = normalizeUrl(cand.url);
  if (url) {
    const byUrl = registry.find((e) => e.canonical_url === url);
    if (byUrl) return byUrl;
  }
  if (cand.title.trim()) {
    for (const e of registry) {
      if (titleSimilarity(e.title, cand.title) >= TITLE_SIMILARITY_THRESHOLD) return e;
    }
  }
  return null;
}

export type AppearanceAction =
  | "fresh"
  | "continuation"
  | "already-presented"
  | "duplicate"
  | "capped";

export interface PlanDecision {
  candidate: StoryCandidate;
  story_id: string | null;
  action: AppearanceAction;
  /** appearances.length BEFORE this candidate (0 for fresh). */
  prior_appearances: number;
}

export interface PlanResult {
  /** One decision per candidate, input order. */
  pool: PlanDecision[];
  /** Registry with every fresh/continuation folded in (duplicates and
   *  capped candidates leave it untouched). */
  entries: StoryRegistry;
}

/** Plan ONE candidate against a registry → decision + the entry to fold in
 *  (null for duplicate/capped/already-presented). `planAppearances` is a
 *  fold of this.
 *  - fresh: never seen → new entry;
 *  - continuation: seen on an EARLIER edition, new source-angle;
 *  - already-presented: seen in THIS edition (same-day rebuild) → accepted
 *    unchanged, the entry is not re-folded;
 *  - duplicate: seen on an earlier edition from the SAME source — no new
 *    angle, stays out (an item gets exactly one edition per source);
 *  - capped: past MAX_EDITION_APPEARANCES. */
export function planCandidate(
  registry: StoryRegistry,
  cand: StoryCandidate,
  editionDate: string,
): {
  action: AppearanceAction;
  story_id: string | null;
  entry_after: RegistryEntry | null;
  prior_appearances: number;
} {
  const existing = matchEntry(registry, cand);
  if (!existing) {
    const entry: RegistryEntry = {
      story_id: storyIdFor(cand.url, cand.title),
      canonical_url: normalizeUrl(cand.url) || canonicalTitle(cand.title),
      title: cand.title,
      first_seen: editionDate,
      last_seen: editionDate,
      appearances: [editionDate],
      angles: [
        {
          source: cand.source,
          url: normalizeUrl(cand.url) || undefined,
          edition_date: editionDate,
        },
      ],
      engagement_summary: { signals: 0, clicks: 0, verdicts: 0, deep_reads: 0, dwell_ms: 0 },
      negative_signal: false,
    };
    return { action: "fresh", story_id: entry.story_id, entry_after: entry, prior_appearances: 0 };
  }
  const prior = existing.appearances.length;
  if (existing.appearances.includes(editionDate))
    return {
      action: "already-presented",
      story_id: existing.story_id,
      entry_after: null,
      prior_appearances: prior,
    };
  if (existing.angles.some((a) => a.source === cand.source))
    return {
      action: "duplicate",
      story_id: existing.story_id,
      entry_after: null,
      prior_appearances: prior,
    };
  if (prior >= MAX_EDITION_APPEARANCES)
    return {
      action: "capped",
      story_id: existing.story_id,
      entry_after: null,
      prior_appearances: prior,
    };
  const entry_after: RegistryEntry = {
    ...existing,
    last_seen: editionDate,
    appearances: [...existing.appearances, editionDate],
    angles: [
      ...existing.angles,
      { source: cand.source, url: normalizeUrl(cand.url) || undefined, edition_date: editionDate },
    ],
  };
  return {
    action: "continuation",
    story_id: existing.story_id,
    entry_after,
    prior_appearances: prior,
  };
}

/** Pure merge: registry + new candidates → deduped pool + updated entries.
 *  Candidates fold left-to-right with a run-local story set, so same-edition
 *  repeats of one story see each other (second one becomes a duplicate —
 *  one item per story per edition, the newspaper convention). */
export function planAppearances(
  registry: StoryRegistry,
  candidates: StoryCandidate[],
  editionDate: string,
): PlanResult {
  const pool: PlanDecision[] = [];
  let entries = registry;
  const presentedThisRun = new Set<string>();
  for (const cand of candidates) {
    let d = planCandidate(entries, cand, editionDate);
    if (
      (d.action === "fresh" || d.action === "continuation" || d.action === "already-presented") &&
      d.story_id &&
      presentedThisRun.has(d.story_id)
    ) {
      d = { ...d, action: "duplicate", entry_after: null };
    }
    if (d.entry_after) {
      entries =
        d.action === "fresh"
          ? [...entries, d.entry_after]
          : entries.map((e) => (e.story_id === d.story_id ? (d.entry_after as RegistryEntry) : e));
    }
    if (d.action !== "duplicate" && d.action !== "capped" && d.story_id)
      presentedThisRun.add(d.story_id);
    pool.push({
      candidate: cand,
      story_id: d.story_id,
      action: d.action,
      prior_appearances: d.prior_appearances,
    });
  }
  return { pool, entries };
}

/** The presentation title for a continuation appearance ("(updated angle)"
 *  newspaper convention). Fresh items pass through untouched. */
export function continuationTitle(baseTitle: string, source: string): string {
  return `${baseTitle} (updated angle: ${source})`;
}

/* ----- engagement rollup (pure) ----- */

const emptySummary = (): EngagementSummary => ({
  signals: 0,
  clicks: 0,
  verdicts: 0,
  deep_reads: 0,
  dwell_ms: 0,
});

/** Recompute every entry's engagement_summary from ledger events and derive
 *  negative_signal. Matching is by canonical URL only (ledger rows carry
 *  item_url; events without a parsable URL are skipped, never guessed onto
 *  titles). Idempotent: run twice, same registry. */
export function rollupEngagement(
  registry: StoryRegistry,
  events: EngagementEvent[],
): StoryRegistry {
  const hits = new Map<string, EngagementSummary>();
  for (const ev of events) {
    const url = normalizeUrl(ev.item_url ?? ev.url ?? "");
    if (!url) continue;
    const entry = registry.find((e) => e.canonical_url === url);
    if (!entry) continue;
    const s = hits.get(entry.story_id) ?? emptySummary();
    s.signals += 1;
    if (ev.type === "click") s.clicks += 1;
    if (ev.type === "verdict") {
      s.verdicts += 1;
      if (ev.verdict === "deep-read") s.deep_reads += 1;
    }
    if (ev.type === "dwell" && typeof ev.dwell_ms === "number" && Number.isFinite(ev.dwell_ms)) {
      s.dwell_ms += Math.max(0, ev.dwell_ms);
    }
    hits.set(entry.story_id, s);
  }
  return registry.map((e) => {
    const engagement_summary = hits.get(e.story_id) ?? emptySummary();
    return {
      ...e,
      engagement_summary,
      negative_signal:
        e.appearances.length >= NEGATIVE_SIGNAL_APPEARANCES && engagement_summary.signals === 0,
    };
  });
}

/* ----- port (the hexagonal seam adapters implement) ----- */

/** Persistent story registry store. The seam lives beside the schema here
 *  (admin-ports.ts precedent) instead of ports.ts, which a sibling card
 *  currently holds uncommitted; fold it into ports.ts once that lands.
 *  The builder is the only writer; one entry per canonical story, compact
 *  forever (a file store today, SQLite later — the domain doesn't change). */
export interface StoryRegistryStore {
  /** Parsed, never trusted: a corrupt/absent file loads as [] — callers
   *  backfill from the editions archive. */
  load(): Promise<StoryRegistry>;
  /** Whole-registry write (entries update in place; the file is small). */
  save(registry: StoryRegistry): Promise<void>;
}

/* ----- backfill (pure) ----- */

/** Minimal edition shape the backfill needs (edition.json items). */
export interface BackfillEdition {
  edition_date: string;
  items: Array<{ url?: string; title?: string; source?: string }>;
}

/** Presentation-suffix stripper: archived items carry continuation titles
 *  ("Title (updated angle: hn)"), but a registry entry's title is the
 *  base title — the live commit path strips the suffix before re-planning
 *  (make_edition.ts), so backfill compaction matches on the same form. */
export function baseTitle(title: string): string {
  let t = title.trim();
  // loop: defensive against stacked suffixes from older presentations
  for (let prev = ""; prev !== t;) {
    prev = t;
    t = t.replace(/ \(updated angle: [^)]*\)$/i, "").trim();
  }
  return t;
}

/** Seed a fresh registry from past editions, replaying planAppearances day
 *  by day — the registry's cross-day memory reconstructed from the archive.
 *  Days must be passed in ascending date order.
 *
 *  The replay is a COARSE SEED: it folds day-by-day, so a later day's
 *  capture of an earlier story misses the merge when it arrives under a
 *  different URL AND a dissimilar presentation title (notably archived
 *  continuation titles, whose "(updated angle: …)" suffix defeats the
 *  title fallback). Callers run compactRegistry on the result — the
 *  documented compaction step that restores one-entry-per-canonical-story. */
export function backfillFromEditions(days: BackfillEdition[]): StoryRegistry {
  let entries: StoryRegistry = [];
  for (const day of days) {
    const cands: StoryCandidate[] = (day.items ?? [])
      .filter((i) => typeof i.title === "string" && i.title.trim())
      .map((i) => ({
        url: typeof i.url === "string" ? i.url : "",
        title: i.title as string,
        source: typeof i.source === "string" ? i.source : "unknown",
      }));
    entries = planAppearances(entries, cands, day.edition_date).entries;
  }
  return entries;
}

/* ----- backfill compaction (pure) ----- */

/** Two entries share canonical identity: same canonical URL, or base-title
 *  similarity >= TITLE_SIMILARITY_THRESHOLD (suffix-stripped, so archived
 *  continuation titles match their story's base-title entry). */
function sameIdentity(a: RegistryEntry, b: RegistryEntry): boolean {
  if (a.canonical_url && a.canonical_url === b.canonical_url) return true;
  const at = baseTitle(a.title);
  const bt = baseTitle(b.title);
  return at.length > 0 && bt.length > 0 && titleSimilarity(at, bt) >= TITLE_SIMILARITY_THRESHOLD;
}

function mergeEntries(keep: RegistryEntry, drop: RegistryEntry): RegistryEntry {
  const appearances = [...new Set([...keep.appearances, ...drop.appearances])].sort();
  const angles: RegistryAngle[] = [];
  const seenAngle = new Set<string>();
  for (const a of [...keep.angles, ...drop.angles]) {
    const key = `${a.source}\u0000${a.edition_date}`;
    if (seenAngle.has(key)) continue;
    seenAngle.add(key);
    angles.push(a);
  }
  angles.sort((a, b) =>
    a.edition_date < b.edition_date ? -1 : a.edition_date > b.edition_date ? 1 : 0,
  );
  const engagement_summary: EngagementSummary = {
    signals: keep.engagement_summary.signals + drop.engagement_summary.signals,
    clicks: keep.engagement_summary.clicks + drop.engagement_summary.clicks,
    verdicts: keep.engagement_summary.verdicts + drop.engagement_summary.verdicts,
    deep_reads: keep.engagement_summary.deep_reads + drop.engagement_summary.deep_reads,
    dwell_ms: keep.engagement_summary.dwell_ms + drop.engagement_summary.dwell_ms,
  };
  return {
    // earliest entry owns the canonical identity (first_seen title/URL/id)
    ...keep,
    last_seen: keep.last_seen > drop.last_seen ? keep.last_seen : drop.last_seen,
    appearances,
    angles,
    engagement_summary,
    negative_signal:
      appearances.length >= NEGATIVE_SIGNAL_APPEARANCES && engagement_summary.signals === 0,
  };
}

/** Merge every set of entries sharing canonical identity (canonical URL or
 *  suffix-stripped title similarity) into ONE entry — the compaction pass
 *  over a backfilled (coarse-seed) registry. The earliest entry keeps its
 *  story_id/canonical_url/title/first_seen; appearances union (sorted,
 *  deduped); angles union per (source, edition_date), chronological;
 *  engagement summaries SUM (rollupEngagement recomputes from the ledger at
 *  build time, so this stays a faithful seed either way); negative_signal
 *  is recomputed from the merged facts. Stable and idempotent: after one
 *  pass no two entries share identity, so a second pass changes nothing.
 *  The live fold path never calls this — compaction exists for the
 *  crash-recovery backfill only (card t_00a5273f). */
export function compactRegistry(registry: StoryRegistry): StoryRegistry {
  const clusters: RegistryEntry[][] = [];
  for (const e of registry) {
    const home = clusters.find((c) => c.some((m) => sameIdentity(m, e)));
    if (home) home.push(e);
    else clusters.push([e]);
  }
  return clusters.map((c) => c.reduce((keep, drop) => mergeEntries(keep, drop)));
}
