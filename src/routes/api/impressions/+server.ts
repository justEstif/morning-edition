import { json } from "@sveltejs/kit";
import {
  rejectionRecordFor,
  referentiallyValid,
  validateImpressionBatch,
} from "$lib/domain/feedback.js";
import { editionItemIds } from "$lib/domain/edition.js";
import { corrections, editions, wireDeps } from "$lib/server/store.js";
import type { LedgerEvent } from "$lib/domain/feedback.js";
import type { RequestHandler } from "./$types.js";

/**
 * POST /api/impressions — append a batch of viewport-exposure events to the
 * same JSONL ledger the corrections route appends to (card t_41df1f78,
 * research R1: impressions are the denominator for every engagement rate).
 *   body: {events: [{session_id, item_id, edition_date, position, section,
 *                    tier, seen_ms, item_url?, source?, explore_flag?,
 *                    propensity?}, ...]}
 * ts/id/schema_v are server-stamped; the client qualifies exposures before
 * sending (≥50% viewport held ≥500ms, one impression per item+session+
 * edition — those thresholds live in the domain and are re-enforced by
 * validateImpressionBatch here).
 * Session-gated exactly like /api/corrections POST: the same proxy auth
 * covers both, so public visitors are never tracked — Estifanos's
 * logged-in reading is the signal.
 * Rejections mirror the corrections contract: a shape error anywhere in the
 * batch → 400, nothing appended; an event whose item_id is not in its
 * edition_date's edition → 400 for the whole batch (all-or-nothing) and a
 * rejection record per bad event in rejections.jsonl — invalid rows never
 * reach the ledger.
 */
export const POST: RequestHandler = async ({ request }) => {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "body must be JSON" }, { status: 400 });
  }
  try {
    const events = validateImpressionBatch(body, wireDeps);

    // Referential check, one edition load per distinct date in the batch.
    const failOpenIds = new Map<string, Set<string> | null>();
    const invalid: LedgerEvent[] = [];
    for (const ev of events) {
      let ids = failOpenIds.get(ev.edition_date);
      if (ids === undefined) {
        const ed = await editions.loadByDate(ev.edition_date);
        ids = ed ? editionItemIds(ed) : null;
        failOpenIds.set(ev.edition_date, ids);
      }
      if (!referentiallyValid(ev, ids)) invalid.push(ev);
    }
    if (invalid.length > 0) {
      for (const ev of invalid) await corrections.recordRejection(rejectionRecordFor(ev, wireDeps));
      return json(
        {
          error: `rejected: ${invalid.length} of ${events.length} events reference an item_id absent from their edition`,
        },
        { status: 400 },
      );
    }

    for (const ev of events) await corrections.append(ev);
    return json({ ok: true, appended: events.length }, { status: 201 });
  } catch (err) {
    return json(
      { error: err instanceof Error && err.message ? err.message : String(err) },
      { status: 400 },
    );
  }
};
