import { json } from '@sveltejs/kit';
import { appendCorrection, readCorrections, validateCorrection } from '$lib/server/store.js';

/** GET /api/corrections?date=YYYY-MM-DD — ledger count + latest value per item. */
export async function GET({ url, setHeaders }) {
	const date = url.searchParams.get('date') || undefined;
	setHeaders['cache-control'] = 'no-store';
	return json(await readCorrections(date));
}

/**
 * POST /api/corrections — append one feedback event to the server-side JSONL
 * ledger (restart-safe: the file lives on the host volume). Body:
 *   {type:"vote|grade", value:"up|down|deep-read|skim|capture",
 *    item_id:"...", edition_date:"YYYY-MM-DD"}
 * ts is stamped by the server.
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
		await appendCorrection(ev);
		return json({ ok: true, event: ev }, { status: 201 });
	} catch (err) {
		return json({ error: String(err?.message || err) }, { status: 400 });
	}
}
