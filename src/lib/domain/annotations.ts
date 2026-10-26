/* Domain — owner marginalia (card t_e86490c0): highlights, notes, comments,
   retracts. The durable, append-friendly owner-scoped store that sits
   alongside the feedback ledger: annotations.jsonl on the data volume, one
   JSON object per line, append-only, file order = append order.

   Highlights anchor to CHARACTER OFFSETS IN THE STORED EXTRACTED TEXT
   (reader-articles.json, card t_f06c164b) — never to the live DOM. The
   offset range is the contract; quote/prefix/suffix are sliced from the
   stored text at write time by the server, so what is stored is what the
   text said. A render-time verification pass (verifyAnchor) compares the
   stored quote back against the CURRENT stored text: on drift the mark is
   never silently mis-rendered — it is reported, unrendered, and the
   marginalia card says the mark lost its anchor. The extraction itself is
   never mutated (card out-of-scope).

   Row schema (annotations.jsonl; schema_v is THIS file's, independent of
   the ledger's v1/v2):

     {"id":"a-<rand>","ts":"ISO-8601","schema_v":1,"type":"highlight",
      "item_id":"...","edition_date":"YYYY-MM-DD",
      "start":1234,"end":1300,"quote":"...","prefix":"...","suffix":"..."}
     {"id":"n-<rand>","ts":"...","schema_v":1,"type":"note",
      "target":"a-<rand>","text":"..."}
     {"id":"c-<rand>","ts":"...","schema_v":1,"type":"comment",
      "target":"a-<rand>","text":"..."}
     {"id":"d-<rand>","ts":"...","schema_v":1,"type":"retract",
      "target":"a-<rand>"}

   Zero I/O, zero node builtins — time and ids are injected (StampDeps),
   same architecture rule as feedback.ts. Owner-private by construction:
   nothing here is ever serialized into an anonymous response; the /read
   load attaches marginalia only for the owner session. */

import { DATE_RE } from "./edition.js";
import { READER_MAX_CHARS } from "./reader.js";

/* ----- Rows (the append-only store's line schema) ----- */

export interface HighlightRow {
  id: string;
  ts: string;
  schema_v: 1;
  type: "highlight";
  item_id: string;
  edition_date: string;
  /** Character offsets into the STORED extracted text, start < end. */
  start: number;
  end: number;
  /** text.slice(start, end) at write time — the stored text's own words. */
  quote: string;
  /** Quote context for render-time drift detection. */
  prefix?: string;
  suffix?: string;
}

export interface AttachedTextRow {
  id: string;
  ts: string;
  schema_v: 1;
  type: "note" | "comment";
  /** The highlight id this rides on. */
  target: string;
  text: string;
}

export interface RetractRow {
  id: string;
  ts: string;
  schema_v: 1;
  type: "retract";
  target: string;
}

/** Any line in annotations.jsonl. */
export type AnnotationRow = HighlightRow | AttachedTextRow | RetractRow;

/* ----- Bounds (validator-enforced; the wire can't smuggle junk) ----- */

export const MAX_QUOTE_CHARS = 2000;
export const MAX_CONTEXT_CHARS = 200;
export const MAX_TEXT_CHARS = 5000;
/** A mark must cover at least this many characters — a stray click on one
 *  glyph is not a highlight. */
export const MIN_MARK_CHARS = 3;

/* ----- Reduction: rows → current marginalia view ----- */

export interface MarkAttachment {
  id: string;
  ts: string;
  text: string;
}

/** One highlight as it currently stands, with its attached notes/comments. */
export interface MarkView {
  id: string;
  item_id: string;
  edition_date: string;
  ts: string;
  start: number;
  end: number;
  quote: string;
  prefix?: string;
  suffix?: string;
  notes: MarkAttachment[];
  comments: MarkAttachment[];
}

/** Reduce append-order rows to the current view. A retract removes its
 *  highlight and (with it) any notes/comments riding on it — attachments to
 *  a retracted target are dropped, never orphaned. Repeated retracts of the
 *  same target are idempotent. Notes/comments targeting an unknown id are
 *  dropped (their highlight was retracted earlier in the file). */
