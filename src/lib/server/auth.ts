/* Server adapter — cookie-session auth (an adapter concern, per the card:
   the domain never knows about sessions). HMAC-signed stateless cookie,
   HttpOnly, 7-day expiry; constant-time credential compare; in-memory
   failed-login rate limit.

   Env (dokku config on contabo — never in the repo):
     ME_ADMIN_USER / ME_ADMIN_PASS  the one credential pair
     ME_SESSION_SECRET              HMAC key; MUST be stable across redeploys
                                    or every session invalidates on deploy.
                                    Unset → an ephemeral secret is generated
                                    per process (dev convenience only). */

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "me_session";
/** ~7 days, per the card. */
export const SESSION_MAX_AGE_S = 7 * 24 * 60 * 60;

let ephemeralSecret: string | null = null;

function signingSecret(): string {
  const configured = process.env.ME_SESSION_SECRET;
  if (configured && configured.length >= 16) return configured;
  if (!ephemeralSecret) {
    ephemeralSecret = randomBytes(32).toString("hex");
    // eslint-disable-next-line no-console -- ops signal: why sessions died on restart
    console.warn("ME_SESSION_SECRET unset — sessions are ephemeral and die with the process");
  }
  return ephemeralSecret;
}

/** True when the credential env is present — /login offers the form only
 *  when this holds, and every login attempt fails closed otherwise. */
export function authConfigured(): boolean {
  return Boolean(process.env.ME_ADMIN_USER && process.env.ME_ADMIN_PASS);
}

/** timingSafeEqual demands equal-length inputs, and length itself leaks —
 *  so both sides are hashed to fixed-length digests before comparing. */
function secretsEqual(a: string, b: string): boolean {
  const da = createHash("sha256").update(a).digest();
  const db = createHash("sha256").update(b).digest();
  return timingSafeEqual(da, db);
}

/** Constant-time credential check: both compares always run, and the AND
 *  happens only after they complete. */
export function credentialsMatch(user: string, pass: string): boolean {
  const okUser = secretsEqual(user, process.env.ME_ADMIN_USER || "");
  const okPass = secretsEqual(pass, process.env.ME_ADMIN_PASS || "");
  return okUser && okPass;
}

/** Token = base64url("user|expiryEpochS") + "." + HMAC-SHA256(payload).
 *  Stateless — no server-side session store; the signature + expiry are
 *  the whole session. */
export function signSession(
  user: string,
  nowS: number,
  maxAgeS: number = SESSION_MAX_AGE_S,
): string {
  const payload = Buffer.from(`${user}|${nowS + maxAgeS}`).toString("base64url");
  const sig = createHmac("sha256", signingSecret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export interface SessionClaims {
  user: string;
  /** Expiry, unix seconds. */
  exp: number;
}

/** Verify a session token: signature (constant-time), then expiry. Any
 *  malformation → null (treated as logged out, never as an error). */
export function verifySession(token: string | undefined, nowS: number): SessionClaims | null {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", signingSecret()).update(payload).digest("base64url");
  if (!secretsEqual(sig, expected)) return null;
  const raw = Buffer.from(payload, "base64url").toString("utf8");
  const bar = raw.lastIndexOf("|");
  if (bar <= 0) return null;
  const user = raw.slice(0, bar);
  const exp = Number(raw.slice(bar + 1));
  if (!user || !Number.isInteger(exp) || exp <= nowS) return null;
  return { user, exp };
}

/* ---- Failed-login rate limit: in-memory, fixed 15-minute window ---- */

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;

const failures = new Map<string, number[]>();

function prune(nowMs: number): void {
  for (const [key, arr] of failures) {
    const kept = arr.filter((t) => nowMs - t < WINDOW_MS);
    if (kept.length === 0) failures.delete(key);
    else failures.set(key, kept);
  }
}

export function loginBlocked(key: string, nowMs: number): boolean {
  prune(nowMs);
  const arr = failures.get(key);
  return !!arr && arr.filter((t) => nowMs - t < WINDOW_MS).length >= MAX_FAILURES;
}

export function recordLoginFailure(key: string, nowMs: number): void {
  prune(nowMs);
  const arr = (failures.get(key) || []).filter((t) => nowMs - t < WINDOW_MS);
  arr.push(nowMs);
  failures.set(key, arr);
}
