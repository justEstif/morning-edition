/* Server-side data store.
   Layout (env-driven so the same image serves demo locally and real data on
   the private dokku app via a volume mount):

     ME_DATA_DIR/                      (default: <repo>/data/demo — demo only)
       edition.json                    latest edition (written by the rsync step)
       editions/<YYYY-MM-DD>/edition.json
       corrections.jsonl               append-only feedback ledger
       rejections.jsonl                write-time referential rejections
       corrections-quarantine.jsonl    quarantined rows (excluded from all reads)

   The Python builder is the source of truth; nothing here ever writes edition
   JSON. Corrections append one JSON object per line.

   Ledger schema v2 (grading-desk v2, card t_9f03de41) — every event carries a
   shared envelope; `schema_v` keeps v1 rows (below) readable forever:

     {"id":"e-<rand>","ts":"ISO-8601","schema_v":2,"session_id":"...",
      "item_id":"...","item_url":"...","source":"readeck|miniflux|hn",
      "edition_date":"YYYY-MM-DD",
      "type":"verdict|click|read_progress|star|capture|highlight",
      ...type payload}

     verdict:       value: deep-read|skim|drop; optional reason
                    (wrong-angle|already-read|wrong-source|dup|low-quality);
                    optional supersedes: <event id> (a re-tap replaces, never
                    contradicts); optional flip_ms when the server saw this
                    verdict land <2s after the previous one in the same session
                    (bursts are down-weighted at analysis time, never
                    last-write-wins)
     click:         url (edition click-through)
     read_progress: progress_pct, origin: readeck (synced by id)
     star:          starred, origin: miniflux (synced)
     capture:       origin: readeck (synced — a Readeck save IS the capture)
     highlight:     kind: 'highlight', annotation_id, text, created,
                    note?, origin: readeck (synced from Readeck annotations
                    by readeck item id; one event per annotation)

   The human-facing API accepts only verdict|click; read_progress, star,
   capture and highlight ride the trusted direct-append sync path
   (pipeline sync_signals.py, session_id "sync-<origin>").

   `skip` is derived downstream (presented >=2 editions, zero events) and is
   never stored. v1 rows stay byte-identical:
     {"ts":"ISO-8601","type":"vote|grade","value":"up|down|deep-read|skim|capture",
      "item_id":"...","edition_date":"YYYY-MM-DD"}

   Referential validation: a v2 event whose item_id is absent from its
   edition_date's edition is REJECTED (400) and logged to rejections.jsonl —
   test/typo rows never reach the ledger. Restart-safe: files live on the host
   volume, not in the container. */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type {
	CorrectionsSummary,
	CorrectionSlot,
	HighlightRow,
	LedgerEvent,
	LegacyGradeEvent,
	LegacyVoteEvent,
	RawEdition,
	Reason,
	Verdict,
	VerdictEvent
} from '../types.js';

/** Build-time shape of a v2 event under construction (union payload fields
 *  are optional until the type-specific branch fills them in). */
type Envelope = Omit<VerdictEvent, 'type' | 'value' | 'reason' | 'supersedes' | 'flip_ms'> & {
	type: 'verdict' | 'click';
	value?: Verdict;
	reason?: Reason;
	supersedes?: string;
	url?: string;
};

export const DATA_DIR = process.env.ME_DATA_DIR
	? path.resolve(process.env.ME_DATA_DIR)
	: path.resolve('data/demo');
export const IS_DEMO = !process.env.ME_DATA_DIR;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const VERDICT_VALUES = ['deep-read', 'skim', 'drop'];
export const REASONS = ['wrong-angle', 'already-read', 'wrong-source', 'dup', 'low-quality'];
const VOTE_VALUES = ['up', 'down'];
const GRADE_VALUES = ['deep-read', 'skim', 'capture'];

/** Verdicts landing within this window after the previous one in the same
 *  session+item are annotated flip_ms (burst → down-weight, not last-write-wins). */
export const FLIP_MS = 2000;

/** Readeck highlights synced by the pipeline (highlights.json on the volume,
 *  written by sync_signals.py). Returns [] when absent — the panel simply
 *  omits the 'From your marks' study boxes. */
export async function loadHighlights(): Promise<HighlightRow[]> {
	try {
		const rows = JSON.parse(await fs.readFile(path.join(DATA_DIR, 'highlights.json'), 'utf8'));
		return Array.isArray(rows) ? rows : [];
	} catch {
		return [];
	}
}

export function editionPath(date?: string): string | null {
	if (date) {
		if (!DATE_RE.test(date)) return null;
		return path.join(DATA_DIR, 'editions', date, 'edition.json');
	}
	return path.join(DATA_DIR, 'edition.json');
}

