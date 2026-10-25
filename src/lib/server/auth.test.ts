import { afterEach, describe, expect, it } from "vitest";
import {
  SESSION_MAX_AGE_S,
  authConfigured,
  credentialsMatch,
  loginBlocked,
  recordLoginFailure,
  signSession,
  verifySession,
} from "./auth.js";

const T0 = 1_793_000_000; // arbitrary fixed "now" in unix seconds

function withEnv(env: Record<string, string | undefined>, fn: () => void): void {
  const keys = new Set([
    ...Object.keys(env),
    "ME_SESSION_SECRET",
    "ME_ADMIN_USER",
    "ME_ADMIN_PASS",
  ]);
  const saved = new Map([...keys].map((k) => [k, process.env[k]]));
  for (const k of keys) {
    const v = env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

afterEach(() => {
  delete process.env.ME_SESSION_SECRET;
  delete process.env.ME_ADMIN_USER;
  delete process.env.ME_ADMIN_PASS;
});

describe("session tokens", () => {
  it("round-trips: sign then verify returns the user and expiry", () => {
    withEnv({ ME_SESSION_SECRET: "x".repeat(32) }, () => {
      const token = signSession("estifanos", T0);
      expect(verifySession(token, T0 + 10)).toEqual({
        user: "estifanos",
        exp: T0 + SESSION_MAX_AGE_S,
      });
    });
  });

  it("rejects a tampered payload and a tampered signature", () => {
    withEnv({ ME_SESSION_SECRET: "x".repeat(32) }, () => {
      const token = signSession("estifanos", T0);
      const [payload, sig] = token.split(".");
      const forgedPayload = Buffer.from(`attacker|${T0 + 9999}`).toString("base64url");
      expect(verifySession(`${forgedPayload}.${sig}`, T0 + 10)).toBeNull();
      expect(verifySession(`${payload}.${"A".repeat(sig.length)}`, T0 + 10)).toBeNull();
    });
  });

  it("rejects expired tokens and garbage", () => {
    withEnv({ ME_SESSION_SECRET: "x".repeat(32) }, () => {
      const token = signSession("estifanos", T0 - SESSION_MAX_AGE_S - 10); // exp in the past
      expect(verifySession(token, T0)).toBeNull();
      for (const junk of [undefined, "", "abc", "a.b", ".sig", "payload."]) {
        expect(verifySession(junk, T0)).toBeNull();
      }
    });
  });

  it("a rotated secret invalidates old sessions (why ME_SESSION_SECRET must be stable)", () => {
    const token = signSession("estifanos", T0);
    withEnv({ ME_SESSION_SECRET: "y".repeat(32) }, () => {
      expect(verifySession(token, T0 + 10)).toBeNull();
    });
  });
});

describe("credentials", () => {
  it("configured() requires both env vars", () => {
    withEnv({ ME_ADMIN_USER: "estifanos", ME_ADMIN_PASS: "pw" }, () => {
      expect(authConfigured()).toBe(true);
    });
    withEnv({ ME_ADMIN_USER: "estifanos" }, () => {
      expect(authConfigured()).toBe(false);
    });
  });

  it("matches only the exact pair; empty env never matches", () => {
    withEnv({ ME_ADMIN_USER: "estifanos", ME_ADMIN_PASS: "s3cret" }, () => {
      expect(credentialsMatch("estifanos", "s3cret")).toBe(true);
      expect(credentialsMatch("estifanos", "wrong")).toBe(false);
      expect(credentialsMatch("root", "s3cret")).toBe(false);
      expect(credentialsMatch("", "")).toBe(false);
    });
    withEnv({}, () => {
      expect(credentialsMatch("estifanos", "s3cret")).toBe(false);
    });
  });
});

describe("failed-login rate limit", () => {
  it("blocks after MAX failures inside the window, clears outside it", () => {
    const key = "1.2.3.4";
    const W = 15 * 60 * 1000;
    for (let i = 0; i < 10; i++) recordLoginFailure(key, i);
    expect(loginBlocked(key, 11)).toBe(true);
    // a fresh window is a fresh chance
    expect(loginBlocked(key, W + 12)).toBe(false);
    // other keys are unaffected
    expect(loginBlocked("5.6.7.8", 11)).toBe(false);
  });
});
