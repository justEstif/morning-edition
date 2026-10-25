/* /login — the door. A form POST validates ME_ADMIN_USER/ME_ADMIN_PASS
   (constant-time), rate-limits failures per client IP (in-memory), and sets
   the signed HttpOnly session cookie (~7 days). `next` is honored only for
   same-site paths (starts with a single "/") — no open redirect. */
import { fail, redirect } from "@sveltejs/kit";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_S,
  authConfigured,
  credentialsMatch,
  loginBlocked,
  recordLoginFailure,
  signSession,
} from "$lib/server/auth.js";
import type { Actions, PageServerLoad } from "./$types.js";

/** Same-site relative paths only. */
function safeNext(raw: string | null): string {
  return raw !== null && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
}

export const load: PageServerLoad = async ({ locals, url }) => {
  if (locals.user) redirect(303, safeNext(url.searchParams.get("next")));
  return {
    configured: authConfigured(),
    next: safeNext(url.searchParams.get("next")),
  };
};

export const actions: Actions = {
  default: async ({ cookies, request, url, getClientAddress }) => {
    // Fail closed: without the credential env the door has no lock.
    if (!authConfigured()) {
      return fail(503, { error: "the door has no lock configured (server env missing)" });
    }
    const ip = getClientAddress();
    const nowMs = Date.now();
    if (loginBlocked(ip, nowMs)) {
      return fail(429, { error: "too many failed attempts — try again in fifteen minutes" });
    }
    const form = await request.formData();
    const user = String(form.get("user") ?? "");
    const pass = String(form.get("pass") ?? "");
    const next = safeNext(String(form.get("next") ?? "") || url.searchParams.get("next"));
    if (!user || !pass || !credentialsMatch(user, pass)) {
      recordLoginFailure(ip, nowMs);
      return fail(401, { error: "wrong name or password" });
    }
    // Secure when the deployment origin is https (dokku sets ORIGIN);
    // plain http locally stays testable.
    const https = (process.env.ORIGIN ?? url.origin).startsWith("https://");
    cookies.set(SESSION_COOKIE, signSession(user, Math.floor(nowMs / 1000)), {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: https,
      maxAge: SESSION_MAX_AGE_S,
    });
    redirect(303, next);
  },
};