/** Load raw edition JSON (latest, or ?date=). Returns null if absent.
 *  Latest resolution order: DATA_DIR/edition.json, then the max-dated file
 *  under DATA_DIR/editions/. */
export async function loadEdition(date?: string): Promise<RawEdition | null> {
	if (date) {
		const p = editionPath(date);
		if (!p) return null;
		try {
			return JSON.parse(await fs.readFile(p, 'utf8'));
		} catch {
			return null;
		}
	}
	try {
		return JSON.parse(await fs.readFile(path.join(DATA_DIR, 'edition.json'), 'utf8'));
	} catch {
		// fall through: pick the newest dated edition on disk
	}
	try {
		const days = (await fs.readdir(path.join(DATA_DIR, 'editions'), { withFileTypes: true }))
			.filter((e) => e.isDirectory() && DATE_RE.test(e.name))
			.map((e) => e.name)
			.sort();
		for (const day of days.reverse()) {
			try {
				return JSON.parse(await fs.readFile(path.join(DATA_DIR, 'editions', day, 'edition.json'), 'utf8'));
			} catch {
				continue;
			}
		}
	} catch {
		// no editions dir at all
	}
	return null;
}

function shortId() {
	return 'e-' + randomBytes(8).toString('base64url');
}

function bounded(v: unknown, max: number): string | undefined {
	return typeof v === 'string' && v.length > 0 && v.length <= max ? v : undefined;
}

/** Validate one feedback event (v1 or v2); returns the canonical object or throws.
 *  `body` is unvalidated wire JSON — anything goes in, only a LedgerEvent comes out. */
export function validateCorrection(body: any): LedgerEvent {
	const type = body?.type;

	// v1 legacy rows: byte-identical canonical schema, still accepted so the
	// localStorage importer and any old client keep working.
	if (type === 'vote' || type === 'grade') {
		const value = body?.value;
		if (type === 'vote' && !VOTE_VALUES.includes(value)) throw new Error('vote value must be up|down');
		if (type === 'grade' && !GRADE_VALUES.includes(value)) throw new Error('grade value must be deep-read|skim|capture');
		const itemId = body?.item_id;
		if (typeof itemId !== 'string' || itemId.length === 0 || itemId.length > 200) throw new Error('item_id required');
		const editionDate = body?.edition_date;
		if (typeof editionDate !== 'string' || !DATE_RE.test(editionDate)) throw new Error('edition_date must be YYYY-MM-DD');
		// Key order matches the canonical v1 schema exactly. ts is server-stamped.
		return {
			ts: new Date().toISOString(),
			type,
			value,
			item_id: itemId,
			edition_date: editionDate
		} as LegacyGradeEvent | LegacyVoteEvent;
	}

	// v2 events: shared envelope + type payload.
	if (type !== 'verdict' && type !== 'click') {
		throw new Error('type must be verdict|click (or legacy vote|grade)');
	}
	const sessionId = bounded(body.session_id, 100);
	if (!sessionId) throw new Error('session_id required (v2 envelope)');
	const itemId = bounded(body.item_id, 200);
	if (!itemId) throw new Error('item_id required');
	const editionDate = body?.edition_date;
	if (typeof editionDate !== 'string' || !DATE_RE.test(editionDate)) throw new Error('edition_date must be YYYY-MM-DD');

	const ev: Envelope = {
		id: shortId(),
		ts: new Date().toISOString(),
		schema_v: 2,
		session_id: sessionId,
		item_id: itemId,
		item_url: bounded(body.item_url, 2000),
		source: bounded(body.source, 40),
		edition_date: editionDate,
		type
	};

	if (type === 'verdict') {
		if (!VERDICT_VALUES.includes(body.value)) {
			throw new Error('verdict value must be deep-read|skim|drop');
		}
		ev.value = body.value;
		if (body.reason !== undefined && body.reason !== null) {
			if (!REASONS.includes(body.reason)) {
				throw new Error('reason must be one of: ' + REASONS.join('|'));
			}
			ev.reason = body.reason;
		}
		if (body.supersedes !== undefined && body.supersedes !== null) {
			const sup = bounded(body.supersedes, 100);
			if (!sup) throw new Error('supersedes must be an event id');
			ev.supersedes = sup;
		}
	} else {
		// click
		const url = bounded(body.url, 2000);
		if (!url) throw new Error('click requires url');
		ev.url = url;
	}

	return ev as LedgerEvent;
}

export function correctionsPath() {
	return path.join(DATA_DIR, 'corrections.jsonl');
}

