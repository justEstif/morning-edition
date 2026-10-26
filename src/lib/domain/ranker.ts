/* Domain — ranker weights from reader signals (card t_072d6c12, P1·A →
   P1·B climb). Turns the append-only ledger + story registry + edition
   history into per-topic / per-source / per-author multipliers, a shadow
   ordering, and the promotion-gate stats the parent design card locked
   (P2 auto-triage only after ≥80% verdict agreement for 2 weeks).

   SHADOW: nothing here controls placement. The builder logs the ranker's
   suggested ordering beside the static one and serves the static order
   (P1·B entry); weights earn control of placement only through the
   promotion gate, and this card ships no auto-promotion logic.

   Model (deliberately transparent, mirrors the feedback-loop harness so
   the two systems can be compared):
   - event signal value × burst weight (flip_ms → 0.1) × time decay
     (30-day half-life), accumulated per topic / source / author bucket;
   - multiplier = clamp(exp(0.1·S), 0.5, 2.0) — bounded by construction;
   - weights are RECOMPUTED from scratch on every run, read-only over the
     ledger, so a hot week decays back toward 1.0 instead of sticking —
     there is no persistent state to skew.
   - cross-store join rule (fold-in from t_1ee4a657): every event joins to
     item facts by item_id FIRST (ledger ↔ edition identity), falling back
     to item_url against the registry's canonical identity — Readeck and
     Miniflux signals participate through the same seam.
   - multi-tab dwell double-settle (known t_ea679b5a caveat): dwell events
     dedupe on item_id + opened_at, keeping the max dwell_ms.

   Zero I/O, zero node builtins — the builder adapter (builder/ranker-store.ts)
   owns the ledger read and the artifact file, same split as feedback.ts /
   registry.ts. All outputs are deterministic functions of their inputs:
   no wall-clock reads anywhere, so the same inputs produce byte-identical
   artifacts (recompute idempotence is a verified property, not a hope). */

/** Artifact schema version — bump on any shape change. */
export const RANKER_VERSION = 1;

/** Signals older than this are excluded entirely (30d half-life makes their
 *  contribution negligible; the bound keeps the audit trail finite). */
export const SIGNAL_WINDOW_DAYS = 30;

/** Half-life of a signal's weight, days (matches feedback-loop harness). */
export const DECAY_HALF_LIFE_DAYS = 30;

/** Multiplicative weight bounds. */
export const WEIGHT_FLOOR = 0.5;
export const WEIGHT_CEIL = 2.0;

/** Sensitivity: multiplier = exp(SCORE_SENSITIVITY · S). */
export const SCORE_SENSITIVITY = 0.1;

/** Burst (rubber-stamp) down-weight for verdicts stamped flip_ms. */
export const BURST_WEIGHT = 0.1;

/** Registry zero-engagement negative stories push their sources down by
 *  this much raw score (registry.negative_signal, shadow flag). */
export const NEGATIVE_STORY_SIGNAL = -0.5;

/** Promotion gate (parent card t_05ddeae1, locked): P2 auto only after
 *  ≥80% verdict agreement over a trailing 2-week window. */
export const GATE_WINDOW_DAYS = 14;
export const GATE_BAR = 0.8;

/** Deep-engagement thresholds for the gate's suggestion rule. */
export const DEEP_DWELL_MS = 60_000;
export const DEEP_PROGRESS_PCT = 80;

/** Low-confidence derived negative (feedback.ts SkipEvent). */
export const SKIP_SIGNAL = -0.2;

/* ----- inputs (adapter-shaped, domain-validated) ----- */

/** The one ledger row shape the ranker needs (v1 and v2 rows both). */
export interface RankerEvent {
  ts: string;
  type: string;
  item_id?: string;
  item_url?: string;
  source?: string;
  /** verdict/grade/vote value. */
  value?: string;
  dwell_ms?: number;
  flip_ms?: number;
  progress_pct?: number;
  confidence?: number;
  starred?: boolean;
  opened_at?: string;
  /** Impression-only fields (present on the row, weight-silent). */
  seen_ms?: number;
}

