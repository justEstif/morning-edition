/* Public shapes shared across the app — typed loosely for now.
   Raw edition JSON comes from the Python builder (the source of truth) and
   correction bodies arrive as unvalidated wire JSON, so string fields stay
   `string` rather than narrow unions until the hexagonal domain layer
   (a later ticket) adds real validators. Verdict/reason unions here document
   the ledger schema v2 envelope that store.ts enforces at write time. */

/** One item as it appears in raw edition JSON (builder output). */
export interface EditionItem {
  id: string;
  title: string;
  url: string;
  source: string;
  section: string;
  kind: string;
  brief?: string;
  captured_at?: string;
}

/** Raw edition JSON written by the Python builder. */
export interface RawEdition {
  edition_date: string;
  items: EditionItem[];
}

/** A shaped section for rendering (empty sections omitted by shapeEdition). */
export interface ShapedSection {
  key: string;
  title: string;
  items: EditionItem[];
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

/* ----- Feedback ledger (schema v2 + legacy v1 rows) ----- */

export type Verdict = "deep-read" | "skim" | "drop";
export type Reason = "wrong-angle" | "already-read" | "wrong-source" | "dup" | "low-quality";

/** v2 verdict event (grading desk). flip_ms is stamped by the server when the
 *  verdict landed <FLIP_MS after the previous one in the same session. */
export interface VerdictEvent {
  id: string;
  ts: string;
  schema_v: 2;
  session_id: string;
  item_id: string;
  item_url?: string;
  source?: string;
  edition_date: string;
  type: "verdict";
  value: Verdict;
  reason?: Reason;
  supersedes?: string;
  flip_ms?: number;
}

/** v2 click event (edition click-through tracking). */
export interface ClickEvent {
  id: string;
  ts: string;
  schema_v: 2;
  session_id: string;
  item_id: string;
  item_url?: string;
  source?: string;
  edition_date: string;
  type: "click";
  url: string;
}

/** v1 legacy vote row (localStorage importer) — byte-identical schema. */
export interface LegacyVoteEvent {
  ts: string;
  type: "vote";
  value: "up" | "down";
  item_id: string;
  edition_date: string;
  schema_v?: undefined;
}

/** v1 legacy grade row (localStorage importer) — byte-identical schema. */
export interface LegacyGradeEvent {
  ts: string;
  type: "grade";
  value: "deep-read" | "skim" | "capture";
  item_id: string;
  edition_date: string;
  schema_v?: undefined;
}

/** Any row in corrections.jsonl. */
export type LedgerEvent = VerdictEvent | ClickEvent | LegacyVoteEvent | LegacyGradeEvent;

/** What the grading desk POSTs to /api/corrections (client side of the v2
 *  verdict envelope; ts/id/schema_v are server-stamped). */
export interface VerdictPostBody {
  type: "verdict";
  value: Verdict;
  session_id: string;
  item_id: string;
  item_url: string;
  source: string;
  edition_date: string;
  reason?: Reason;
  supersedes?: string;
}

/** One Readeck highlight row from highlights.json (pipeline sync). */
export interface HighlightRow {
  item_id: string;
  annotation_id?: string;
  text?: string;
  note?: string;
  title?: string;
  url?: string;
  created?: string;
}

/** Latest value per item for one edition (readCorrections' `last` map slot). */
export interface CorrectionSlot {
  verdict?: string;
  reason?: string;
  vote?: string;
  grade?: string;
  ev?: string;
}

/** GET /api/corrections response shape. */
export interface CorrectionsSummary {
  count: number;
  last: Record<string, CorrectionSlot>;
}