function rejectionsPath() {
	return path.join(DATA_DIR, 'rejections.jsonl');
}

/** Referential validation: v2 events must reference an item that was actually
 *  presented in their edition. Rejections are logged separately, never appended.
 *  NOTE: this FAILS OPEN when no edition file exists for the event's
 *  edition_date (nothing on disk to check against) — a ghost date with a ghost
 *  id is accepted until that edition is built; acceptable for a personal
 *  pipeline, where editions are rsynced before grading happens. */
export async function referentiallyValid(ev: LedgerEvent): Promise<boolean> {
	if (ev.schema_v !== 2) return true; // legacy rows predate edition-carried ids
	const ed = await loadEdition(ev.edition_date);
	if (!ed) return true; // no edition on disk yet — nothing to check against
	const ids = new Set((Array.isArray(ed.items) ? ed.items : []).map((i) => i.id));
	if (ids.has(ev.item_id)) return true;
	await fs.mkdir(DATA_DIR, { recursive: true });
	await fs.appendFile(
		rejectionsPath(),
		JSON.stringify({
			ts: new Date().toISOString(),
			reason: `item_id ${ev.item_id} absent from edition ${ev.edition_date}`,
			session_id: ev.session_id,
			type: ev.type,
			value: 'value' in ev ? ev.value : undefined,
			url: 'url' in ev ? ev.url : undefined
		}) + '\n',
		'utf8'
	);
	return false;
}

/** Append one validated event to the JSONL ledger, with write-time burst
 *  detection: a verdict <2s after the previous verdict for the same
 *  session+item+edition gets flip_ms so analysis can down-weight the burst
 *  instead of blindly applying last-write-wins. */
export async function appendCorrection(ev: LedgerEvent): Promise<void> {
	if (ev.schema_v === 2 && ev.type === 'verdict') {
		const prev = await lastVerdictInSession(ev.session_id, ev.item_id, ev.edition_date);
		if (prev) {
			const delta = Date.parse(ev.ts) - Date.parse(prev.ts);
			if (delta >= 0 && delta < FLIP_MS) ev.flip_ms = delta;
		}
	}
	await fs.mkdir(DATA_DIR, { recursive: true });
	await fs.appendFile(correctionsPath(), JSON.stringify(ev) + '\n', 'utf8');
}

async function readRawLines() {
	try {
		return (await fs.readFile(correctionsPath(), 'utf8')).split('\n');
	} catch {
		return [];
	}
}

/** Most recent verdict event for a session+item+edition (file order = append order). */
async function lastVerdictInSession(sessionId: string, itemId: string, editionDate: string): Promise<LedgerEvent | null> {
	let last: LedgerEvent | null = null;
	for (const line of await readRawLines()) {
		if (!line.trim()) continue;
		let ev: LedgerEvent;
		try {
			ev = JSON.parse(line);
		} catch {
			continue;
		}
		if (ev.schema_v === 2 && ev.type === 'verdict' && ev.session_id === sessionId &&
			ev.item_id === itemId && ev.edition_date === editionDate) {
			last = ev;
		}
	}
	return last;
}

/** Read the ledger; optionally filter by edition_date.
 *  Returns { count, last: { "<item_id>": { verdict?, reason?, vote?, grade?, ev? } } }
 *  — latest event per item wins (later ts wins; file order is append order).
 *  v2 verdict events map to verdict/reason/ev; legacy grade deep-read|skim map
 *  to verdict; legacy vote stays vote; legacy capture stays grade (no v2
 *  verdict — a Readeck save is the capture signal now). Quarantined rows live
 *  in their own file and are never read here. */
export async function readCorrections(date?: string): Promise<CorrectionsSummary> {
	const last: Record<string, CorrectionSlot> = {};
	let count = 0;
	for (const line of await readRawLines()) {
		if (!line.trim()) continue;
		let ev: LedgerEvent;
		try {
			ev = JSON.parse(line);
		} catch {
			continue; // a torn/corrupt line never breaks the ledger
		}
		if (date && ev.edition_date !== date) continue;
		count++;
		if (!last[ev.item_id]) last[ev.item_id] = {};
		const slot = last[ev.item_id];
		if (ev.schema_v === 2 && ev.type === 'verdict') {
			slot.verdict = ev.value;
			slot.reason = ev.reason; // a superseding verdict without a reason clears it
			if (ev.id) slot.ev = ev.id;
		} else if (ev.type === 'grade') {
			if (ev.value === 'capture') slot.grade = ev.value;
			else slot.verdict = ev.value;
		} else if (ev.type === 'vote') {
			slot.vote = ev.value;
		}
	}
	return { count, last };
}