export function reduceAnnotations(rows: AnnotationRow[]): MarkView[] {
  const byId = new Map<string, MarkView>();
  const retracted = new Set<string>();
  for (const row of rows) {
    if (row.type === "highlight") {
      if (!byId.has(row.id)) {
        byId.set(row.id, {
          id: row.id,
          item_id: row.item_id,
          edition_date: row.edition_date,
          ts: row.ts,
          start: row.start,
          end: row.end,
          quote: row.quote,
          ...(row.prefix !== undefined ? { prefix: row.prefix } : {}),
          ...(row.suffix !== undefined ? { suffix: row.suffix } : {}),
          notes: [],
          comments: [],
        });
      }
    } else if (row.type === "retract") {
      retracted.add(row.target);
    } else {
      const mark = byId.get(row.target);
      if (mark && !retracted.has(row.target)) {
        mark[row.type === "note" ? "notes" : "comments"].push({
          id: row.id,
          ts: row.ts,
          text: row.text,
        });
      }
    }
  }
  const out: MarkView[] = [];
  for (const mark of byId.values()) {
    if (!retracted.has(mark.id)) out.push(mark);
  }
  return out;
}

/* ----- Anchoring: offsets into the STORED text ----- */

/** One stored-text paragraph with its character span in the ORIGINAL stored
 *  text. paragraphSpans mirrors the renderer's split exactly
   (text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean)) while carrying
   the offsets the live DOM cannot know. */
export interface ParaSpan {
  text: string;
  start: number;
  end: number;
}

export function paragraphSpans(text: string): ParaSpan[] {
  const spans: ParaSpan[] = [];
  const sep = /\n{2,}/g;
  let blockStart = 0;
  let m: RegExpExecArray | null;
  const pushBlock = (block: string, at: number) => {
    const lead = block.length - block.trimStart().length;
    const trimmed = block.trim();
    if (trimmed.length > 0) {
      spans.push({ text: trimmed, start: at + lead, end: at + lead + trimmed.length });
    }
  };
  while ((m = sep.exec(text)) !== null) {
    pushBlock(text.slice(blockStart, m.index), blockStart);
    blockStart = m.index + m[0].length;
  }
  pushBlock(text.slice(blockStart), blockStart);
  return spans;
}

/** Render-time verification (card acceptance: drift is detected, never
 *  silently mis-rendered). ok=true exactly when the CURRENT stored text
 *  still says the stored quote at the stored offsets. On mismatch the quote
 *  is searched for once, read-only, to tell the owner WHERE the mark
 *  wandered — the stored offsets are never rewritten here. */
export type AnchorCheck = { ok: true } | { ok: false; drift: true; relocatedAt: number | null };

export function verifyAnchor(
  mark: { start: number; end: number; quote: string },
  text: string,
): AnchorCheck {
  if (mark.end <= mark.start || text.slice(mark.start, mark.end) === mark.quote) {
    // An empty range verifies trivially (nothing can be mis-rendered);
    // a matching slice is the pass we want.
    return { ok: true };
  }
  const at = mark.quote.length > 0 ? text.indexOf(mark.quote) : -1;
  return { ok: false, drift: true, relocatedAt: at >= 0 ? at : null };
}

/* ----- Rendering: paragraph text → marked segments ----- */

/** One render piece of a paragraph: plain text, or a mark's slice. */
export interface Seg {
  text: string;
  markId: string | null;
}

/** Slice one paragraph into render segments under its marks. Marks are
 *  clipped to the paragraph; non-intersecting marks are ignored; overlapping
 *  marks render the EARLIER one and drop the later overlap (nested marks
 *  are not a v1 shape — append-order wins, nothing silently shifts). */