/** Item facts joined by item_id (from the editions archive + pool feeds). */
export interface ItemFacts {
  source: string;
  /** Section = the topic bucket (the paper's four locked lanes). */
  topic: string;
  /** Feed/author key when the source exposes one (Miniflux feeds, the
   *  tech-Twitter author cluster); absent → no author attribution. */
  author?: string;
  url?: string;
}

/** A registry story flagged zero-engagement-negative, reduced to what the
 *  ranker may touch: its canonical identity (url, for gate lookups), its
 *  sources, and how stale the flag is. */
export interface NegativeStory {
  canonical_url?: string;
  sources: string[];
  last_seen: string;
}

export interface RankerInputs {
  /** Edition date the computation is "as of" (NOT wall-clock — artifacts
   *  must be reproducible). */
  asOf: string;
  events: RankerEvent[];
  items: Record<string, ItemFacts>;
  negativeStories: NegativeStory[];
  /** Total canonical stories in the registry (the negative subset follows). */
  registryStories: number;
  /** True when the ledger was actually read (false → neutral degradation,
   *  never guessed engagement numbers). */
  ledgerRead: boolean;
}

export interface WeightSet {
  topics: Record<string, number>;
  sources: Record<string, number>;
  authors: Record<string, number>;
}

/** Per-key evidence behind a multiplier (audit trail in the artifact). */
export interface WeightEvidence {
  score: number;
  events: number;
}

export interface GateStats {
  bar: number;
  window_days: number;
  definition: string;
  verdicts_in_window: number;
  suggestable: number;
  agreements: number;
  agreement_rate: number | null;
  passes: boolean;
}

export interface RankerWeights {
  version: number;
  kind: "ranker-weights";
  as_of: string;
  model: string;
  inputs: {
    ledger_read: boolean;
    ledger_events: number;
    events_by_type: Record<string, number>;
    weighted_events: number;
    unattributed_events: number;
    registry_stories: number;
    negative_stories: number;
    window_days: number;
  };
  weights: WeightSet;
  evidence: {
    topics: Record<string, WeightEvidence>;
    sources: Record<string, WeightEvidence>;
    authors: Record<string, WeightEvidence>;
  };
  promotion_gate: GateStats;
}

/* ----- helpers (pure, deterministic) ----- */

/* Sibling domain import: canonical URL normalization for the registry
   negative-flag join (inward only, hexagonal rule respected). */
import { normalizeUrl } from "./registry.js";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Object with keys inserted in sorted order — JSON.stringify output is then
 *  byte-identical across runs (recompute idempotence). */
function sortedMap(entries: [string, number][]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) out[k] = v;
  return out;
}

/** Whole days between two ISO dates (calendar, UTC-stable). */
function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(fromIso.slice(0, 10) + "T00:00:00Z");
  const to = Date.parse(toIso.slice(0, 10) + "T00:00:00Z");
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

/** True when ts falls in the trailing `windowDays` calendar days ending on
 *  asOf (inclusive both ends, UTC-stable). */
function withinDays(tsIso: string, asOf: string, windowDays: number): boolean {
  const t = Date.parse(tsIso);
  if (Number.isNaN(t)) return false;
  const end = Date.parse(asOf.slice(0, 10) + "T23:59:59.999Z");
  const start = Date.parse(asOf.slice(0, 10) + "T00:00:00Z") - (windowDays - 1) * 86_400_000;
  return t >= start && t <= end;
}

/** Exponential time decay, 30-day half-life: fresh = 1.0, stale → 0.
 *  Age is counted in whole CALENDAR days (event date → asOf) so hand
 *  arithmetic on the artifact is exact: same-day = 1.0, 30 days = 0.5. */
export function decayFactor(tsIso: string, asOf: string): number {
  const t = Date.parse(tsIso);
  if (Number.isNaN(t)) return 0;
  const ageDays = daysBetween(tsIso.slice(0, 10), asOf);
  return Math.pow(2, -ageDays / DECAY_HALF_LIFE_DAYS);
}

/** The raw signal value of one ledger event, BEFORE burst + decay.
 *  Null = this event type carries no training signal (impressions are
 *  exposure, not engagement; unknown types are ignored, never guessed). */
