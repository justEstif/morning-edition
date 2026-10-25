#!/usr/bin/env node
/* One-line importer for feedback exported from the old localStorage demo:
     npm run import-votes -- me-feedback-20261025.jsonl \
       [--url https://morning-edition.estifanos.cc] [--auth user:pass]
   Accepts the export JSONL (one event per line) or a JSON array of events.
   Each line is POSTed to /api/corrections; the server re-stamps ts, validates
   the schema, and appends to its restart-safe ledger. Idempotent-ish: a line
   the server rejects is reported, not fatal. */

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
function opt(name) {
  const i = args.indexOf("--" + name);
  return i >= 0 ? args[i + 1] : undefined;
}

const base = opt("url") || process.env.ME_URL || "http://127.0.0.1:3000";
const auth = opt("auth") || process.env.ME_AUTH;

if (!file) {
  console.error("usage: npm run import-votes -- <export.jsonl> [--url URL] [--auth user:pass]");
  process.exit(2);
}

const { readFile } = await import("node:fs/promises");
const text = await readFile(file, "utf8");
let events;
if (text.trim().startsWith("[")) {
  events = JSON.parse(text);
} else {
  events = text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

let ok = 0;
let failed = 0;
for (const ev of events) {
  const headers = { "content-type": "application/json" };
  if (auth) headers.authorization = "Basic " + Buffer.from(auth).toString("base64");
  const res = await fetch(base + "/api/corrections", {
    method: "POST",
    headers,
    body: JSON.stringify({
      type: ev.type,
      value: ev.value,
      item_id: ev.item_id,
      edition_date: ev.edition_date,
    }),
  });
  if (res.ok) {
    ok++;
  } else {
    failed++;
    console.error(`  rejected: ${JSON.stringify(ev)} -> ${res.status} ${await res.text()}`);
  }
}
console.log(`imported ${ok}/${events.length} feedback events into ${base} (${failed} rejected)`);
process.exit(failed && !ok ? 1 : 0);
