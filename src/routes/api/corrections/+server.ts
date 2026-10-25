import { json } from "@sveltejs/kit";
import { summarizeCorrections, validateCorrection } from "$lib/domain/feedback.js";
import { corrections, referentiallyValidAgainstDisk, wireDeps } from "$lib/server/store.js";
import type { RequestHandler } from "./$types.js";

/** GET /api/corrections?date=YYYY-MM-DD — ledger count + latest value per item
 *  (v2 verdict/reason/ev; legacy vote/grade rows stay readable). Thin adapter:
 *  the reduction is domain summarizeCorrections over the sink's parsed rows. */
export const GET: RequestHandler = async ({ url, setHeaders }) => {
  const date = url.searchParams.get("date") || undefined;
  setHeaders({ "cache-control": "no-store" });
  return json(summarizeCorrections(await corrections.readRaw(), date));
};

/**
 * POST /api/corrections — append one feedback event to the server-side JSONL
 * ledger (restart-safe: the file lives on the host volume). ts is stamped by
 * the server.
 *   v2 (grading-desk v2): the event carries the shared envelope
 *     {type:"verdict", value:"deep-read|skim|drop", session_id, item_id,
 *      item_url?, source?, edition_date, reason?, supersedes?}
 *     {type:"click", url, session_id, item_id, item_url?, source?, edition_date}
 *   v1 (legacy importer): {type:"vote|grade", value:"up|down|deep-read|skim|capture",
 *    item_id:"...", edition_date:"YYYY-MM-DD"}
 * The implicit signal types (read_progress, star, capture, highlight) are NOT
 * accepted here — they are appended directly by the pipeline's sync_signals.py
 * on the trusted sync path (session_id "sync-<origin>"). That exclusion is
 * enforced in the domain (validateCorrection — the public input union has no
 * member for them); this handler only does HTTP. A v2 event whose item_id is
 * not in its edition_date's edition is rejected (400) and logged to
 * rejections.jsonl — it never reaches the ledger.
 */
export const POST: RequestHandler = async ({ request }) => {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "body must be JSON" }, { status: 400 });
  }
  try {
    const ev = validateCorrection(body, wireDeps);
    if (!(await referentiallyValidAgainstDisk(ev))) {
      return json(
        { error: `rejected: item_id ${ev.item_id} is not in edition ${ev.edition_date}` },
        { status: 400 },
      );
    }
    await corrections.append(ev);
    return json({ ok: true, event: ev }, { status: 201 });
  } catch (err) {
    return json(
      { error: err instanceof Error && err.message ? err.message : String(err) },
      { status: 400 },
    );
  }
};
