import { error } from "@sveltejs/kit";
import { markFor, shapeEdition, SECTION_TITLES, type RawEdition } from "$lib/domain/edition.js";
import type { HighlightRow } from "$lib/domain/feedback.js";
import { editions, highlights } from "$lib/server/store.js";
import type { PageServerLoad } from "./$types.js";

const MARK_TEXT_MAX = 280;

/** One quoted Readeck mark as rendered by the panel. */
interface MarkRow {
  id: string;
  text: string;
  note: string;
  title: string;
  url: string;
  created: string;
}

/** Group synced Readeck highlights by the section their item sits in today;
 *  anything whose item isn't in this edition lands in `earlier`. */
function groupMarks(
  raw: RawEdition,
  highlights: HighlightRow[],
): { bySection: Record<string, MarkRow[]>; earlier: MarkRow[] } {
  const sectionOf = new Map((raw?.items || []).map((it) => [it.id, it.section]));
  const bySection: Record<string, MarkRow[]> = {};
  const earlier: MarkRow[] = [];
  for (const h of highlights) {
    const mark: MarkRow = {
      id: h.annotation_id || "",
      text: String(h.text || "").slice(0, MARK_TEXT_MAX),
      note: h.note || "",
      title: h.title || h.url || "",
      url: h.url || "",
      created: String(h.created || "").slice(0, 10),
    };
    const section = sectionOf.get(h.item_id);
    if (section) {
      (bySection[section] ||= []).push(mark);
    } else {
      earlier.push(mark);
    }
  }
  return { bySection, earlier };
}

/** QuickStudy panel — the same edition data, condensed into topic boxes. */
export const load: PageServerLoad = async ({ url }) => {
  const date = url.searchParams.get("date") || undefined;
  const raw = date ? await editions.loadByDate(date) : await editions.loadLatest();
  if (!raw) {
    throw error(404, "No edition found — run the builder first");
  }
  const ed = shapeEdition(raw);
  const topics = ed.sections.map((s) => ({
    key: s.key,
    title: SECTION_TITLES[s.key],
    // headlines + marks for the scan; the same brief as the broadsheet,
    // one typographic fold away (card t_dfe82b06)
    items: s.items.map((item) => ({
      id: item.id,
      title: item.title,
      url: item.url,
      brief: item.brief,
      mark: markFor(item).mark,
      source: item.source,
      kind: markFor(item).label,
      // raw builder kind — the impression event's tier (card t_41df1f78)
      tier: item.kind,
    })),
  }));
  const rows = await highlights.load();
  const marks = groupMarks(raw, rows);
  return {
    date: ed.date,
    dateLong: ed.dateLong,
    topics,
    marks,
    markCount: rows.length,
    itemCount: ed.itemCount,
    isDemo: editions.isDemo,
  };
};
