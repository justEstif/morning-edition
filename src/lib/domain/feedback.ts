/* Domain — feedback ledger.
   The typed, centralized form of the ledger schema documented in the file
   store adapter (src/lib/server/store.ts): envelope v2 + legacy v1 rows,
   event-type unions, verdict union, reason chips, validateCorrection
   semantics, referential validation, write-time flip window, and the
   latest-per-item ledger reduction. Zero I/O, zero node builtins — time and
   ids are injected by the caller (StampDeps), never generated here.

   Ledger schema v2 (grading-desk v2, card t_9f03de41) — every event carries
   a shared envelope; `schema_v` keeps v1 rows readable forever:

     {"id":"e-<rand>","ts":"ISO-8601","schema_v":2,"session_id":"...",
      "item_id":"...","item_url":"...","source":"readeck|miniflux|hn",
      "edition_date":"YYYY-MM-DD",
      "type":"verdict|click|read_progress|star|capture|highlight",
      ...type payload}

   PUBLIC API SURFACE vs TRUSTED SYNC PATH (enforced by type + validator):
   the human-facing API accepts only verdict|click (plus legacy v1 vote|grade
   rows). read_progress, star, capture and highlight are implicit signals and
   ride the trusted direct-append sync path only (pipeline sync_signals.py,
   session_id "sync-<origin>") — they are validated by validateSyncEvent,
   which the public route never calls, and the public input union simply has
   no member for them.

   `skip` is derived downstream (presented >=2 editions, zero events) and is
   never stored. */
import { DATE_RE } from "./edition.js";

/* ----- Unions ----- */

export type Verdict = "deep-read" | "skim" | "drop";
export type Reason = "wrong-angle" | "already-read" | "wrong-source" | "dup" | "low-quality";
export type LedgerEventType =
  | "verdict"
  | "click"
  | "read_progress"
  | "star"
  | "capture"
  | "highlight"
  | "vote"
  | "grade";
/** Types the human-facing /api/corrections POST accepts (v2 + legacy v1). */
export type PublicCorrectionType = "verdict" | "click" | "vote" | "grade";
/** Implicit signal types — trusted sync path ONLY, never the public API. */
export type SyncEventType = "read_progress" | "star" | "capture" | "highlight";

export const VERDICT_VALUES: Verdict[] = ["deep-read", "skim", "drop"];
export const REASONS: Reason[] = [
  "wrong-angle",
  "already-read",
  "wrong-source",
  "dup",
  "low-quality",
];
const VOTE_VALUES = ["up", "down"];
const GRADE_VALUES = ["deep-read", "skim", "capture"];

/** Verdicts landing within this window after the previous one in the same
 *  session+item are annotated flip_ms (burst → down-weight, not
 *  last-write-wins). */
export const FLIP_MS = 2000;

/* ----- v2 envelope + events ----- */

/** Shared v2 envelope fields (id + ts are server-stamped at write time). */
interface Envelope {
  id: string;
  ts: string;
  schema_v: 2;
  session_id: string;
  item_id: string;
  item_url?: string;
  source?: string;
  edition_date: string;
}

/** v2 verdict event (grading desk). flip_ms is stamped by the server when the
 *  verdict landed <FLIP_MS after the previous one in the same session. */
export interface VerdictEvent extends Envelope {
  type: "verdict";
  value: Verdict;
  reason?: Reason;
  supersedes?: string;
  flip_ms?: number;
}

/** v2 click event (edition click-through tracking). */
export interface ClickEvent extends Envelope {
  type: "click";
  url: string;
}

/** v2 read_progress event (Readeck sync, by id). */
export interface ReadProgressEvent extends Envelope {
  type: "read_progress";
  origin: "readeck";
  progress_pct: number;
}

/** v2 star event (Miniflux sync). */
export interface StarEvent extends Envelope {
  type: "star";
  origin: "miniflux";
  starred: boolean;
}

/** v2 capture event (a Readeck save IS the capture; synced by id). */
export interface CaptureEvent extends Envelope {
  type: "capture";
  origin: "readeck";
}

/** v2 highlight event (synced from Readeck annotations by readeck item id;
 *  one event per annotation). */
