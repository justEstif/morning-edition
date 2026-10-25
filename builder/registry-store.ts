#!/usr/bin/env -S ../node_modules/.bin/tsx
/* Builder-side store adapter for the persistent story registry
   (src/lib/domain/registry.ts — card t_48954836).

   The registry lives NEXT TO the editions archive:

     <data dir>/story-registry.json        (default: ~/.hermes/morning-edition/)
     contabo:/var/lib/morning-edition/story-registry.json   (rsynced by
                                                            deploy_edition.sh)

   One JSON array, one entry per canonical story — compact forever by
   design (stories are unique; editions are not). The builder is the only
   writer; writes are atomic (tmp + rename). A corrupt or absent file loads
   as [] — the caller backfills from the editions archive (pure domain
   backfillFromEditions), so the cross-day memory is always reconstructible
   from the paper itself.

   Engagement rollup input: the ledger on contabo (corrections.jsonl), read
   GET-only over ssh exactly like sync_signals.ts. Failure is tolerated —
   the rollup is skipped and the existing summaries kept (never guessed). */
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
  backfillFromEditions,
  compactRegistry,
  parseRegistry,
  type EngagementEvent,
  type StoryRegistry,
  type StoryRegistryStore,
} from "../src/lib/domain/registry.js";

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url))); // …/morning-edition/repo
/** Default data dir: the builder scripts' home (sibling of editions/). */
export const DATA_DIR = process.env.ME_DATA_DIR
  ? resolve(process.env.ME_DATA_DIR)
  : dirname(REPO_ROOT); // …/morning-edition

function registryPath(): string {
  return process.env.ME_REGISTRY_PATH
    ? resolve(process.env.ME_REGISTRY_PATH)
    : join(DATA_DIR, "story-registry.json");
}

/** StoryRegistryStore port → story-registry.json. */
export const registryStore: StoryRegistryStore = {
  async load(): Promise<StoryRegistry> {
    try {
      const parsed = parseRegistry(JSON.parse(readFileSync(registryPath(), "utf-8")));
      return parsed ?? [];
    } catch {
      return []; // absent or corrupt → caller backfills from editions/
    }
  },

  async save(registry: StoryRegistry): Promise<void> {
    const p = registryPath();
    mkdirSync(dirname(p), { recursive: true });
    const tmp = p + ".tmp";
    writeFileSync(tmp, JSON.stringify(registry, null, 1) + "\n", "utf-8");
    renameSync(tmp, p);
  },
};

/** Load the registry, backfilling from the editions archive when the file
 *  is absent/empty/corrupt (days ascending, same as seenBefore's order).
 *  The archive is the BUILDER'S OWN output — read with the same trust
 *  seenBefore had (light field checks, no parseEdition: old editions must
 *  keep backfilling even after the serving schema grows new required
 *  fields). Returns [registry, backfilled].
 *
 *  Backfill is a COARSE SEED (card t_00a5273f): the day-by-day replay
 *  folds naively, so captures that re-appear under a different URL and a
 *  dissimilar presentation title (archived continuation titles included)
 *  re-seed as separate entries. The compactRegistry pass after the replay
 *  is the documented compaction step that merges entries sharing canonical
 *  identity (URL or suffix-stripped title similarity), restoring
 *  one-entry-per-canonical-story before the registry goes back to work.
 *  The live fold path never compacts. */
export async function loadOrBackfill(editionsDir: string): Promise<[StoryRegistry, boolean]> {
  const loaded = await registryStore.load();
  if (loaded.length > 0) return [loaded, false];
  if (!existsSync(editionsDir)) return [[], false];
  const days = readdirSync(editionsDir)
    .filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n))
    .sort();
  const backfill = [];
  for (const day of days) {
    try {
      const raw = JSON.parse(readFileSync(join(editionsDir, day, "edition.json"), "utf-8")) as {
        edition_date?: unknown;
        items?: unknown;
      };
      if (typeof raw.edition_date !== "string" || !Array.isArray(raw.items)) continue;
      const items = raw.items.filter(
        (i): i is { url?: string; title?: string; source?: string } =>
          typeof i === "object" && i !== null,
      );
      if (items.length > 0) backfill.push({ edition_date: raw.edition_date, items });
    } catch {
      continue; // a corrupt archived edition never breaks the backfill
    }
  }
  return [compactRegistry(backfillFromEditions(backfill)), backfill.length > 0];
}

/** The ledger on contabo, as minimal engagement events. GET-only (ssh cat).
 *  Returns null when the ledger can't be read — callers SKIP the rollup. */
export function readLedgerEvents(): EngagementEvent[] | null {
  const LEDGER = "/var/lib/morning-edition/corrections.jsonl";
  let stdout: string;
  try {
    stdout = execFileSync("ssh", ["contabo", "cat", LEDGER], { encoding: "utf-8" });
  } catch {
    return null;
  }
  const events: EngagementEvent[] = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const row = JSON.parse(trimmed) as Record<string, unknown>;
      events.push({
        type: typeof row.type === "string" ? row.type : undefined,
        item_url: typeof row.item_url === "string" ? row.item_url : undefined,
        url: typeof row.url === "string" ? row.url : undefined,
        dwell_ms: typeof row.dwell_ms === "number" ? row.dwell_ms : undefined,
        verdict: typeof row.verdict === "string" ? row.verdict : undefined,
      });
    } catch {
      continue; // torn line — the ledger read never breaks the build
    }
  }
  return events;
}
