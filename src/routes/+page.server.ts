import { error } from "@sveltejs/kit";
import { shapeEdition } from "$lib/domain/edition.js";
import { editions } from "$lib/server/store.js";
import type { PageServerLoad } from "./$types.js";

export const ssr = true;

export const load: PageServerLoad = async ({ url, locals }) => {
  const date = url.searchParams.get("date") || undefined;
  const raw = date ? await editions.loadByDate(date) : await editions.loadLatest();
  if (!raw) {
    throw error(404, "No edition found — run the builder first");
  }
  // isAdmin feeds the one discreet colophon affordance to /admin — rendered
  // only for an authenticated session (locals.user is set by the session
  // gate in hooks.server.ts); anonymous visitors never see the link at all.
  return { edition: shapeEdition(raw), isDemo: editions.isDemo, isAdmin: locals.user !== null };
};
