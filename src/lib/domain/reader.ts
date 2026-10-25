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

/** One article's extracted text, keyed by its edition item id. `url` is the
 *  item's original external URL (the honest fallback and the "read at the
 *  source" credit line); `text` is plain text with \n\n paragraph breaks. */
export interface ReaderArticle {
  url: string;
  text: string;
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
    articles[itemId] = { url: entry.url, text: entry.text };
  }
  return { edition_date: raw.edition_date, articles };
}
