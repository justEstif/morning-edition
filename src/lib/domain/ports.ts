/* Domain — ports (hexagonal seams).
   The ONLY contracts the outside world may meet the domain through. The
   file-store adapter (src/lib/server/store.ts) implements these today; a
   SQLite store later is just another adapter — the domain doesn't change.

   Ports are async and I/O-shaped on purpose: implementations do the I/O,
   the domain owns the semantics (validators, reduction, flip window in
   feedback.ts / edition.ts). */
import type { RawEdition } from "./edition.js";
import type { HighlightRow, LedgerEvent, RejectionRecord, VerdictEvent } from "./feedback.js";
import type { ExploreCandidate, ExplorePick } from "./explore.js";
import type { PoolCandidate } from "./pool.js";
import type { ReaderArticles } from "./reader.js";

export type { RejectionRecord };

/** The explore-slot decision (research R3, card t_889bc508). Unlike the I/O
 *  ports below this is a PURE function contract: given the candidate pool
 *  with current rubric scores and the edition-date seed, return the 1–3
 *  explore picks. domain/explore.ts's selectExplore is the canonical
 *  implementation; the builder is just an adapter calling it. SHADOW-MODE:
 *  nothing consumes the picks for ranking yet. */
export type Explorer = (candidates: ExploreCandidate[], editionDate: string) => ExplorePick[];

/** Edition JSON access (read-only — the builder is the source of truth and
 *  nothing in this app ever writes edition JSON). */
export interface EditionStore {
  /** True when running on demo data (no ME_DATA_DIR configured). */
  readonly isDemo: boolean;
  /** The edition currently served: DATA_DIR/edition.json, falling back to
   *  the max-dated file under editions/. Null when none exists/valid. */
  loadLatest(): Promise<RawEdition | null>;
  /** A specific edition by YYYY-MM-DD date. Malformed dates → null. */
  loadByDate(date: string): Promise<RawEdition | null>;
}

/** Synced Readeck highlight rows (highlights.json on the volume, written by
 *  the pipeline). Absent file → empty — the panel omits the study boxes. */
export interface HighlightsSource {
  load(): Promise<HighlightRow[]>;
}

/** Append-only feedback ledger + its side logs. Implementations must keep
 *  corrections.jsonl append-only (one validated JSON object per line) and
 *  keep quarantined rows out of readRaw. */
export interface CorrectionSink {
  /** Append one validated event. Verdicts get write-time burst detection
   *  (flip_ms stamped via the domain's attachFlipMs). */
  append(ev: LedgerEvent): Promise<void>;
  /** Parsed ledger rows, file order (= append order); torn/corrupt lines are
   *  skipped, optional filter by edition_date. */
  readRaw(date?: string): Promise<LedgerEvent[]>;
  /** Log a write-time referential rejection — never appended to the ledger. */
  recordRejection(rec: RejectionRecord): Promise<void>;
  /** Most recent verdict event for a session+item+edition (flip detection). */
  lastVerdictInSession(
    sessionId: string,
    itemId: string,
    editionDate: string,
  ): Promise<VerdictEvent | null>;
}

/** Read-only view of the persistent candidate pool (pool.json on the
 *  volume, written by the pipeline's fetchers; the builder marks rows used
 *  across the day boundary). Consumers MUST recompute state with the
 *  domain's effectiveState — the stored `state` is only a write-time cache
 *  and time moves on between writes. This is the seam the explore slot
 *  (domain/explore.ts) reads through — no direct file reads. */
export interface PoolStore {
  /** All pool rows, file order. Absent/corrupt file → [] (an empty pool
   *  just means nothing to explore). */
  load(): Promise<PoolCandidate[]>;
}

/** Extracted full article text for the edition's deep-read / captured items
 *  (reader-articles.json on the volume, written by the pipeline; served by
 *  the /read/<id> route, card t_f06c164b). Null when absent or corrupt — the
 *  reader route then falls back to the item's external URL. */
export interface ReaderSource {
  load(): Promise<ReaderArticles | null>;
}

/** Aggregate of the ports the routes need, as the composition root provides
 *  them (keeps route files to a single adapter import). */
export interface AppPorts {
  editions: EditionStore;
  highlights: HighlightsSource;
  corrections: CorrectionSink;
  pool: PoolStore;
  reader: ReaderSource;
}
