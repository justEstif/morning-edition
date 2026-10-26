/* The session gate. One hook guards every surface: public stays public
   (/, /login, /api/edition, and every /read/<id> reader page — reading is
   public, card t_43e48cd0); everything else — /grade, /panel, /admin,
   all of /api/corrections (GET included: its response is per-item
   verdicts, and /api/edition maps ids to headlines, so together they
   would expose his reading history), /api/impressions (the sibling
   card's contract: logged-in signals only, public visitors are never
   tracked), and /api/annotations (the owner's private marginalia —
   highlights, notes, comments; card t_e86490c0; there is deliberately no
   anonymous read of it either) — requires a valid session cookie.
   Default-deny: any future route is private until added here. The /read
   pages themselves render for anonymous visitors, but every write from
   them (verdicts, clicks, impressions, dwell, marks) lands on a gated
   /api route and is refused — anonymous reading never writes owner
   signal.
   API surfaces answer 401 JSON (never a redirect); pages 303 to the login
   door with a `next` return path. */
import { redirect, type Handle } from "@sveltejs/kit";
import { SESSION_COOKIE, verifySession } from "$lib/server/auth.js";

const PUBLIC_PATHS = new Set(["/", "/login", "/api/edition"]);
/** Public route prefixes (the in-paper reader). */
const PUBLIC_PREFIXES = ["/read/"];

export const handle: Handle = async ({ event, resolve }) => {
  const claims = verifySession(event.cookies.get(SESSION_COOKIE), Math.floor(Date.now() / 1000));
  event.locals.user = claims?.user ?? null;

  const isPublic =
    PUBLIC_PATHS.has(event.url.pathname) ||
    PUBLIC_PREFIXES.some((prefix) => event.url.pathname.startsWith(prefix));
  if (event.locals.user || isPublic) {
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
