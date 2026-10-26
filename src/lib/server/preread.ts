/* Server pre-read adapter — the depth ladder's "outside" (card t_2f96c207).
   Implements the PrereadSource port (src/lib/domain/ports.ts) against
   prereads.json on the DATA_DIR volume, plus the LAZY tier: briefs-tier
   items generate on first request and cache into the same file the
   pipeline's batch step wrote (lead + secondary at build time).

   Cost budget (card): the batch-vs-lazy split is the decision — build-time
   generation for lead/secondary (measured, recorded pipeline-side in
   prereads-cost.json), first-request generation for the long tail of
   briefs, cached thereafter. The lazy path is disabled whenever no
   GLM_API_KEY is configured (demo serving, keyless deploys): those pages
   simply render without the tier — build-time entries still serve.

   Grounding contract: generation material is TITLE + the stored extracted
   text ONLY. Nothing here ever fetches the article's URL — the same rule
   the briefs and digest steps obey (compression of what the press already
   extracted, never new reporting). */
import { promises as fs } from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./store.js";
import {
  PRE_READ_MAX_CHARS,
  PREREAD_SYSTEM,
  parsePreReads,
  validPreReadText,
  type PreReadEntry,
  type PreReads,
} from "$lib/domain/preread.js";
import type { PrereadSource } from "$lib/domain/ports.js";

const MODEL = process.env.ME_LLM_MODEL ?? "glm-5.3-flash";
const BASE_URL = process.env.ME_LLM_BASE_URL ?? "https://api.z.ai/api/coding/paas/v4";
/** The stored reader text can be 60k chars; the prompt material is capped
 *  well below that — a five-minute version doesn't need a full feature's
 *  back half, and this bounds the lazy call's latency and cost. */
const MATERIAL_MAX_CHARS = 24_000;
const TIMEOUT_MS = 90_000;

function prereadPath() {
  return path.join(DATA_DIR, "prereads.json");
}

async function readPrereads(): Promise<PreReads | null> {
  try {
    // parsed, never trusted — a corrupt file counts as absent
    return parsePreReads(JSON.parse(await fs.readFile(prereadPath(), "utf8")));
  } catch {
    return null;
  }
}

/** Atomic-ish read-modify-write (temp + rename) so a torn file can never
 *  replace a good one; concurrent generations collapse through the
 *  in-process inflight map below, and a last-writer-wins race across
 *  processes re-derives the same grounded text — acceptable at personal
 *  scale. */

export const prereads: PrereadSource & {
  /** The lazy tier: generate + cache one item's pre-read. Returns the entry
   *  text when one exists or was just generated; null when the item stays
   *  tier-less (no key, generation failure, out-of-bounds output). */
  ensureFor(item: { id: string; title: string }, articleText: string): Promise<string | null>;
} = {
  load: readPrereads,

  async ensureFor(item, articleText): Promise<string | null> {
    const key = `${item.id}`;
    const inflight = inflightFor(key, async () => {
      const existing = await readPrereads();
      const hit = existing?.prereads[key];
      if (hit) return hit.text;
      const text = await generate(item.title, articleText);
      if (!text) return null;
      const entry: PreReadEntry = {
        text,
        model: MODEL,
        generated_at: new Date().toISOString(),
      };
      await appendEntry(existing?.edition_date, key, entry);
      return text;
    });
    return inflight;
  },
};

/** One generation at a time per item, per process. */
const INFLIGHT = new Map<string, Promise<string | null>>();
function inflightFor(key: string, task: () => Promise<string | null>): Promise<string | null> {
  const running = INFLIGHT.get(key);
  if (running) return running;
  const p = task().finally(() => INFLIGHT.delete(key));
  INFLIGHT.set(key, p);
  return p;
}

/** Read-modify-write one entry into prereads.json (temp + rename). */
async function appendEntry(
  editionDate: string | undefined,
  itemId: string,
  entry: PreReadEntry,
): Promise<void> {
  const current = await readPrereads();
  const prereads = current && current.edition_date === editionDate ? { ...current.prereads } : {};
  prereads[itemId] = entry;
  const out = JSON.stringify({ edition_date: editionDate, prereads }, null, 1);
  const tmp = `${prereadPath()}.tmp`;
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(tmp, out, "utf8");
  await fs.rename(tmp, prereadPath());
}

/** The lazy LLM call — grounded in title + stored text only. One attempt,
 *  then a budgeted retry if the model overshot; out-of-bounds output is
 *  discarded (the item renders without the tier — honest escalation, the
 *  digest step's rule). */
async function generate(title: string, articleText: string): Promise<string | null> {
  const key = process.env.GLM_API_KEY;
  if (!key || !articleText.trim()) return null;
  const material = [
    `TITLE: ${title}`,
    `EXTRACTED ARTICLE TEXT:\n${articleText.slice(0, MATERIAL_MAX_CHARS)}`,
  ].join("\n\n");
  try {
    let text = await callLLM(key, material);
    if (!validPreReadText(text)) {
      text = await callLLM(
        key,
        `${material}\n\nHARD LIMIT: at most ${PRE_READ_MAX_CHARS} characters. Compress — never pad.`,
      );
    }
    return validPreReadText(text) ? text.trim() : null;
  } catch {
    return null; // the tier is optional by contract; failure degrades silently
  }
}

async function callLLM(key: string, material: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: PREREAD_SYSTEM },
        { role: "user", content: material },
      ],
      max_tokens: 1600,
      temperature: 0.2,
      thinking: { type: "disabled" },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = data.choices?.[0]?.message?.content?.trim() ?? "";
  if (!text) throw new Error("LLM returned empty content");
  return text;
}

/** The shared voice lives in the domain (preread.ts PREREAD_SYSTEM) so the
 *  batch and lazy writers can't drift. */
