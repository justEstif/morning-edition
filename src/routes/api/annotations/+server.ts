import { json } from "@sveltejs/kit";
import {
  reduceAnnotations,
  storeQuoteContext,
  validateAnnotation,
} from "$lib/domain/annotations.js";
import { editionItemIds } from "$lib/domain/edition.js";
import { annotations, editions, readerArticles, wireDeps } from "$lib/server/store.js";
import type { AnnotationRow } from "$lib/domain/annotations.js";
import type { RequestHandler } from "./$types.js";

/** Owner marginalia API (card t_e86490c0). NOT in PUBLIC_PATHS — the session
 *  gate default-denies this whole route: anonymous requests get the hook's
 *  401 JSON before this handler ever runs, and no anonymous request can ever
 *  write a highlight, note, or comment. There is deliberately no public read
 *  either: marginalia is owner-private in v1 (card out-of-scope).
 *
 *  GET /api/annotations?item_id=<id>
 *    → { highlights: MarkView[] } — the current reduced view for one item.
 *
 *  POST /api/annotations — append one row (append-only store):
 *    {type:"highlight", item_id, edition_date, start, end}
 *      offsets into the STORED extracted text; quote + context are sliced
 *      server-side from the stored text (the client never supplies words);
 *      a write whose offsets don't fit the stored text is rejected, not
 *      guessed. Referential: the item must be in its edition (same
 *      fail-open-on-missing-edition rule as /api/corrections).
 *    {type:"note"|"comment", target, text}   — rides on a highlight id
 *    {type:"retract", target}
 *  ts/id are server-stamped (wireDeps). Shape error → 400, nothing appended.
 */
export const GET: RequestHandler = async ({ url, setHeaders }) => {
  const itemId = url.searchParams.get("item_id");
  setHeaders({ "cache-control": "no-store" });
  const rows = await annotations.readAll();
  const views = reduceAnnotations(rows);
  return json({
    highlights: itemId ? views.filter((v) => v.item_id === itemId) : views,
  });
};

export const POST: RequestHandler = async ({ request }) => {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "body must be JSON" }, { status: 400 });
  }
  let row: AnnotationRow;
  try {
    row = validateAnnotation(body, wireDeps);
  } catch (err) {
    return json(
      { error: err instanceof Error && err.message ? err.message : String(err) },
      { status: 400 },
    );
  }

  if (row.type === "highlight") {
    // Referential check (annotations store edition): the item must be in its
    // edition — no edition on disk for the date → fail-open, the same rule
    // as /api/corrections. (Written directly: the annotations store has its
    // own schema_v 1 line schema, not the ledger envelope.)
    const ed = await editions.loadByDate(row.edition_date);
    if (ed && !editionItemIds(ed).has(row.item_id)) {
      return json(
        { error: `rejected: item_id ${row.item_id} is not in edition ${row.edition_date}` },
        { status: 400 },
      );
    }
    // Anchor against the STORED text: quote + context are the stored text's
    // own words; offsets that don't fit are a client bug → 400 (never a
    // guessed mark). No stored text → nothing to anchor to → 400 too (the
    // wire-note pages offer no selection UI in the first place).
    const arts = await readerArticles.load();
    const text =
      arts && arts.edition_date === row.edition_date
        ? (arts.articles[row.item_id]?.text ?? null)
        : null;
    if (!text) {
      return json(
        { error: "rejected: no stored extracted text for this item in this edition" },
        { status: 400 },
      );
    }
    try {
      storeQuoteContext(row, text);
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
    }
  } else if (row.type !== "retract") {
    // A note/comment rides on a highlight that exists (and isn't retracted —
    // appending to a retracted mark would silently resurrect nothing; the
    // reduction drops it anyway, so refuse up front).
    const existing = reduceAnnotations(await annotations.readAll()).find(
      (v) => v.id === row.target,
    );
    if (!existing) {
      return json({ error: `rejected: no highlight ${row.target}` }, { status: 400 });
    }
  }

  await annotations.append(row);
  return json({ ok: true, row }, { status: 201 });
};
