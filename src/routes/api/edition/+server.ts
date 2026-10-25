import { json } from "@sveltejs/kit";
import { editions } from "$lib/server/store.js";
import type { RequestHandler } from "./$types.js";

/** GET /api/edition?date=YYYY-MM-DD — raw edition JSON from the builder.
 *  Thin adapter over the EditionStore port; parsed, never trusted. */
export const GET: RequestHandler = async ({ url, setHeaders }) => {
  const date = url.searchParams.get("date") || undefined;
  const raw = date ? await editions.loadByDate(date) : await editions.loadLatest();
  if (!raw) {
    return json({ error: "edition not found" }, { status: 404 });
  }
  setHeaders({ "cache-control": "no-store" });
  return json({ ...raw, demo: editions.isDemo });
};
