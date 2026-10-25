import { error } from "@sveltejs/kit";
import { shapeEdition } from "$lib/domain/edition.js";
import { editions } from "$lib/server/store.js";
import type { PageServerLoad } from "./$types.js";

export const ssr = true;

export const load: PageServerLoad = async ({ url }) => {
  const date = url.searchParams.get("date") || undefined;
  const raw = date ? await editions.loadByDate(date) : await editions.loadLatest();
  if (!raw) {
    throw error(404, "No edition found — run the builder first");
  }
  return { edition: shapeEdition(raw), isDemo: editions.isDemo };
};