export function signalValue(ev: RankerEvent): number | null {
  switch (ev.type) {
    case "verdict":
    case "grade": {
      if (ev.value === "deep-read") return 1.0;
      if (ev.value === "skim") return -0.4;
      if (ev.value === "drop") return -0.7;
      // Explicit not-interested (card t_1e178af7): the strongest negative the
      // reader can type — stronger than drop because it scopes the topic/
      // source, not just the item. Suppression lists themselves are the
      // recommendations loop's job (t_b45f60dc); here it demotes via the
      // same per-topic/per-source multipliers as every other signal.
      if (ev.value === "skip") return -1.0;
      if (ev.value === "capture") return 0.6; // legacy v1 grade
      return null;
    }
    case "vote":
      return ev.value === "up" ? 0.5 : ev.value === "down" ? -0.7 : null;
    case "capture":
    case "highlight":
      return 0.6;
    case "star":
      return ev.starred === false ? null : 0.5;
    case "click":
      return 0.3;
    case "dwell":
      return typeof ev.dwell_ms === "number" && ev.dwell_ms > 0 ? 0.4 : null;
    case "read_progress":
      return typeof ev.progress_pct === "number" && ev.progress_pct > 0
        ? 0.5 * (Math.min(ev.progress_pct, 100) / 100)
        : null;
    case "skip":
      return typeof ev.confidence === "number"
        ? SKIP_SIGNAL * Math.min(Math.max(ev.confidence, 0), 1)
        : null;
    default:
      return null; // impression: exposure, not engagement
  }
}

/** clamp(exp(0.1·S), 0.5, 2.0) — the bounded multiplicative multiplier. */
export function multiplierFor(score: number): number {
  const raw = Math.exp(SCORE_SENSITIVITY * score);
  return Math.min(WEIGHT_CEIL, Math.max(WEIGHT_FLOOR, raw));
}

/* ----- weight computation ----- */

interface Buckets {
  topics: Map<string, { score: number; events: number }>;
  sources: Map<string, { score: number; events: number }>;
  authors: Map<string, { score: number; events: number }>;
}

function bump(bucket: Map<string, { score: number; events: number }>, key: string, v: number) {
  const cur = bucket.get(key) ?? { score: 0, events: 0 };
  cur.score += v;
  cur.events += 1;
  bucket.set(key, cur);
}

/** Attribution of one weighted event to its buckets. An event with no
 *  item facts AND no source on the row is unattributable — counted, never
 *  guessed into a bucket. */
function attribute(
  buckets: Buckets,
  ev: RankerEvent,
  facts: ItemFacts | undefined,
  weighted: number,
): void {
  if (facts) {
    bump(buckets.topics, facts.topic, weighted);
    bump(buckets.sources, facts.source, weighted);
    if (facts.author) bump(buckets.authors, facts.author, weighted);
    return;
  }
  if (ev.source) bump(buckets.sources, ev.source, weighted);
}

/** Compute the full weight artifact. Deterministic and re-runnable: the
 *  same inputs produce byte-identical JSON (sorted keys, no wall-clock). */
