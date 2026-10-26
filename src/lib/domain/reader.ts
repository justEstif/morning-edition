/* Domain — the in-paper reader (card t_f06c164b, store-roles R1).
   Pure types + validator for reader-articles.json: the extracted full text
   of the edition's deep-read / captured items, written by the pipeline
   (make_edition.ts build, from editions/DATE/extracted.json) onto the data
   volume, served by the /read/<item_id> route through the ReaderSource port.
   Zero I/O, zero framework imports, zero node builtins (same architecture
   rule as edition.ts).

   Failure contract mirrors the HN extraction rules: an item whose extraction
   failed simply has no entry here — the /read route falls back to the
   item's external URL (the pre-reader behavior), never a dead end. */

import { DATE_RE } from "./edition.js";

/** Upper bound on one stored article's text — extraction output is capped
 *  here by the pipeline (pySlice) before it is ever written; the validator
 *  rejects anything larger so a corrupt file can't smuggle garbage into a
 *  page render. ~60k chars ≈ a very long feature; typical articles are 5–30k. */
export const READER_MAX_CHARS = 60_000;

/** Reader quality gate — the mode decision (card t_b3782402). Pure, so the
 *  pipeline (make_edition build) and the tests share one rule; the THIN
 *  threshold itself lives pipeline-side (pipeline/extract.ts
 *  READER_THIN_CHARS, next to MIN_TEXT_CHARS) because thinness is a property
 *  of the extraction, not of the app.
 *
 *    full text (≥ thinChars)  → has_reader, no mode (today's behavior)
 *    thin text + digest       → has_reader + reader_mode:"digest" — the
 *                               digest is the page's main content, the raw
 *                               extract demotes below the fold
 *    thin text, no digest     → wire-note tier (external link); a hollow
 *                               one-paragraph "article" is never stored
 *    no text                  → wire-note tier, exactly as before
 *
 *  A "digest" at least as long as its source is not compression — it is
 *  treated as absent (grounded compression only; honest about the source). */
export interface ReaderGateDecision {
  has_reader: boolean;
  reader_mode?: "digest";
  /** The trimmed digest that justified digest mode (absent otherwise) — the
   *  pipeline writes it onto the reader-articles entry. */
  digest?: string;
  /** Store a reader-articles entry: full text always; thin text only when a
   *  digest exists to carry the page (thin-without-digest stores nothing). */
  store: boolean;
}

export function readerGate(
  text: string | undefined,
  digest: string | undefined,
  thinChars: number,
): ReaderGateDecision {
  if (!text) return { has_reader: false, store: false };
  if (text.length >= thinChars) return { has_reader: true, store: true };
  const d = digest?.trim();
  if (d && d.length > 0 && d.length < text.length)
    return { has_reader: true, reader_mode: "digest", digest: d, store: true };
  return { has_reader: false, store: false };
}

/** Note appended by truncateForReader when text was cut. The ※ marks it so
 * the renderer can style it as a printer's note rather than body prose. */
export const TRUNCATION_NOTE =
  "※ Transcript truncated at the paper's length limit — the full captions remain on the video.";

/** Cap one article's text at `max` chars, cutting at a PARAGRAPH boundary
 *  (card t_5c435af7): the last \n\n before the budget wins; if there is no
 *  usable paragraph break (one wall of prose), fall back to a word boundary
 *  rather than mid-word. The result always ends at or under `max` chars
 *  WITH the note included, so the validator's READER_MAX_CHARS rule and the
 *  renderer both hold. Texts already under the cap pass through untouched. */
export function truncateForReader(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  const budget = max - TRUNCATION_NOTE.length - 2; // room for \n\n + note
  let cut = text.lastIndexOf("\n\n", budget);
  if (cut < max * 0.5) {
    const space = text.lastIndexOf(" ", budget);
    cut = space > 0 ? space : budget;
  }
  return { text: `${text.slice(0, cut).trimEnd()}\n\n${TRUNCATION_NOTE}`, truncated: true };
}

/** One article's extracted text, keyed by its edition item id. `url` is the
 *  item's original external URL (the honest fallback and the "read at the
 *  source" credit line); `text` is plain text with \n\n paragraph breaks.
 *  `digest` (card t_b3782402) is the build-time LLM compression for THIN
 *  extractions — present only when the item's reader_mode is "digest"; the
 *  /read page shows it as the main content, labeled, with `text` demoted
 *  below the fold as the raw extract. */
export interface ReaderArticle {
  url: string;
  text: string;
  digest?: string;
}

/** reader-articles.json as written by the pipeline: one edition date + the
 *  articles for exactly the items that edition presented (referential
 *  subset — an article for an absent item is never stored). */
export interface ReaderArticles {
  edition_date: string;
  articles: Record<string, ReaderArticle>;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Validate raw reader-articles JSON (parsed, never trusted): a dated object
 *  whose articles map is well-formed. Returns null on any mismatch — callers
 *  treat a corrupt file exactly like an absent one (external-link fallback). */
export function parseReaderArticles(raw: unknown): ReaderArticles | null {
  if (!isPlainObject(raw)) return null;
  if (typeof raw.edition_date !== "string" || !DATE_RE.test(raw.edition_date)) return null;
  if (!isPlainObject(raw.articles)) return null;
  const articles: Record<string, ReaderArticle> = {};
  for (const [itemId, entry] of Object.entries(raw.articles)) {
    if (!isPlainObject(entry)) return null;
    if (typeof entry.url !== "string" || entry.url.length === 0 || entry.url.length > 2000)
      return null;
    if (typeof entry.text !== "string" || entry.text.length === 0) return null;
    if (entry.text.length > READER_MAX_CHARS) return null;
    if (entry.digest !== undefined) {
      if (typeof entry.digest !== "string" || entry.digest.trim().length === 0) return null;
      if (entry.digest.length > READER_MAX_CHARS) return null;
    }
    articles[itemId] = {
      url: entry.url,
      text: entry.text,
      ...(entry.digest !== undefined ? { digest: entry.digest } : {}),
    };
  }
  return { edition_date: raw.edition_date, articles };
}
