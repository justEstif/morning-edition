/* Domain — ports (hexagonal seams).
   The ONLY contracts the outside world may meet the domain through. The
   file-store adapter (src/lib/server/store.ts) implements these today; a
   SQLite store later is just another adapter — the domain doesn't change.

   Ports are async and I/O-shaped on purpose: implementations do the I/O,
   the domain owns the semantics (validators, reduction, flip window in
   feedback.ts / edition.ts). */
import type { RawEdition } from "./edition.js";
import type { HighlightRow, LedgerEvent, RejectionRecord, VerdictEvent } from "./feedback.js";

export type { RejectionRecord };

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

/** Aggregate of the ports the routes need, as the composition root provides
 *  them (keeps route files to a single adapter import). */
export interface AppPorts {
  editions: EditionStore;
  highlights: HighlightsSource;
  corrections: CorrectionSink;
}
