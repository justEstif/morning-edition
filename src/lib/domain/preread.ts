/* Domain — the depth ladder's pre-read tier (card t_2f96c207).
   Pure types + validator for prereads.json: the ~800-word "five-minute
   version" an LLM co-writes from the already-extracted article text, served
   by the /read/<item_id> route between the headline and the full body
   (spike 002 variant B). Zero I/O, zero framework imports, zero node
   builtins (same architecture rule as edition.ts / reader.ts).

   Grounding contract (the briefs rule, verbatim): a pre-read derives ONLY
   from the article's extracted text — the pipeline prompt admits nothing
   else, and this validator enforces the mechanical half (length bounds).
   An item with no stored entry simply has no pre-read tier: the /read page
   falls back to today's layout (full text or wire note), never a dead end.

   Tier policy: pre-reads are generated at build time for lead + secondary
   items and lazily (cached here) for the briefs tier. Captured (Readeck)
   items are OUT OF SCOPE this round — they never get the tier. */

import { DATE_RE } from "./edition.js";

/** Upper bound on one stored pre-read: ~800 words target, 7000 chars is
 *  generous headroom (~1100 words); a longer "pre-read" is a corrupt file,
 *  not a pre-read. Mirrors READER_MAX_CHARS' role. */
export const PRE_READ_MAX_CHARS = 7000;

/** Below this the generation isn't a five-minute version — it's a failed
 *  one. The route treats it as absent (same honest-escalation rule as the
 *  reader gate's thin-without-digest). */
export const PRE_READ_MIN_CHARS = 300;

/** Reading-time estimate input: words per minute for engaged prose reading.
 *  The label is COMPUTED from the word count (triage decision), never a
 *  fixed "~5 min" stamped on every tier. */
export const PRE_READ_WPM = 220;

/** The pipeline's word target for one pre-read ("the five-minute version"). */
export const PRE_READ_TARGET_WORDS = 800;

/** Word count of a pre-read (whitespace-delimited, trimmed). */
export function preReadWords(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

/** Reading-time estimate in whole minutes, minimum 1 — derived from the
 *  pre-read's own word count at ~PRE_READ_WPM. */
export function readingMinutes(text: string): number {
  return Math.max(1, Math.round(preReadWords(text) / PRE_READ_WPM));
}

/** Mechanical grounding half: a pre-read must sit inside the length bounds.
 *  Generation that fails this is treated as absent — never stored, never
 *  rendered (callers on both the pipeline and the lazy path share it). */
export function validPreReadText(text: unknown): text is string {
  return (
    typeof text === "string" &&
    text.trim().length >= PRE_READ_MIN_CHARS &&
    text.length <= PRE_READ_MAX_CHARS
  );
}

/** Which edition items carry the pre-read tier (pure, shared by the route
 *  and the pipeline): successfully extracted WIRE items only. Captured
 *  (Readeck) items are out of scope for the ladder's first round, and an
 *  item with no in-paper reader text has nothing to ground a pre-read in
 *  — both keep today's page exactly as it is. */
export function preReadEligible(item: {
  has_reader?: boolean;
  section: string;
}): boolean {
  return item.has_reader === true && item.section !== "captured";
}

/** One pre-read as stored. `model` + `generated_at` are provenance only —
 *  nothing renders them (shadow data, like propensity). */
export interface PreReadEntry {
  text: string;
  model?: string;
  generated_at?: string;
}

/** prereads.json as written by the pipeline (batch) and the server (lazy):
 *  one edition date + the pre-reads for exactly that edition's items. */
export interface PreReads {
  edition_date: string;
  prereads: Record<string, PreReadEntry>;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Validate raw prereads JSON (parsed, never trusted): a dated object whose
 *  prereads map is well-formed and within bounds. Returns null on any
 *  mismatch — callers treat a corrupt file exactly like an absent one (the
 *  page renders without the tier, today's layout unchanged). */
export function parsePreReads(raw: unknown): PreReads | null {
  if (!isPlainObject(raw)) return null;
  if (typeof raw.edition_date !== "string" || !DATE_RE.test(raw.edition_date)) return null;
  if (!isPlainObject(raw.prereads)) return null;
  const prereads: Record<string, PreReadEntry> = {};
  for (const [itemId, entry] of Object.entries(raw.prereads)) {
    if (!isPlainObject(entry)) return null;
    if (!validPreReadText(entry.text)) return null;
    if (entry.model !== undefined && (typeof entry.model !== "string" || entry.model.length === 0 || entry.model.length > 100))
      return null;
    if (entry.generated_at !== undefined && (typeof entry.generated_at !== "string" || entry.generated_at.length === 0 || entry.generated_at.length > 40))
      return null;
    prereads[itemId] = {
      text: entry.text,
      ...(entry.model !== undefined ? { model: entry.model } : {}),
      ...(entry.generated_at !== undefined ? { generated_at: entry.generated_at } : {}),
    };
  }
  return { edition_date: raw.edition_date, prereads };
}
