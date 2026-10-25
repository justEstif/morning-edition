import { json } from '@sveltejs/kit';
import { appendCorrection, readCorrections, referentiallyValid, validateCorrection } from '$lib/server/store.js';

/** GET /api/corrections?date=YYYY-MM-DD — ledger count + latest value per item
 *  (v2 verdict/reason/ev; legacy vote/grade rows stay readable). */
export async function GET({ url, setHeaders }) {
	const date = url.searchParams.get('date') || undefined;
	setHeaders['cache-control'] = 'no-store';
	return json(await readCorrections(date));
}

/**
 * POST /api/corrections — append one feedback event to the server-side JSONL
 * ledger (restart-safe: the file lives on the host volume). ts is stamped by
 * the server.
 *   v2 (grading-desk v2): the event carries the shared envelope
 *     {type:"verdict", value:"deep-read|skim|drop", session_id, item_id,
 *      item_url?, source?, edition_date, reason?, supersedes?}
 *     {type:"click", url, session_id, item_id, item_url?, source?, edition_date}
 *   v1 (legacy importer): {type:"vote|grade", value:"up|down|deep-read|skim|capture",
 *    item_id:"...", edition_date:"YYYY-MM-DD"}
 * A v2 event whose item_id is not in its edition_date's edition is rejected
 * (400) and logged to rejections.jsonl — it never reaches the ledger.
 */
export async function POST({ request }) {
	let body;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'body must be JSON' }, { status: 400 });
	}
	try {
		const ev = validateCorrection(body);
		if (!(await referentiallyValid(ev))) {
			return json({ error: `rejected: item_id ${ev.item_id} is not in edition ${ev.edition_date}` }, { status: 400 });
		}
		await appendCorrection(ev);
		return json({ ok: true, event: ev }, { status: 201 });
	} catch (err) {
		return json({ error: String(err?.message || err) }, { status: 400 });
	}
}
