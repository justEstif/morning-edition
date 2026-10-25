/* Server adapter — back-office file operations on the DATA_DIR volume
   (implements the admin ports in src/lib/domain/admin-ports.ts). Kept as
   its own module beside store.ts so the admin surface is one import; same
   rules as the main adapter: parsed-never-trusted, and the only shrinkable
   ledger-adjacent file is the quarantine pen. */
import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  EditionRestore,
  QuarantineStore,
  ServedEditionReader,
} from "$lib/domain/admin-ports.js";
import { DATE_RE, parseEdition, type RawEdition } from "$lib/domain/edition.js";
import type { LedgerEvent, RejectionRecord } from "$lib/domain/feedback.js";
import { DATA_DIR } from "./store.js";

const Q_TOKEN_RE = /^q(\d+)$/;

function editionsDir(): string {
  return path.join(DATA_DIR, "editions");
}

/** All dated edition dirs on disk, ascending, DATE_RE-clean. */
export async function availableDates(): Promise<string[]> {
  try {
    return (await fs.readdir(editionsDir(), { withFileTypes: true }))
      .filter((e) => e.isDirectory() && DATE_RE.test(e.name))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

/** ServedEditionReader port — the served file only, strict (no fallback). */
export const servedEditions: ServedEditionReader = {
  async loadServed(): Promise<RawEdition | null> {
    try {
      return parseEdition(
        JSON.parse(await fs.readFile(path.join(DATA_DIR, "edition.json"), "utf8")),
      );
    } catch {
      return null;
    }
  },
};

/** EditionRestore port — verbatim, atomic copy (write temp alongside, then
 *  rename) so a reader never sees a half-written edition.json. The JSON is
 *  parsed before the copy: a corrupt source never clobbers the served file. */
export const adminRestore: EditionRestore = {
  availableDates,
  async restore(date: string): Promise<RawEdition | null> {
    if (!DATE_RE.test(date)) return null;
    const src = path.join(editionsDir(), date, "edition.json");
    let ed: RawEdition | null;
    try {
      ed = parseEdition(JSON.parse(await fs.readFile(src, "utf8")));
    } catch {
      return null;
    }
    if (!ed) return null;
    const dst = path.join(DATA_DIR, "edition.json");
    const tmp = dst + ".restore-tmp";
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.copyFile(src, tmp);
    await fs.rename(tmp, dst);
    return ed;
  },
};

function quarantinePath(): string {
  return path.join(DATA_DIR, "corrections-quarantine.jsonl");
}

async function readQuarantineLines(): Promise<string[]> {
  try {
    return (await fs.readFile(quarantinePath(), "utf8")).split("\n");
  } catch {
    return [];
  }
}

/** QuarantineStore port — read + positional discard (the pen is the one
 *  ledger-adjacent file that may shrink; the main ledger never does). */
export const quarantine: QuarantineStore = {
  async read(): Promise<LedgerEvent[]> {
    const rows: LedgerEvent[] = [];
    for (const line of await readQuarantineLines()) {
      if (!line.trim()) continue;
      try {
        rows.push(JSON.parse(line));
      } catch {
        continue; // a torn line never breaks the pen read
      }
    }
    return rows;
  },

  async discard(token: string): Promise<boolean> {
    const match = Q_TOKEN_RE.exec(token);
    if (!match) return false;
    const target = Number(match[1]);
    const lines = await readQuarantineLines();
    // Count data lines to resolve the positional token exactly as read() does
    let seen = -1;
    let removed = false;
    const kept: string[] = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      let valid = true;
      try {
        JSON.parse(line);
      } catch {
        valid = false; // torn line: never counted by read(), never removed by token
      }
      if (valid) seen++;
      if (valid && seen === target) {
        removed = true;
        continue;
      }
      kept.push(line);
    }
    if (!removed) return false;
    await fs.writeFile(quarantinePath(), kept.length > 0 ? kept.join("\n") + "\n" : "", "utf8");
    return true;
  },
};

/** Rejections side log, newest first (write-time referential rejections —
 *  never part of the ledger). */
export async function readRejections(limit = 25): Promise<RejectionRecord[]> {
  let lines: string[];
  try {
    lines = (await fs.readFile(path.join(DATA_DIR, "rejections.jsonl"), "utf8")).split("\n");
  } catch {
    return [];
  }
  const rows: RejectionRecord[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      continue;
    }
  }
  return rows.reverse().slice(0, limit);
}
