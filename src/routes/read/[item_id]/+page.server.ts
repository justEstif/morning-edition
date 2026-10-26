import { error } from "@sveltejs/kit";
import {
  reduceAnnotations,
  paragraphSpans,
  verifyAnchor,
  type AnchorCheck,
  type MarkView,
} from "$lib/domain/annotations.js";
import { longDate, SECTION_TITLES } from "$lib/domain/edition.js";
import { annotations, editions, readerArticles } from "$lib/server/store.js";
import type { PageServerLoad } from "./$types.js";

/** The in-paper reader (card t_f06c164b, spike 002 variant B — marginalia):
 *  /read/<item_id> serves the item's extracted full text inside the paper.
 *
 *  Fallback contract: an item with NO extracted text (extraction failed, or
 *  the file is absent/corrupt) still gets a page — the designed "wire note"
 *  state (dashed box + external link, brief and verdict card preserved), per
 *  spike cross-cutting decision #4. It never dead-ends, and it never mutates
 *  Readeck state (archive-sync is a later card). Ids are the edition's item
 *  ids, unchanged — every ledger event from this page stays referential.
 *
 *  Owner marginalia (card t_e86490c0): for the OWNER SESSION ONLY the load
 *  attaches the reduced mark view (highlights + private notes/comments,
 *  each render-verified against the stored text) and the paragraph offset
 *  map (character offsets of every rendered paragraph into the STORED
 *  extracted text — the anchoring contract; the live DOM never stores
 *  offsets). Anonymous loads never touch the annotations store and carry
 *  neither the marks nor the offsets: no marginalia content can leak into
 *  an anonymous payload. */
export interface OwnerMark extends MarkView {
  anchor: AnchorCheck;
}

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

  // Owner-only marginalia (t_e86490c0): computed here, once, server-side —
  // the render-time verification pass lives in the domain (verifyAnchor) and
  // a drifted mark is handed to the page flagged, never silently rendered.
  const isOwner = locals.user !== null;
  let marginalia: OwnerMark[] = [];
  let paraStarts: number[] | null = null;
  if (isOwner && article) {
    const marks = reduceAnnotations(await annotations.readAll()).filter(
      (mv) => mv.item_id === item.id,
    );
    marginalia = marks.map((mv) => ({ ...mv, anchor: verifyAnchor(mv, article.text) }));
    paraStarts = paragraphSpans(article.text).map((s) => s.start);
  }

  return {
    editionDate: raw.edition_date,
    dateLong: longDate(raw.edition_date),
    sectionTitle: SECTION_TITLES[item.section] ?? item.section,
    // the full validated domain item (tier/propensity ride along harmlessly —
    // markFor and the ledger envelopes read kind/section/id off it)
    item,
    text: article?.text ?? null,
    // Reader quality gate (card t_b3782402): the builder's mode claim rides
    // with the item; the page only honors it when the stored entry actually
    // carries the digest (parsed, never trusted on both sides).
    readerMode: item.reader_mode ?? null,
    digest: article?.digest ?? null,
    more,
    isDemo: editions.isDemo,
    // Reading is public (t_43e48cd0); owner affordances — the verdict card,
    // grade links, and every write — render only for the owner session.
    isOwner,
    // Owner-only (t_e86490c0): [] and null for anonymous payloads.
    marginalia,
    paraStarts,
  };
};
