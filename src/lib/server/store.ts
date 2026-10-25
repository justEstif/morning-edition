/* Server file adapter — the hexagonal "outside" (implements the ports in
   src/lib/domain/ports.ts; all ledger/edition semantics live in the domain,
   not here).

   Layout (env-driven so the same image serves demo locally and real data on
   the private dokku app via a volume mount):

     ME_DATA_DIR/                      (default: <repo>/data/demo — demo only)
       edition.json                    latest edition (written by the rsync step)
       editions/<YYYY-MM-DD>/edition.json
       corrections.jsonl               append-only feedback ledger
       rejections.jsonl                write-time referential rejections
       corrections-quarantine.jsonl    quarantined rows (excluded from all reads)
       highlights.json                 synced Readeck highlights (sync_signals.py)
       pool.json                       persistent candidate pool (pipeline fetchers)

   The Python builder is the source of truth; nothing here ever writes edition
   JSON. Corrections append one JSON object per line — the file is append-only,
   on the host volume, never rewritten. The full schema documentation lives
   with the types: src/lib/domain/feedback.ts. */
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { DATE_RE, editionItemIds, parseEdition, type RawEdition } from "$lib/domain/edition.js";
import type { PoolCandidate } from "$lib/domain/pool.js";
import {
  attachFlipMs,
  rejectionRecordFor,
  referentiallyValid,
  type HighlightRow,
  type LedgerEvent,
  type StampDeps,
  type VerdictEvent,
} from "$lib/domain/feedback.js";
import type {
  CorrectionSink,
  EditionStore,
  HighlightsSource,
  PoolStore,
  RejectionRecord,
} from "$lib/domain/ports.js";

export const DATA_DIR = process.env.ME_DATA_DIR
  ? path.resolve(process.env.ME_DATA_DIR)
  : path.resolve("data/demo");
export const IS_DEMO = !process.env.ME_DATA_DIR;

/** The domain requires an injected clock + id factory (it never touches
 *  node builtins itself); this adapter supplies the real ones. */
export const wireDeps: StampDeps = {
  now: () => new Date().toISOString(),
  newId: () => "e-" + randomBytes(8).toString("base64url"),
};

function editionPath(date?: string): string | null {
  if (date) {
    if (!DATE_RE.test(date)) return null;
    return path.join(DATA_DIR, "editions", date, "edition.json");
  }
  return path.join(DATA_DIR, "edition.json");
}

async function readEditionFile(p: string): Promise<RawEdition | null> {
  try {
    // parsed, never trusted — a corrupt file counts as absent
    return parseEdition(JSON.parse(await fs.readFile(p, "utf8")));
  } catch {
    return null;
  }
}

/** EditionStore port → files on the DATA_DIR volume. */
export const editions: EditionStore = {
  isDemo: IS_DEMO,
  async loadByDate(date: string): Promise<RawEdition | null> {
    const p = editionPath(date);
    return p ? readEditionFile(p) : null;
  },
  async loadLatest(): Promise<RawEdition | null> {
    const direct = await readEditionFile(editionPath()!);
    if (direct) return direct;
    // fall through: pick the newest dated edition on disk
    try {
      const days = (await fs.readdir(path.join(DATA_DIR, "editions"), { withFileTypes: true }))
        .filter((e) => e.isDirectory() && DATE_RE.test(e.name))
        .map((e) => e.name)
        .sort();
      for (const day of days.reverse()) {
        const ed = await readEditionFile(path.join(DATA_DIR, "editions", day, "edition.json"));
        if (ed) return ed;
      }
    } catch {
      // no editions dir at all
    }
    return null;
  },
};

/** HighlightsSource port → highlights.json on the volume. Returns [] when
 *  absent — the panel simply omits the 'From your marks' study boxes. */
export const highlights: HighlightsSource = {
  async load(): Promise<HighlightRow[]> {
    try {
      const rows = JSON.parse(await fs.readFile(path.join(DATA_DIR, "highlights.json"), "utf8"));
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  },
};

/** PoolStore port → pool.json on the volume (written by the pipeline's
 *  fetchers, rsynced by deploy). Read-only: the app recomputes aging with
 *  the domain's effectiveState; only the pipeline ever writes this file.
 *  Absent/corrupt file → [] — an empty pool just means nothing to explore. */
export const pool: PoolStore = {
  async load(): Promise<PoolCandidate[]> {
    try {
      const rows = JSON.parse(await fs.readFile(path.join(DATA_DIR, "pool.json"), "utf8"));
      return Array.isArray(rows) ? (rows as PoolCandidate[]) : [];
    } catch {
      return [];
    }
  },
};

function correctionsPath() {
  return path.join(DATA_DIR, "corrections.jsonl");
}

function rejectionsPath() {
  return path.join(DATA_DIR, "rejections.jsonl");
}

async function readRawLines(): Promise<string[]> {
  try {
    return (await fs.readFile(correctionsPath(), "utf8")).split("\n");
  } catch {
    return [];
  }
}

/** CorrectionSink port → corrections.jsonl / rejections.jsonl. */
export const corrections: CorrectionSink = {
  /** Append one validated event, with write-time burst detection: a verdict
   *  <2s after the previous verdict for the same session+item+edition gets
   *  flip_ms so analysis can down-weight the burst instead of blindly
   *  applying last-write-wins (semantics: domain attachFlipMs). */
  async append(ev: LedgerEvent): Promise<void> {
    if (ev.schema_v === 2 && ev.type === "verdict") {
      const prev = await lastVerdictInSession(ev.session_id, ev.item_id, ev.edition_date);
      attachFlipMs(ev, prev);
    }
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.appendFile(correctionsPath(), JSON.stringify(ev) + "\n", "utf8");
  },

  async readRaw(date?: string): Promise<LedgerEvent[]> {
    const rows: LedgerEvent[] = [];
    for (const line of await readRawLines()) {
      if (!line.trim()) continue;
      try {
        rows.push(JSON.parse(line));
      } catch {
        continue; // a torn/corrupt line never breaks the ledger
      }
    }
    return date ? rows.filter((ev) => ev.edition_date === date) : rows;
  },

  async recordRejection(rec: RejectionRecord): Promise<void> {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.appendFile(rejectionsPath(), JSON.stringify(rec) + "\n", "utf8");
  },

  lastVerdictInSession,
};

/** Most recent verdict event for a session+item+edition (file order = append
 *  order). */
async function lastVerdictInSession(
  sessionId: string,
  itemId: string,
  editionDate: string,
): Promise<VerdictEvent | null> {
  let last: VerdictEvent | null = null;
  for (const ev of await corrections.readRaw()) {
    if (
      ev.schema_v === 2 &&
      ev.type === "verdict" &&
      ev.session_id === sessionId &&
      ev.item_id === itemId &&
      ev.edition_date === editionDate
    ) {
      last = ev;
    }
  }
  return last;
}

/** Referential check composed the way the corrections route uses it: load the
 *  edition for the event's date (null → fail-open, per domain semantics),
 *  validate against its item ids, and log a rejection record when invalid.
 *  Returns true when the event may append. */
export async function referentiallyValidAgainstDisk(ev: LedgerEvent): Promise<boolean> {
  const ed = await editions.loadByDate(ev.edition_date);
  const ok = referentiallyValid(ev, ed ? editionItemIds(ed) : null);
  if (!ok) await corrections.recordRejection(rejectionRecordFor(ev, wireDeps));
  return ok;
}