export function paragraphSegments(
  para: { start: number; end: number; text: string },
  marks: Array<{ id: string; start: number; end: number }>,
): Seg[] {
  const paraLen = para.end - para.start;
  const clipped = marks
    .map((mk) => ({
      id: mk.id,
      from: Math.max(0, mk.start - para.start),
      to: Math.min(paraLen, mk.end - para.start),
    }))
    .filter((mk) => mk.to > mk.from)
    .sort((a, b) => a.from - b.from || b.to - a.to);
  const segs: Seg[] = [];
  let cursor = 0;
  for (const mk of clipped) {
    if (mk.from < cursor) continue; // overlap with a placed mark: dropped
    if (mk.from > cursor) segs.push({ text: para.text.slice(cursor, mk.from), markId: null });
    segs.push({ text: para.text.slice(mk.from, mk.to), markId: mk.id });
    cursor = mk.to;
  }
  if (cursor < paraLen) segs.push({ text: para.text.slice(cursor), markId: null });
  return segs;
}

/* ----- Validation (wire body → canonical row, throws on anything else) ----- */

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function bounded(v: unknown, max: number): string | undefined {
  return typeof v === "string" && v.length > 0 && v.length <= max ? v : undefined;
}

function baseRow(body: Record<string, unknown>, deps: StampDeps) {
  return { id: deps.newId(), ts: deps.now(), schema_v: 1 as const };
}

/** Clock + id factory — the same injection contract as feedback.ts. */
export interface StampDeps {
  now(): string;
  newId(): string;
}

/** Validate one marginalia write off the OWNER-gated API (wire body →
 *  canonical AnnotationRow, throws on anything else). Highlights carry
 *  offsets only; the SERVER slices quote/prefix/suffix from the stored text
 *  (storeQuoteContext) so the store holds the text's own words, not the
 *  client's claim. */
export function validateAnnotation(body: unknown, deps: StampDeps): AnnotationRow {
  if (!isPlainObject(body)) throw new Error("body must be a JSON object");
  const type = body.type;

  if (type === "highlight") {
    const itemId = bounded(body.item_id, 200);
    if (!itemId) throw new Error("item_id required");
    const editionDate = body.edition_date;
    if (typeof editionDate !== "string" || !DATE_RE.test(editionDate))
      throw new Error("edition_date must be YYYY-MM-DD");
    const { start, end } = body;
    if (
      typeof start !== "number" ||
      !Number.isInteger(start) ||
      start < 0 ||
      start > READER_MAX_CHARS
    )
      throw new Error(`start must be an integer in [0, ${READER_MAX_CHARS}]`);
    if (
      typeof end !== "number" ||
      !Number.isInteger(end) ||
      end < start + MIN_MARK_CHARS ||
      end > READER_MAX_CHARS
    )
      throw new Error(`end must be an integer in [${start + MIN_MARK_CHARS}, ${READER_MAX_CHARS}]`);
    return {
      ...baseRow(body, deps),
      type,
      item_id: itemId,
      edition_date: editionDate,
      start,
      end,
      // quote + context are the server's job (storeQuoteContext) — the
      // client supplies offsets only, never the words.
      quote: "",
    };
  }

  if (type === "note" || type === "comment" || type === "retract") {
    const target = bounded(body.target, 100);
    if (!target) throw new Error("target (a highlight id) required");
    if (type === "retract") return { ...baseRow(body, deps), type, target };
    const text = bounded(body.text, MAX_TEXT_CHARS);
    if (!text) throw new Error(`${type} requires text (1-${MAX_TEXT_CHARS} chars)`);
    return { ...baseRow(body, deps), type, target, text };
  }

  throw new Error("type must be highlight|note|comment|retract");
}

/** Fill a highlight row's quote + context from the STORED text (the server
 *  owns the words — the client only ever supplies offsets). Mutates the row
 *  like the append it precedes. Throws when the offsets fall outside the
 *  text (a write against a text we don't have can't be anchored). */
export function storeQuoteContext(
  row: AnnotationRow,
  text: string,
  contextChars: number = MAX_CONTEXT_CHARS,
): void {
  if (row.type !== "highlight") return;
  if (row.end > text.length)
    throw new Error(`offsets past end of stored text (${text.length} chars)`);
  row.quote = text.slice(row.start, row.end);
  const prefix = text.slice(Math.max(0, row.start - contextChars), row.start);
  const suffix = text.slice(row.end, row.end + contextChars);
  if (prefix) row.prefix = prefix;
  if (suffix) row.suffix = suffix;
}
