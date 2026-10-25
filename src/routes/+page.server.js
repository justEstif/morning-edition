import { error } from '@sveltejs/kit';
import { loadEdition, IS_DEMO } from '$lib/server/store.js';
import { shapeEdition } from '$lib/edition.js';

export const ssr = true;

export async function load({ url }) {
	const date = url.searchParams.get('date') || undefined;
	const raw = await loadEdition(date);
	if (!raw) {
		throw error(404, 'No edition found — run the builder first');
	}
	return { edition: shapeEdition(raw), isDemo: IS_DEMO };
}