export function computeRankerWeights(inputs: RankerInputs): RankerWeights {
  const { asOf, events, items } = inputs;
  const buckets: Buckets = {
    topics: new Map(),
    sources: new Map(),
    authors: new Map(),
  };
  const eventsByType: Record<string, number> = {};
  let weightedEvents = 0;
  let unattributed = 0;

  // Multi-tab dwell dedupe (t_ea679b5a caveat): one dwell per item_id +
  // opened_at, keeping the max dwell_ms of the double-settled pair. Dwell
  // events without the join key are kept as-is (nothing to dedupe on).
  const deduped: RankerEvent[] = [];
  const dwellBest = new Map<string, RankerEvent>();
  const keylessDwell: RankerEvent[] = [];
  for (const ev of events) {
    if (ev.type !== "dwell") {
      deduped.push(ev);
    } else if (ev.item_id && ev.opened_at) {
      const key = `${ev.item_id}\u0000${ev.opened_at}`;
      const prev = dwellBest.get(key);
      if (!prev) dwellBest.set(key, ev);
      else if ((ev.dwell_ms ?? 0) > (prev.dwell_ms ?? 0)) dwellBest.set(key, ev);
    } else {
      keylessDwell.push(ev);
    }
  }
  for (const ev of dwellBest.values()) deduped.push(ev);
  deduped.push(...keylessDwell);

  for (const ev of deduped) {
    eventsByType[ev.type] = (eventsByType[ev.type] ?? 0) + 1;
    if (!withinDays(ev.ts, asOf, SIGNAL_WINDOW_DAYS)) continue;
    const base = signalValue(ev);
    if (base === null) continue;
    const burst = ev.flip_ms !== undefined ? BURST_WEIGHT : 1;
    const weighted = base * burst * decayFactor(ev.ts, asOf);
    const facts = ev.item_id ? items[ev.item_id] : undefined;
    if (!facts && !ev.source) {
      unattributed += 1;
      continue;
    }
    attribute(buckets, ev, facts, weighted);
    weightedEvents += 1;
  }

  // Registry zero-engagement negatives: one flat penalty per source, decayed
  // by the story's last appearance (a stale negative fades like any signal).
  let negativeStories = 0;
  for (const story of inputs.negativeStories) {
    negativeStories += 1;
    const weighted = NEGATIVE_STORY_SIGNAL * decayFactor(story.last_seen + "T12:00:00Z", asOf);
    for (const src of story.sources) {
      if (!src) continue;
      bump(buckets.sources, src, weighted);
    }
  }

  const weights: WeightSet = {
    topics: sortedMap([...buckets.topics].map(([k, v]) => [k, round4(multiplierFor(v.score))])),
    sources: sortedMap([...buckets.sources].map(([k, v]) => [k, round4(multiplierFor(v.score))])),
    authors: sortedMap([...buckets.authors].map(([k, v]) => [k, round4(multiplierFor(v.score))])),
  };
  const evidence = {
    topics: evidenceOf(buckets.topics),
    sources: evidenceOf(buckets.sources),
    authors: evidenceOf(buckets.authors),
  };

  const gate = computeGateStats(inputs);
  return {
    version: RANKER_VERSION,
    kind: "ranker-weights",
    as_of: asOf,
    model:
      `multiplicative: clamp(exp(0.1*sum(signal_value*burst*decay)), ${WEIGHT_FLOOR}, ` +
      `${WEIGHT_CEIL}); signal half-life ${DECAY_HALF_LIFE_DAYS}d; recomputed from ` +
      `scratch each run (read-only over the ledger) so weights decay toward 1.0; ` +
      `topics=sections, authors=miniflux feeds; registry zero-engagement negatives ` +
      `apply ${NEGATIVE_STORY_SIGNAL} per source; shadow-only — nothing here ` +
      `controls placement (P1·B)`,
    inputs: {
      ledger_read: inputs.ledgerRead,
      ledger_events: events.length,
      events_by_type: sortedMap(Object.entries(eventsByType)),
      weighted_events: weightedEvents,
      unattributed_events: unattributed,
      registry_stories: inputs.registryStories,
      negative_stories: negativeStories,
      window_days: SIGNAL_WINDOW_DAYS,
    },
    weights,
    evidence,
    promotion_gate: gate,
  };
}

function evidenceOf(
  bucket: Map<string, { score: number; events: number }>,
): Record<string, WeightEvidence> {
  const out: Record<string, WeightEvidence> = {};
  for (const [k, v] of [...bucket].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    out[k] = { score: round4(v.score), events: v.events };
  }
  return out;
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

/* ----- shadow ordering ----- */

/** Shadow score of one edition item: the static rubric score × its
 *  multiplicative ranker weights (defaults 1.0 when no signal exists).
 *  Rounded to 4dp — file-stable, plenty for an ordering. */
export function shadowScore(
  baseScore: number,
  topic: string,
  source: string,
  author: string | undefined,
  weights: WeightSet,
): number {
  const t = weights.topics[topic] ?? 1.0;
  const s = weights.sources[source] ?? 1.0;
  const a = author ? (weights.authors[author] ?? 1.0) : 1.0;
  return round4(baseScore * t * s * a);
}

/** The ranker-suggested ordering: ids sorted by shadow score DESC, ties
 *  broken by the static order (stable, deterministic). Pure — the builder
 *  logs this beside the static order and serves the static order. */
export function shadowOrder(ids: string[], scores: Record<string, number>): string[] {
  return ids
    .map((id, index) => ({ id, index, score: scores[id] ?? 0 }))
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.index - b.index))
    .map((x) => x.id);
}