export interface HighlightEvent extends Envelope {
  type: "highlight";
  origin: "readeck";
  kind: "highlight";
  annotation_id: string;
  text: string;
  created: string;
  note?: string;
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

/** v2 events that only the trusted sync path may write. */
export type SyncLedgerEvent = ReadProgressEvent | StarEvent | CaptureEvent | HighlightEvent;

/** Any row in corrections.jsonl. */
export type LedgerEvent =
  | VerdictEvent
  | ClickEvent
  | SyncLedgerEvent
  | LegacyVoteEvent
  | LegacyGradeEvent;

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

/** Every wire body the public API accepts. The implicit types have no member
 *  here — the type system itself rejects them on the public surface. */
export type PublicCorrectionInput =
  | VerdictPostBody
  | {
      type: "click";
      url: string;
      session_id: string;
      item_id: string;
      item_url?: string;
      source?: string;
      edition_date: string;
    }
  | { type: "vote"; value: "up" | "down"; item_id: string; edition_date: string }
  | {
      type: "grade";
      value: "deep-read" | "skim" | "capture";
      item_id: string;
      edition_date: string;
    };

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

/** Latest value per item for one edition (summarizeCorrections' `last` map
 *  slot). */
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

/** Clock + id factory injected by the calling adapter — the domain never
 *  touches node:crypto or stamps time itself. */
export interface StampDeps {
  now(): string;
  newId(): string;
}

/** Write-time referential rejection record (rejections.jsonl row). */
export interface RejectionRecord {
  ts: string;
  reason: string;
  session_id?: string;
  type?: string;
  value?: string;
  url?: string;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function bounded(v: unknown, max: number): string | undefined {
  return typeof v === "string" && v.length > 0 && v.length <= max ? v : undefined;
}

/** Validate one feedback event off the PUBLIC surface (v1 or v2); returns the
 *  canonical object or throws. `body` is unvalidated wire JSON — anything
 *  goes in, only a LedgerEvent comes out. Implicit sync types (read_progress,
 *  star, capture, highlight) are rejected here by design: they never enter
 *  through the public API. */
export function validateCorrection(body: unknown, deps: StampDeps): LedgerEvent {
  if (!isPlainObject(body)) throw new Error("body must be a JSON object");
  const type = body.type;

  // v1 legacy rows: byte-identical canonical schema, still accepted so the
  // localStorage importer and any old client keep working.
  if (type === "vote" || type === "grade") {
    const value = body.value;
    if (type === "vote" && !VOTE_VALUES.includes(value as string))
      throw new Error("vote value must be up|down");
    if (type === "grade" && !GRADE_VALUES.includes(value as string))
      throw new Error("grade value must be deep-read|skim|capture");
    const itemId = body.item_id;
    if (typeof itemId !== "string" || itemId.length === 0 || itemId.length > 200)
      throw new Error("item_id required");
    const editionDate = body.edition_date;
    if (typeof editionDate !== "string" || !DATE_RE.test(editionDate))
      throw new Error("edition_date must be YYYY-MM-DD");
    // Key order matches the canonical v1 schema exactly. ts is server-stamped.
    return {
      ts: deps.now(),
      type,
      value,
      item_id: itemId,
      edition_date: editionDate,
    } as LegacyGradeEvent | LegacyVoteEvent;
  }

  // v2 events: shared envelope + type payload. Implicit signal types are
  // sync-path only — they are structurally absent from the public input
  // union and rejected here at runtime.
  if (type !== "verdict" && type !== "click") {
    throw new Error("type must be verdict|click (or legacy vote|grade)");
  }
  const sessionId = bounded(body.session_id, 100);
  if (!sessionId) throw new Error("session_id required (v2 envelope)");
  const itemId = bounded(body.item_id, 200);
  if (!itemId) throw new Error("item_id required");
  const editionDate = body.edition_date;
  if (typeof editionDate !== "string" || !DATE_RE.test(editionDate))
    throw new Error("edition_date must be YYYY-MM-DD");

  const ev = {
    id: deps.newId(),
    ts: deps.now(),
    schema_v: 2 as const,
    session_id: sessionId,
    item_id: itemId,
    item_url: bounded(body.item_url, 2000),
    source: bounded(body.source, 40),
    edition_date: editionDate,
    type,
  };

  if (type === "verdict") {
    if (!VERDICT_VALUES.includes(body.value as Verdict)) {
      throw new Error("verdict value must be deep-read|skim|drop");
    }
    const out: VerdictEvent = { ...ev, type, value: body.value as Verdict };
    if (body.reason !== undefined && body.reason !== null) {
      if (!REASONS.includes(body.reason as Reason)) {
        throw new Error("reason must be one of: " + REASONS.join("|"));
      }
      out.reason = body.reason as Reason;
    }
    if (body.supersedes !== undefined && body.supersedes !== null) {
      const sup = bounded(body.supersedes, 100);
      if (!sup) throw new Error("supersedes must be an event id");
      out.supersedes = sup;
    }
    return out;
  }
  // click
  const url = bounded(body.url, 2000);
  if (!url) throw new Error("click requires url");
  return { ...ev, type, url };
}

/** Validate one IMPLICIT signal event off the TRUSTED sync path (pipeline
 *  sync_signals.py; session_id "sync-<origin>"). Same envelope rules, plus
 *  the type payload for read_progress|star|capture|highlight. Never expose
 *  through the public API. */
export function validateSyncEvent(body: unknown, deps: StampDeps): SyncLedgerEvent {
  if (!isPlainObject(body)) throw new Error("body must be a JSON object");
  const type = body.type;
  if (type !== "read_progress" && type !== "star" && type !== "capture" && type !== "highlight") {
    throw new Error("type must be read_progress|star|capture|highlight");
  }
  const sessionId = bounded(body.session_id, 100);
  if (!sessionId || !sessionId.startsWith("sync-"))
    throw new Error('sync events require session_id "sync-<origin>"');
  const itemId = bounded(body.item_id, 200);
  if (!itemId) throw new Error("item_id required");
  const editionDate = body.edition_date;
  if (typeof editionDate !== "string" || !DATE_RE.test(editionDate))
    throw new Error("edition_date must be YYYY-MM-DD");

  const base = {
    id: deps.newId(),
    ts: deps.now(),
    schema_v: 2 as const,
    session_id: sessionId,
    item_id: itemId,
    item_url: bounded(body.item_url, 2000),
    source: bounded(body.source, 40),
    edition_date: editionDate,
  };

  if (type === "read_progress") {
    const pct = body.progress_pct;
    if (typeof pct !== "number" || !Number.isFinite(pct) || pct < 0 || pct > 100)
      throw new Error("read_progress requires progress_pct 0-100");
    return { ...base, type, origin: "readeck", progress_pct: pct };
  }
  if (type === "star") {
    if (typeof body.starred !== "boolean") throw new Error("star requires starred boolean");
    return { ...base, type, origin: "miniflux", starred: body.starred };
  }
  if (type === "capture") {
    return { ...base, type, origin: "readeck" };
  }
  // highlight
  const annotationId = bounded(body.annotation_id, 200);
  if (!annotationId) throw new Error("highlight requires annotation_id");
  const out: HighlightEvent = {
    ...base,
    type,
    origin: "readeck",
    kind: "highlight",
    annotation_id: annotationId,
    text: typeof body.text === "string" ? body.text : "",
    created: typeof body.created === "string" ? body.created : "",
  };
  const note = bounded(body.note, 2000);
  if (note) out.note = note;
  return out;
}

/** Referential validation (pure core): a v2 event must reference an item that
 *  was actually presented in its edition. Legacy rows predate edition-carried
 *  ids and always pass. `itemIds === null` means no edition on disk for that
 *  date — FAILS OPEN (nothing to check against; a ghost date with a ghost id
 *  is accepted until that edition is built — acceptable for a personal
 *  pipeline, where editions are rsynced before grading happens). */
export function referentiallyValid(ev: LedgerEvent, itemIds: Set<string> | null): boolean {
  if (ev.schema_v !== 2) return true;
  if (itemIds === null) return true;
  return itemIds.has(ev.item_id);
}

/** The rejection record an invalid reference logs (adapter writes it to
 *  rejections.jsonl — never into the ledger). */
export function rejectionRecordFor(ev: LedgerEvent, deps: StampDeps): RejectionRecord {
  return {
    ts: deps.now(),
    reason: `item_id ${ev.item_id} absent from edition ${ev.edition_date}`,
    session_id: ev.schema_v === 2 ? ev.session_id : undefined,
    type: ev.type,
    value: "value" in ev ? ev.value : undefined,
    url: "url" in ev ? ev.url : undefined,
  };
}

/** Write-time burst detection (pure): stamp flip_ms when this verdict landed
 *  <FLIP_MS after the previous verdict for the same session+item+edition.
 *  Mutates ev like the ledger write it precedes. */
export function attachFlipMs(ev: LedgerEvent, prev: LedgerEvent | null): void {
  if (ev.schema_v !== 2 || ev.type !== "verdict") return;
  if (!prev || prev.schema_v !== 2 || prev.type !== "verdict") return;
  const delta = Date.parse(ev.ts) - Date.parse(prev.ts);
  if (delta >= 0 && delta < FLIP_MS) ev.flip_ms = delta;
}

/** Read the ledger rows and reduce to { count, last } — latest event per item
 *  wins (file order is append order). v2 verdict events map to
 *  verdict/reason/ev; legacy grade deep-read|skim map to verdict; legacy vote
 *  stays vote; legacy capture stays grade (no v2 verdict — a Readeck save is
 *  the capture signal now). Rows for other editions (or without a date) still
 *  count when no filter is given; implicit sync types count but fill no
 *  slot. Quarantined rows live in their own file and never reach this
 *  function. */
export function summarizeCorrections(rows: LedgerEvent[], date?: string): CorrectionsSummary {
  const last: Record<string, CorrectionSlot> = {};
  let count = 0;
  for (const ev of rows) {
    if (date && ev.edition_date !== date) continue;
    count++;
    const slot = (last[ev.item_id] ||= {});
    if (ev.schema_v === 2 && ev.type === "verdict") {
      slot.verdict = ev.value;
      slot.reason = ev.reason; // a superseding verdict without a reason clears it
      if (ev.id) slot.ev = ev.id;
    } else if (ev.type === "grade") {
      if (ev.value === "capture") slot.grade = ev.value;
      else slot.verdict = ev.value;
    } else if (ev.type === "vote") {
      slot.vote = ev.value;
    }
  }
  return { count, last };
}
