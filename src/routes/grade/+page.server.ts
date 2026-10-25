import { error } from "@sveltejs/kit";
import { loadEdition, IS_DEMO } from "$lib/server/store.js";
import { shapeEdition, markFor } from "$lib/edition.js";
import type { PageServerLoad } from "./$types.js";

/** The Grading Desk — one pass, one verdict per item (v2); verdict events POST
 *  to /api/corrections with the full v2 envelope (url + source ride along so
 *  the ledger is self-describing). */
export const load: PageServerLoad = async ({ url }) => {
  const date = url.searchParams.get("date") || undefined;
  const raw = await loadEdition(date);
  if (!raw) {
    throw error(404, "No edition found — run the builder first");
  }
  const ed = shapeEdition(raw);
  const rows = [];
  for (const s of ed.sections) {
    for (const item of s.items) {
      const m = markFor(item);
      // brief rides along: grade with context, not headline-only
      rows.push({
        id: item.id,
        title: item.title,
        url: item.url,
        source: item.source,
        brief: item.brief,
        mark: `${m.mark} ${m.label}`,
      });
    }
  }
  return { date: ed.date, dateLong: ed.dateLong, rows, itemCount: ed.itemCount, isDemo: IS_DEMO };
};