/* ----- promotion-gate tracker ----- */

/** The engine's suggested verdict for one item, from its NON-verdict
 *  engagement evidence only (the suggestion must be independent of the
 *  verdict it is scored against):
 *  - deep evidence (dwell ≥ 60s, read_progress ≥ 80%, capture/star/
 *    highlight = saved-for-later intent) → suggest "deep-read";
 *  - any lighter engagement (click, sub-60s dwell, partial progress) →
 *    suggest "skim";
 *  - zero engagement + registry zero-engagement negative flag → "drop";
 *  - zero engagement, no negative flag → NO suggestion (unsuggestable —
 *    silence is not a verdict, and counting it would fake disagreement). */
export function suggestVerdict(
  signals: RankerEvent[],
  isNegativeStory: boolean,
): "deep-read" | "skim" | "drop" | null {
  let deep = false;
  let light = false;
  for (const ev of signals) {
    if (ev.type === "dwell" && (ev.dwell_ms ?? 0) >= DEEP_DWELL_MS) deep = true;
    else if (ev.type === "read_progress" && (ev.progress_pct ?? 0) >= DEEP_PROGRESS_PCT)
      deep = true;
    else if (ev.type === "capture" || ev.type === "star" || ev.type === "highlight") deep = true;
    else if (
      ev.type === "click" ||
      (ev.type === "dwell" && (ev.dwell_ms ?? 0) > 0) ||
      (ev.type === "read_progress" && (ev.progress_pct ?? 0) > 0)
    )
      light = true;
  }
  if (deep) return "deep-read";
  if (light) return "skim";
  return isNegativeStory ? "drop" : null;
}

/** Verdict-agreement over the trailing GATE_WINDOW_DAYS (locked bar
 *  GATE_BAR): of the user's verdicts the engine could have suggested, the
 *  share where suggestion === verdict. No auto-promotion lives here —
 *  this number is what a FUTURE card reads to allow placement control. */
