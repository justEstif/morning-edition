import { error } from "@sveltejs/kit";
import { longDate, SECTION_TITLES } from "$lib/domain/edition.js";
import { editions, readerArticles } from "$lib/server/store.js";
import type { PageServerLoad } from "./$types.js";

/** The in-paper reader (card t_f06c164b, spike 002 variant B — marginalia):
 *  /read/<item_id> serves the item's extracted full text inside the paper.
 *
 *  Fallback contract: an item with NO extracted text (extraction failed, or
 *  the file is absent/corrupt) still gets a page — the designed "wire note"
 *  state (dashed box + external link, brief and verdict card preserved), per
 *  spike cross-cutting decision #4. It never dead-ends, and it never mutates
 *  Readeck state (archive-sync is a later card). Ids are the edition's item
 *  ids, unchanged — every ledger event from this page stays referential. */
export const load: PageServerLoad = async ({ params, url, locals }) => {
  const date = url.searchParams.get("date") || undefined;
  const raw = date ? await editions.loadByDate(date) : await editions.loadLatest();
  if (!raw) {
    throw error(404, "No edition found — run the builder first");
  }
  const item = raw.items.find((i) => i.id === params.item_id);
  if (!item) {
    throw error(404, `No story '${params.item_id}' in this edition`);
  }
  const arts = await readerArticles.load();
  const article =
    arts && arts.edition_date === raw.edition_date ? (arts.articles[item.id] ?? null) : null;

  // "More in this section" (spike decision #5): the cheap recommendation-loop
  // exit — same section, presentation order, this item skipped, in-paper
  // links where the reader exists, external otherwise.
  const more = raw.items
    .filter((i) => i.section === item.section && i.id !== item.id)
    .slice(0, 3)
    .map((i) => ({
      id: i.id,
      title: i.title,
      href: i.has_reader ? `/read/${i.id}` : i.url,
      inPaper: i.has_reader === true,
    }));

  return {
    editionDate: raw.edition_date,
    dateLong: longDate(raw.edition_date),
    sectionTitle: SECTION_TITLES[item.section] ?? item.section,
    // the full validated domain item (tier/propensity ride along harmlessly —
    // markFor and the ledger envelopes read kind/section/id off it)
    item,
    text: article?.text ?? null,
    more,
    isDemo: editions.isDemo,
    // Reading is public (t_43e48cd0); owner affordances — the verdict card,
    // grade links, and every write — render only for the owner session.
    isOwner: locals.user !== null,
  };
};
