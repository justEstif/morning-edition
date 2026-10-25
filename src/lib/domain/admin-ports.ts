/* Domain — back-office ports (admin half of the hexagonal seams).
   Kept beside ports.ts as its own module so the admin surface has one
   importable seam; same inward-only rule. Implementations live in the file
   adapter (src/lib/server/admin-store.ts). */
import type { RawEdition } from "./edition.js";
import type { LedgerEvent } from "./feedback.js";

/** Strict read of the SERVED edition file (DATA_DIR/edition.json) — no
 *  fallback to the newest dated edition, so health diagnostics can tell
 *  "the served file is missing/corrupt" apart from "serving via fallback". */
export interface ServedEditionReader {
  loadServed(): Promise<RawEdition | null>;
}

/** Restore port — the copy of a dated edition over the served edition.json.
 *  The decision is domain (restoreDecision in domain/admin.ts); the file
 *  copy is the adapter's. The Python builder stays the source of truth: a
 *  restore is an explicit back-office act that swaps which built edition is
 *  served, never a hand-edited edition. */
export interface EditionRestore {
  /** Dates with an editions/<date>/edition.json on disk, sorted ascending,
   *  DATE_RE-clean. */
  availableDates(): Promise<string[]>;
  /** Copy editions/<date>/edition.json over the served file (verbatim,
   *  atomic). Null when the date is unknown or its JSON is corrupt — the
   *  served file is then untouched. */
  restore(date: string): Promise<RawEdition | null>;
}

/** The quarantine holding pen (corrections-quarantine.jsonl). Rows here are
 *  excluded from every ledger read. APPEND-ONLY RULE: the main ledger stays
 *  append-only — re-instate = append the row to the ledger (fresh id/ts, a
 *  new append) and only then drop it from this pen; discard = drop from the
 *  pen. This is the one ledger-adjacent file that may shrink.
 *
 *  Rows are addressed by a positional token (`q<index>`, index into
 *  read()'s file order) because quarantined rows may be malformed and lack
 *  an event id entirely. Single-admin surface — the read/act race is
 *  accepted and the adapters fail closed on a stale token. */
export interface QuarantineStore {
  /** Parsed rows in file order (torn lines skipped). */
  read(): Promise<LedgerEvent[]>;
  /** Drop the row at `token` by rewriting the pen file. False when the
   *  token didn't match (already gone). */
  discard(token: string): Promise<boolean>;
}