export function computeGateStats(inputs: RankerInputs): GateStats {
  const { asOf, events, items } = inputs;
  const negativeUrls = new Set<string>();
  for (const story of inputs.negativeStories) {
    // normalized on both sides — ledger item_url is raw, registry canonical
    if (story.canonical_url) negativeUrls.add(normalizeUrl(story.canonical_url));
  }
  const isNegativeFor = (ev: RankerEvent, facts: ItemFacts | undefined): boolean => {
    const url = ev.item_url ?? facts?.url;
    if (url === undefined) return false;
    return negativeUrls.has(normalizeUrl(url));
  };

  // Non-verdict engagement signals per item, for suggestion lookup.
  const byItem = new Map<string, RankerEvent[]>();
  for (const ev of events) {
    if (ev.type === "verdict" || ev.type === "grade" || ev.type === "vote") continue;
    if (!ev.item_id) continue;
    const list = byItem.get(ev.item_id) ?? [];
    list.push(ev);
    byItem.set(ev.item_id, list);
  }

  let verdictsInWindow = 0;
  let suggestable = 0;
  let agreements = 0;
  // Latest verdict per item in the window (re-taps supersede).
  const latest = new Map<string, RankerEvent>();
  for (const ev of events) {
    if (ev.type !== "verdict" && ev.type !== "grade") continue;
    if (!ev.item_id || !ev.value) continue;
    if (ev.value === "capture") continue; // legacy grade, not a triage verdict
    if (!["deep-read", "skim", "drop", "skip"].includes(ev.value)) continue;
    if (!withinDays(ev.ts, asOf, GATE_WINDOW_DAYS)) continue;
    verdictsInWindow += 1;
    const prev = latest.get(ev.item_id);
    if (!prev || Date.parse(ev.ts) >= Date.parse(prev.ts)) latest.set(ev.item_id, ev);
  }
  for (const [itemId, ev] of latest) {
    const facts = items[itemId];
    const suggestion = suggestVerdict(byItem.get(itemId) ?? [], isNegativeFor(ev, facts));
    if (suggestion === null) continue;
    suggestable += 1;
    // skip (explicit not-interested) lands in the negative bucket: it agrees
    // with a drop suggestion and disagrees with deep-read/skim (t_1e178af7).
    const actual = ev.value === "skip" ? "drop" : ev.value;
    if (suggestion === actual) agreements += 1;
  }
  const rate = suggestable > 0 ? round4(agreements / suggestable) : null;
  return {
    bar: GATE_BAR,
    window_days: GATE_WINDOW_DAYS,
    definition:
      "share of the reader's trailing-14d verdicts (deep-read|skim|drop|skip, one per " +
      "item, latest wins; skip counts in the drop bucket) where the engine's suggestion — derived ONLY from that " +
      "item's non-verdict engagement: deep evidence (dwell>=60s, progress>=80%, " +
      "capture/star/highlight) suggests deep-read, lighter engagement suggests " +
      "skim, zero engagement on a registry negative-flagged story suggests drop, " +
      "otherwise no suggestion (excluded, not counted as disagreement) — equals " +
      "the actual verdict. P2 promotion needs rate >= " +
      GATE_BAR +
      " sustained; " +
      "sustaining/auto-promotion is a later card.",
    verdicts_in_window: verdictsInWindow,
    suggestable,
    agreements,
    agreement_rate: rate,
    passes: rate !== null && rate >= GATE_BAR,
  };
}

/* ----- artifact validation (parsed wire JSON, never trusted) ----- */

/** Validate a parsed ranker-weights.json. Returns the artifact or null —
 *  consumers treat a corrupt artifact exactly like an absent one. */
export function parseRankerWeights(raw: unknown): RankerWeights | null {
  if (!isPlainObject(raw)) return null;
  if (raw.version !== RANKER_VERSION) return null;
  if (raw.kind !== "ranker-weights") return null;
  if (typeof raw.as_of !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw.as_of)) return null;
  if (typeof raw.model !== "string") return null;
  if (!isPlainObject(raw.inputs)) return null;
  if (typeof raw.inputs.ledger_read !== "boolean") return null;
  for (const k of [
    "ledger_events",
    "weighted_events",
    "unattributed_events",
    "registry_stories",
    "negative_stories",
    "window_days",
  ]) {
    if (typeof raw.inputs[k] !== "number" || !Number.isFinite(raw.inputs[k])) return null;
  }
  if (!isPlainObject(raw.inputs.events_by_type)) return null;
  if (!isPlainObject(raw.weights)) return null;
  for (const k of ["topics", "sources", "authors"]) {
    const m = raw.weights[k];
    if (!isPlainObject(m)) return null;
    for (const v of Object.values(m)) {
      if (typeof v !== "number" || !Number.isFinite(v)) return null;
      if (v < WEIGHT_FLOOR || v > WEIGHT_CEIL) return null;
    }
  }
  if (!isPlainObject(raw.evidence)) return null;
  for (const k of ["topics", "sources", "authors"]) {
    const m = raw.evidence[k];
    if (!isPlainObject(m)) return null;
    for (const v of Object.values(m)) {
      if (!isPlainObject(v)) return null;
      if (typeof v.score !== "number" || typeof v.events !== "number") return null;
    }
  }
  const g = raw.promotion_gate;
  if (!isPlainObject(g)) return null;
  for (const k of ["bar", "window_days", "verdicts_in_window", "suggestable", "agreements"]) {
    if (typeof g[k] !== "number" || !Number.isFinite(g[k])) return null;
  }
  if (typeof g.definition !== "string") return null;
  if (g.agreement_rate !== null && typeof g.agreement_rate !== "number") return null;
  if (typeof g.passes !== "boolean") return null;
  return raw as unknown as RankerWeights;
}
