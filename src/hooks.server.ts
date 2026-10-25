/* The session gate. One hook guards every surface: public stays public
   (/, /api/edition, /login); everything else — /grade, /panel, /admin,
   all of /api/corrections (GET included: its response is per-item
   verdicts, and /api/edition maps ids to headlines, so together they
   would expose his reading history), and /api/impressions (the sibling
   card's contract: logged-in signals only, public visitors are never
   tracked) — requires a valid session cookie. Default-deny: any future
   route is private until added here.
   API surfaces answer 401 JSON (never a redirect); pages 303 to the login
   door with a `next` return path. */
import { redirect, type Handle } from "@sveltejs/kit";
import { SESSION_COOKIE, verifySession } from "$lib/server/auth.js";

const PUBLIC_PATHS = new Set(["/", "/login", "/api/edition"]);

export const handle: Handle = async ({ event, resolve }) => {
  const claims = verifySession(event.cookies.get(SESSION_COOKIE), Math.floor(Date.now() / 1000));
  event.locals.user = claims?.user ?? null;

  if (event.locals.user || PUBLIC_PATHS.has(event.url.pathname)) {
    return resolve(event);
  }
  if (event.url.pathname.startsWith("/api/")) {
    return new Response(JSON.stringify({ error: "authentication required" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  redirect(303, `/login?next=${encodeURIComponent(event.url.pathname + event.url.search)}`);
};
