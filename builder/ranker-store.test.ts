import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readLedger } from "./ranker-store.js";

/* The classify-and-ignore filter (card t_e86490c0): the ranker's ledger read
   must never weigh a row explicitly stamped with a non-owner audience, and
   must keep both unstamped (legacy) and owner-stamped rows. */

const dir = mkdtempSync(join(tmpdir(), "me-ranker-"));
const ledger = join(dir, "corrections.jsonl");
process.env.ME_LEDGER_PATH = ledger;

afterAll(() => {
  delete process.env.ME_LEDGER_PATH;
  rmSync(dir, { recursive: true, force: true });
});

const OWNER_VERDICT = {
  id: "e-1",
  ts: "2026-10-26T12:00:00.000Z",
  schema_v: 2,
  session_id: "s1",
  item_id: "readeck-1",
  edition_date: "2026-10-26",
  type: "verdict",
  value: "deep-read",
  audience: "owner",
};
const ANON_IMPRESSION = {
  id: "e-2",
  ts: "2026-10-26T12:01:00.000Z",
  schema_v: 2,
  session_id: "stranger",
  item_id: "readeck-1",
  edition_date: "2026-10-26",
  type: "impression",
  position: 1,
  section: "lead",
  tier: "story",
  seen_ms: 900,
  audience: "anon",
};
const LEGACY_VERDICT = {
  ts: "2026-10-20T12:00:00.000Z",
  type: "verdict",
  value: "skim",
  item_id: "readeck-2",
  edition_date: "2026-10-20",
};

describe("readLedger — classify-and-ignore at the ranker's read seam", () => {
  it("keeps owner and legacy rows, drops any explicitly non-owner row", () => {
    writeFileSync(
      ledger,
      [
        JSON.stringify(OWNER_VERDICT),
        JSON.stringify(ANON_IMPRESSION),
        JSON.stringify(LEGACY_VERDICT),
        "{torn line",
        "",
      ].join("\n"),
      "utf-8",
    );
    const events = readLedger();
    expect(events).not.toBeNull();
    expect(events!.map((e) => e.type)).toEqual(["verdict", "verdict"]);
    expect(events!.map((e) => e.item_id)).toEqual(["readeck-1", "readeck-2"]);
    // a torn line never breaks the read
    expect(readFileSync(ledger, "utf-8")).toContain("torn line");
  });

  it("drops every flavor of non-owner audience stamp (forward-compatible)", () => {
    writeFileSync(
      ledger,
      [
        JSON.stringify({ ...ANON_IMPRESSION, audience: "anon" }),
        JSON.stringify({ ...ANON_IMPRESSION, id: "e-3", audience: "friend" }),
      ].join("\n"),
      "utf-8",
    );
    expect(readLedger()).toEqual([]);
  });
});
