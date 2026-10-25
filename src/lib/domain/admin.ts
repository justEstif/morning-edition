/* Domain — back-office decisions for /admin (health, restore, ledger
   counts, exposure audit, quarantine re-instate semantics). Pure: zero I/O,
   zero framework imports, zero node builtins — same inward-only rule as
   edition.ts / feedback.ts. The /admin route is a thin adapter over these
   decisions; the file copies and JSONL rewrites live in the store adapter
   (src/lib/server/store.ts). */
import { DATE_RE } from "./edition.js";
import type { LedgerEvent } from "./feedback.js";
import { validateCorrection, validateSyncEvent, type StampDeps } from "./feedback.js";

/* ----- Health (served edition vs newest on disk vs today) ----- */

export interface EditionHealth {
  /** Date of the file actually served (DATA_DIR/edition.json) — no
   *  fallback. Null when the served file is absent or corrupt. */
  servedDate: string | null;
  /** Newest dated edition on disk (max of availableDates). */
  newestDate: string | null;
  /** served < newest — restoring (or re-publishing) would refresh it. */
  behindNewest: boolean;
  /** Whole days the newest edition is behind today — the staleness warning
   *  (the builder hasn't run). Null when there are no editions at all. */
  daysBehindToday: number | null;
}

/** Days from ISO date a to b (b - a), valid YYYY-MM-DD inputs only. */
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

/** Health decision (pure): compare the served edition date against the dates
 *  available on disk and against today. availableDates must be sorted
 *  ascending and DATE_RE-clean (the adapter guarantees both). */
export function assessEditionHealth(input: {
  servedDate: string | null;
  availableDates: string[];
  today: string;
}): EditionHealth {
  const newest =
    input.availableDates.length > 0 ? input.availableDates[input.availableDates.length - 1] : null;
  const behindToday = newest && DATE_RE.test(input.today) ? daysBetween(newest, input.today) : null;
  return {
    servedDate: input.servedDate,
    newestDate: newest,
    behindNewest: input.servedDate !== null && newest !== null && input.servedDate < newest,
    daysBehindToday: behindToday !== null && Number.isFinite(behindToday) ? behindToday : null,
  };
}

/* ----- Restore (pure decision; the copy is the adapter) ----- */

/** Restore decision: returns the canonical error string, or null when the
 *  restore may proceed. A date may be restored only when a valid
 *  editions/<date>/edition.json exists on disk. */
export function restoreDecision(date: unknown, availableDates: string[]): string | null {
  if (typeof date !== "string" || !DATE_RE.test(date)) {
    return "pick a dated edition (YYYY-MM-DD)";
  }
  if (!availableDates.includes(date)) {
    return `${date} is not on disk`;
  }
  return null;
}

/* ----- Ledger counts (ledger view header + per-edition summary) ----- */

export interface LedgerCounts {
  total: number;
  byType: Record<string, number>;
  byEdition: Record<string, number>;
}

/** Counts (pure): every row tallied by event type and by edition date —
 *  including types this app doesn't model yet, so the audit never silently
 *  drops rows it doesn't recognise. */
export function ledgerCounts(rows: LedgerEvent[]): LedgerCounts {
  const byType: Record<string, number> = {};
  const byEdition: Record<string, number> = {};
  for (const ev of rows) {
    byType[ev.type] = (byType[ev.type] || 0) + 1;
    if (typeof ev.edition_date === "string") {
      byEdition[ev.edition_date] = (byEdition[ev.edition_date] || 0) + 1;
    }
  }
  return { total: rows.length, byType, byEdition };
}

/* ----- Exposure / read-stats audit (shadow-mode surface) ----- */

/** Per-section exposure. impressions stays null until impression events
 *  actually land in the ledger (signal-capture companion cards) — CTR is
 *  never faked with a made-up denominator. */
export interface SectionExposure {
  section: string;
  impressions: number | null;
  clicks: number;
  ctr: number | null;
  verdicts: number;
  /** Explore-slot subset (impressions whose explore_flag is true) — the
   *  recommender's exploration arm, auditable against the base rate. */
  exploreImpressions: number;
  exploreClicks: number;
}

export interface ExposureStats {
  /** Events by type, incl. any type this reducer doesn't model yet. */
  totals: Record<string, number>;
  perSection: SectionExposure[];
  /** Most-clicked items (clicks > 0), busiest first. */
  topItems: { itemId: string; clicks: number }[];
  /** Dwell distribution (v2 dwell events, dwell_ms buckets: <30s,
   *  30s–2m, 2–10m, 10–30m — the validator caps dwell at 30 min). */
  dwellBuckets: { b0_30s: number; b30s_2m: number; b2m_10m: number; b10m_30m: number };
  /** True when at least one impression event exists (CTRs are then real). */
  hasImpressionData: boolean;
}

