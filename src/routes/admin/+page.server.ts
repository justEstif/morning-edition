/* /admin — the back office. Health (served vs newest edition), the ledger
   view (counts + recent events + rejections + per-edition summary), restore
   previous edition (domain decision + confirm; the copy is the adapter),
   quarantine management (re-instate appends + drops from the pen; discard
   drops), and the read-stats exposure audit. All semantics live in the
   domain (domain/admin.ts); this file is a thin adapter over the ports. */
import { fail } from "@sveltejs/kit";
import {
  assessEditionHealth,
  exposureStats,
  ledgerCounts,
  reinstateCandidate,
  restoreDecision,
} from "$lib/domain/admin.js";
import { SECTION_TITLES } from "$lib/domain/edition.js";
import { corrections, editions, wireDeps } from "$lib/server/store.js";
import {
  adminRestore,
  quarantine,
  readRejections,
  servedEditions,
} from "$lib/server/admin-store.js";
import type { Actions, PageServerLoad } from "./$types.js";

/** How much of each log the ledger view shows. */
const RECENT_EVENTS = 200;
const RECENT_REJECTIONS = 25;

/** Quarantine rows are addressed by position in file order (`q<N>`) —
 *  quarantined rows may be malformed and lack an event id. */
const Q_TOKEN_RE = /^q(\d+)$/;

export const load: PageServerLoad = async () => {
  const served = await servedEditions.loadServed();
  const dates = await adminRestore.availableDates();
  const health = assessEditionHealth({
    servedDate: served?.edition_date ?? null,
    availableDates: dates,
    today: new Date().toISOString().slice(0, 10),
  });

  const rows = await corrections.readRaw();
  const counts = ledgerCounts(rows);
  const rejections = await readRejections(RECENT_REJECTIONS);
  const quarantined = await quarantine.read();

  // sectionOf comes from the edition being presented to readers (the served
  // file, falling back to the newest on disk exactly like the routes do) —
  // exposure stats must always use the presented layout.
  const presented = served ?? (await editions.loadLatest());
  const sectionOf = new Map<string, string>();
  if (presented) for (const it of presented.items) sectionOf.set(it.id, it.section);
  const stats = exposureStats(rows, sectionOf);

  return {
    health,
    availableDates: dates,
    isDemo: !process.env.ME_DATA_DIR,
    counts,
    recent: rows.slice(-RECENT_EVENTS).reverse(),
    recentTotal: Math.min(rows.length, RECENT_EVENTS),
    rejections,
    quarantined,
    sectionTitles: SECTION_TITLES,
    stats,
  };
};

export const actions: Actions = {
  /** Restore a dated edition over the served file — with an explicit
   *  confirm tick (the form refuses to send without it). */
  restore: async ({ request }) => {
    const form = await request.formData();
    const date = form.get("date");
    const dates = await adminRestore.availableDates();
    const problem = restoreDecision(date, dates);
    if (problem) return fail(400, { kind: "restore", error: problem });
    if (form.get("confirm") !== "yes") {
      return fail(400, {
        kind: "restore",
        error: "tick the confirm box — this overwrites the served edition",
      });
    }
    const ed = await adminRestore.restore(date as string);
    if (!ed)
      return fail(400, {
        kind: "restore",
        error: `${date} exists but its edition.json is corrupt`,
      });
    return { kind: "restore", ok: true, message: `the served edition is now ${ed.edition_date}` };
  },

  /** Re-instate: append the row to the main ledger (fresh id/ts — the
   *  ledger is append-only, the row re-enters as a new append) and only
   *  then drop it from the quarantine pen. Malformed rows can't be
   *  re-instated; they can only be discarded. */
  reinstate: async ({ request }) => {
    const form = await request.formData();
    const token = String(form.get("token") ?? "");
    if (!Q_TOKEN_RE.test(token))
      return fail(400, { kind: "quarantine", error: "bad row reference" });
    const rows = await quarantine.read();
    const row = rows[Number(token.slice(1))];
    if (row === undefined)
      return fail(400, { kind: "quarantine", error: "that row is no longer in the pen" });
    const canonical = reinstateCandidate(row, wireDeps);
    if (!canonical) {
      return fail(400, {
        kind: "quarantine",
        error: "that row is malformed — it can only be discarded, not re-instated",
      });
    }
    await corrections.append(canonical);
    await quarantine.discard(token);
    const evId = "id" in canonical ? canonical.id : canonical.item_id;
    return { kind: "quarantine", ok: true, message: `row re-instated to the ledger as ${evId}` };
  },

  /** Discard: drop the row from the pen. The ledger is untouched. */
  discard: async ({ request }) => {
    const form = await request.formData();
    const token = String(form.get("token") ?? "");
    if (!Q_TOKEN_RE.test(token))
      return fail(400, { kind: "quarantine", error: "bad row reference" });
    const removed = await quarantine.discard(token);
    if (!removed)
      return fail(400, { kind: "quarantine", error: "that row is no longer in the pen" });
    return { kind: "quarantine", ok: true, message: "row discarded from quarantine" };
  },
};
