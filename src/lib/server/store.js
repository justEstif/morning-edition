/* Server-side data store.
   Layout (env-driven so the same image serves demo locally and real data on
   the private dokku app via a volume mount):

     ME_DATA_DIR/                      (default: <repo>/data/demo — demo only)
       edition.json                    latest edition (written by the rsync step)
       editions/<YYYY-MM-DD>/edition.json
       corrections.jsonl               append-only feedback ledger

   The Python builder is the source of truth; nothing here ever writes edition
   JSON. Corrections append one JSON object per line, canonical schema (locked
   in parent card t_05ddeae1, card 2):
     {"ts":"ISO-8601","type":"vote|grade","value":"up|down|deep-read|skim|capture",
      "item_id":"...","edition_date":"YYYY-MM-DD"}
   Later ts wins at analysis time; never dedupe. Restart-safe: the file lives
   on the host volume, not in the container. */
import { promises as fs } from 'node:fs';
import path from 'node:path';

export const DATA_DIR = process.env.ME_DATA_DIR
	? path.resolve(process.env.ME_DATA_DIR)
	: path.resolve('data/demo');
export const IS_DEMO = !process.env.ME_DATA_DIR;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function editionPath(date) {
	if (date) {
		if (!DATE_RE.test(date)) return null;
		return path.join(DATA_DIR, 'editions', date, 'edition.json');
	}
	return path.join(DATA_DIR, 'edition.json');
}

/** Load raw edition JSON (latest, or ?date=). Returns null if absent.
 *  Latest resolution order: DATA_DIR/edition.json, then the max-dated file
 *  under DATA_DIR/editions/. */
export async function loadEdition(date) {
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

const VOTE_VALUES = ['up', 'down'];
const GRADE_VALUES = ['deep-read', 'skim', 'capture'];

/** Validate one feedback event; returns the canonical object or throws. */
export function validateCorrection(body) {
	const type = body?.type;
	const value = body?.value;
	if (type !== 'vote' && type !== 'grade') throw new Error('type must be vote|grade');
	if (type === 'vote' && !VOTE_VALUES.includes(value)) throw new Error('vote value must be up|down');
	if (type === 'grade' && !GRADE_VALUES.includes(value)) throw new Error('grade value must be deep-read|skim|capture');
	const itemId = body?.item_id;
	if (typeof itemId !== 'string' || itemId.length === 0 || itemId.length > 200) throw new Error('item_id required');
	const editionDate = body?.edition_date;
	if (typeof editionDate !== 'string' || !DATE_RE.test(editionDate)) throw new Error('edition_date must be YYYY-MM-DD');
	// Key order matches the canonical schema exactly. ts is server-stamped.
	return {
		ts: new Date().toISOString(),
		type,
		value,
		item_id: itemId,
		edition_date: editionDate
	};
}

export function correctionsPath() {
	return path.join(DATA_DIR, 'corrections.jsonl');
}

/** Append one validated event to the JSONL ledger. */
export async function appendCorrection(ev) {
	await fs.mkdir(DATA_DIR, { recursive: true });
	await fs.appendFile(correctionsPath(), JSON.stringify(ev) + '\n', 'utf8');
}

/** Read the ledger; optionally filter by edition_date.
 *  Returns { count, last: { "<item_id>": { vote?, grade? } } } — latest value
 *  per item+type wins (later ts wins; file order is append order). */
export async function readCorrections(date) {
	let raw = '';
	try {
		raw = await fs.readFile(correctionsPath(), 'utf8');
	} catch {
		return { count: 0, last: {} };
	}
	const last = {};
	let count = 0;
	for (const line of raw.split('\n')) {
		if (!line.trim()) continue;
		let ev;
		try {
			ev = JSON.parse(line);
		} catch {
			continue; // a torn/corrupt line never breaks the ledger
		}
		if (date && ev.edition_date !== date) continue;
		count++;
		if (!last[ev.item_id]) last[ev.item_id] = {};
		last[ev.item_id][ev.type] = ev.value;
	}
	return { count, last };
}
