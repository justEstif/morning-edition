import { error } from "@sveltejs/kit";
import { loadEdition, IS_DEMO } from "$lib/server/store.js";
import { shapeEdition } from "$lib/edition.js";
import type { PageServerLoad } from "./$types.js";

export const ssr = true;

export const load: PageServerLoad = async ({ url }) => {
  const date = url.searchParams.get("date") || undefined;
  const raw = await loadEdition(date);
  if (!raw) {
    throw error(404, "No edition found — run the builder first");
  }
  return { edition: shapeEdition(raw), isDemo: IS_DEMO };
};
