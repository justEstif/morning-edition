/* /logout — clears the session cookie. POST only for the actual logout
   (a bare GET link must never log anyone out); GET just bounces to the
   front page. */
import { redirect } from "@sveltejs/kit";
import { SESSION_COOKIE } from "$lib/server/auth.js";
import type { RequestHandler } from "./$types.js";

export const POST: RequestHandler = async ({ cookies }) => {
  cookies.delete(SESSION_COOKIE, { path: "/" });
  redirect(303, "/login");
};

export const GET: RequestHandler = async () => {
  redirect(303, "/");
};
