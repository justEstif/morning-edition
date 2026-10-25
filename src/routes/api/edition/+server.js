import { json } from '@sveltejs/kit';
import { loadEdition, IS_DEMO } from '$lib/server/store.js';

/** GET /api/edition?date=YYYY-MM-DD — raw edition JSON from the builder. */
export async function GET({ url, setHeaders }) {
	const date = url.searchParams.get('date') || undefined;
	const raw = await loadEdition(date);
	if (!raw) {
		return json({ error: 'edition not found' }, { status: 404 });
	}
	setHeaders['cache-control'] = 'no-store';
	return json({ ...raw, demo: IS_DEMO });
}
