#!/usr/bin/env -S ../node_modules/.bin/tsx
/* Builder-side store adapter for the ranker (src/lib/domain/ranker.ts —
   card t_072d6c12).

   Reads (all read-only; the ledger stays append-only and nothing here
   writes to any upstream store):
     - corrections.jsonl on contabo, GET-only over ssh (same seam as
       registry-store.ts readLedgerEvents), or ME_LEDGER_PATH local file
       override (tests / offline runs);
     - the editions archive (id → source/section/url item facts — the
       builder's own output, read with the registry backfill's trust);
     - pool.json (miniflux feed names = the author bucket);
     - story-registry.json (zero-engagement negative flags).

   Writes ONE artifact, atomically (tmp + rename):
     <data dir>/ranker-weights.json
       (default ~/.hermes/morning-edition/, mirrored to contabo by
       deploy_edition.sh alongside pool/registry).

   Failure is tolerated, loudly: an unreadable ledger degrades to NEUTRAL
   weights (all 1.0, ledger_read=false, gate rate null) — never guessed
   engagement numbers, and the paper never fails to build over the ranker. */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseRankerWeights,
  type ItemFacts,
  type NegativeStory,
  type RankerEvent,
  type RankerInputs,
  type RankerWeights,
} from "../src/lib/domain/ranker.js";
import { parseRegistry, type StoryRegistry } from "../src/lib/domain/registry.js";

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url))); // …/morning-edition/repo
export const DATA_DIR = process.env.ME_DATA_DIR
  ? resolve(process.env.ME_DATA_DIR)
  : dirname(REPO_ROOT); // …/morning-edition

const LEDGER_REMOTE = "/var/lib/morning-edition/corrections.jsonl";

function weightsPath(): string {
  return process.env.ME_RANKER_PATH
    ? resolve(process.env.ME_RANKER_PATH)
    : join(DATA_DIR, "ranker-weights.json");
}

/** The ledger as RankerEvents. Returns null when unreadable — callers
 *  degrade to neutral, never guess. */
export function readLedger(): RankerEvent[] | null {
  let stdout: string;
  if (process.env.ME_LEDGER_PATH) {
    try {
      stdout = readFileSync(resolve(process.env.ME_LEDGER_PATH), "utf-8");
    } catch {
      return null;
    }
  } else {
    try {
      stdout = execFileSync("ssh", ["contabo", "cat", LEDGER_REMOTE], {
        encoding: "utf-8",
        timeout: 30_000,
      });
    } catch {
      return null;
    }
  }
  const events: RankerEvent[] = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const row = JSON.parse(trimmed) as Record<string, unknown>;
      events.push({
        ts: typeof row.ts === "string" ? row.ts : "",
        type: typeof row.type === "string" ? row.type : "",
        item_id: typeof row.item_id === "string" ? row.item_id : undefined,
        item_url: typeof row.item_url === "string" ? row.item_url : undefined,
        source: typeof row.source === "string" ? row.source : undefined,
        value: typeof row.value === "string" ? row.value : undefined,
        dwell_ms: typeof row.dwell_ms === "number" ? row.dwell_ms : undefined,
        flip_ms: typeof row.flip_ms === "number" ? row.flip_ms : undefined,
        progress_pct: typeof row.progress_pct === "number" ? row.progress_pct : undefined,
        confidence: typeof row.confidence === "number" ? row.confidence : undefined,
        starred: typeof row.starred === "boolean" ? row.starred : undefined,
        opened_at: typeof row.opened_at === "string" ? row.opened_at : undefined,
        seen_ms: typeof row.seen_ms === "number" ? row.seen_ms : undefined,
      });
    } catch {
      continue; // torn line — the ledger read never breaks the build
    }
  }
  return events;
}

/** Item facts from the editions archive (id → latest section/source/url),
 *  with author = miniflux feed name joined from pool.json. Days ascending,
 *  later editions win (an item's latest presentation is its current facts). */
export function buildItemIndex(editionsDir: string): Record<string, ItemFacts> {
  const items: Record<string, ItemFacts> = {};
  if (!existsSync(editionsDir)) return items;
  // Author join: pool.json rows carry the candidate payload; miniflux's
  // `feed` is the author key (the tech-Twitter account cluster rides this).
  const feeds: Record<string, string> = {};
  const poolPath = join(DATA_DIR, "pool.json");
  if (existsSync(poolPath)) {
    try {
      const pool = JSON.parse(readFileSync(poolPath, "utf-8")) as Array<{
        candidate_id?: string;
        candidate?: { feed?: string };
      }>;
      for (const row of pool) {
        if (row.candidate_id && typeof row.candidate?.feed === "string") {
          feeds[row.candidate_id] = row.candidate.feed;
        }
      }
    } catch {
      // corrupt pool → authors stay empty; weights still compute
    }
  }
  const days = readdirSync(editionsDir)
    .filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n))
    .sort();
  for (const day of days) {
    try {
      const raw = JSON.parse(readFileSync(join(editionsDir, day, "edition.json"), "utf-8")) as {
        items?: Array<{ id?: string; source?: string; section?: string; url?: string }>;
      };
      for (const it of raw.items ?? []) {
        if (!it.id || !it.source || !it.section) continue;
        items[it.id] = {
          source: it.source,
          topic: it.section,
          author: feeds[it.id],
          url: it.url,
        };
      }
    } catch {
      continue; // a corrupt archived edition never breaks the index
    }
  }
  return items;
}

/** Registry zero-engagement negatives, reduced to the ranker's shape. */
export function negativeStories(registry: StoryRegistry): NegativeStory[] {
  return registry
    .filter((e) => e.negative_signal)
    .map((e) => ({
      canonical_url: e.canonical_url,
      sources: [...new Set(e.angles.map((a) => a.source))],
      last_seen: e.last_seen,
    }));
}

/** The registry file (raw parse — the builder owns this store too). */
export function loadRegistry(): StoryRegistry {
  const p = join(DATA_DIR, "story-registry.json");
  try {
    return parseRegistry(JSON.parse(readFileSync(p, "utf-8"))) ?? [];
  } catch {
    return [];
  }
}

/** Assemble the domain inputs for an as-of date. Never throws over data
 *  problems: an unreadable ledger comes back as ledgerRead=false. */
export function buildRankerInputs(asOf: string, editionsDir: string): RankerInputs {
  const ledger = readLedger();
  const registry = loadRegistry();
  return {
    asOf,
    events: ledger ?? [],
    items: buildItemIndex(editionsDir),
    negativeStories: negativeStories(registry),
    registryStories: registry.length,
    ledgerRead: ledger !== null,
  };
}

/** Atomic write of the weights artifact (tmp + rename, registry-store pattern). */
export function saveWeights(weights: RankerWeights): string {
  const p = weightsPath();
  mkdirSync(dirname(p), { recursive: true });
  const tmp = p + ".tmp";
  writeFileSync(tmp, JSON.stringify(weights, null, 1) + "\n", "utf-8");
  renameSync(tmp, p);
  return p;
}

/** Parse an existing artifact (parsed, never trusted). Null when absent/corrupt. */
export function loadWeights(): RankerWeights | null {
  try {
    return parseRankerWeights(JSON.parse(readFileSync(weightsPath(), "utf-8")));
  } catch {
    return null;
  }
}