/** The exposure reducer must keep working over event types the committed
 *  ledger schema doesn't model yet (impression/dwell arrive via the
 *  signal-capture cards), so their payload fields are read structurally off
 *  this widened row — never via type imports that would couple this module
 *  to a schema revision. */
type WideRow = LedgerEvent & Record<string, unknown>;

function finiteNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function bump(map: Record<string, number>, key: string, by = 1): void {
  map[key] = (map[key] || 0) + by;
}

/** Exposure reduction (pure) over the parsed ledger with an item→section map
 *  from the served edition. Impression events carry their own section —
 *  that wins; other event types map through sectionOf (their item's slot in
 *  the served edition), with `earlier` as the catch-all. read_progress stays
 *  out of the dwell histogram on purpose: it is Readeck's own progress, not
 *  edition dwell. Rows are taken as unknown and read structurally: this
 *  audit must survive ledger rows written by schema revisions newer than
 *  this module's committed union. */
export function exposureStats(
  rows: readonly unknown[],
  sectionOf: Map<string, string>,
): ExposureStats {
  const totals: Record<string, number> = {};
  const impressions: Record<string, number> = {};
  const clicks: Record<string, number> = {};
  const verdicts: Record<string, number> = {};
  const exploreImpressions: Record<string, number> = {};
  const exploreItems = new Set<string>();
  const clicksByItem: Record<string, number> = {};
  const dwell = { b0_30s: 0, b30s_2m: 0, b2m_10m: 0, b10m_30m: 0 };

  for (const row of rows) {
    const ev = row as WideRow;
    const type = ev.type as string;
    bump(totals, type);
    if (type === "impression") {
      const section = typeof ev.section === "string" ? ev.section : "earlier";
      bump(impressions, section);
      if (ev.explore_flag === true) {
        bump(exploreImpressions, section);
        exploreItems.add(ev.item_id as string);
      }
    } else if (type === "click") {
      const section = sectionOf.get(ev.item_id) || "earlier";
      bump(clicks, section);
      bump(clicksByItem, ev.item_id);
    } else if (type === "verdict") {
      bump(verdicts, sectionOf.get(ev.item_id) || "earlier");
    } else if (type === "dwell" && finiteNum(ev.dwell_ms)) {
      const ms = ev.dwell_ms;
      if (ms < 30_000) dwell.b0_30s++;
      else if (ms < 120_000) dwell.b30s_2m++;
      else if (ms < 600_000) dwell.b2m_10m++;
      else dwell.b10m_30m++;
    }
  }

  const hasImpressionData = Object.keys(impressions).length > 0;
  const sections = [
    ...new Set([...Object.keys(impressions), ...Object.keys(clicks), ...Object.keys(verdicts)]),
  ].sort((a, b) => a.localeCompare(b));

  const perSection: SectionExposure[] = sections.map((s) => {
    const imp = impressions[s];
    const clk = clicks[s] || 0;
    return {
      section: s,
      impressions: imp === undefined ? null : imp,
      clicks: clk,
      ctr: imp ? clk / imp : null,
      verdicts: verdicts[s] || 0,
      exploreImpressions: exploreImpressions[s] || 0,
      exploreClicks: [...exploreItems]
        .filter((id) => sectionOf.get(id) === s)
        .reduce((n, id) => n + (clicksByItem[id] || 0), 0),
    };
  });

  const topItems = Object.entries(clicksByItem)
    .map(([itemId, n]) => ({ itemId, clicks: n }))
    .sort((a, b) => b.clicks - a.clicks || a.itemId.localeCompare(b.itemId))
    .slice(0, 10);

  return { totals, perSection, topItems, dwellBuckets: dwell, hasImpressionData };
}

/* ----- Quarantine re-instate (pure decision) ----- */

/** Re-instate decision (pure): a quarantined row may rejoin the ledger only
 *  when it validates as a canonical event — the quarantine pen can hold
 *  rows from either writer, so both unions are tried (public first, then
 *  the trusted sync path). Returns the canonical row to append, or null
 *  (the row is malformed and can only be discarded).
 *
 *  Semantics of a re-instate (enforced by the adapter's order of ops): the
 *  row re-enters as a FRESH APPEND — id/ts are re-stamped — because the
 *  main ledger is append-only and is never rewritten. The quarantined copy
 *  keeps its original shape until the row is discarded from the pen. */
export function reinstateCandidate(row: unknown, deps: StampDeps): LedgerEvent | null {
  try {
    return validateCorrection(row, deps);
  } catch {
    // not a public-surface event — try the sync union before giving up
  }
  try {
    return validateSyncEvent(row, deps);
  } catch {
    return null;
  }
}
