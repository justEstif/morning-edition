import { error } from '@sveltejs/kit';
import { loadEdition, IS_DEMO } from '$lib/server/store.js';
import { shapeEdition, markFor } from '$lib/edition.js';

/** The Grading Desk — one tap per item; grade events POST to /api/corrections. */
export async function load({ url }) {
	const date = url.searchParams.get('date') || undefined;
	const raw = await loadEdition(date);
	if (!raw) {
		throw error(404, 'No edition found — run the builder first');
	}
	const ed = shapeEdition(raw);
	const rows = [];
	for (const s of ed.sections) {
		for (const item of s.items) {
			const m = markFor(item);
			rows.push({ id: item.id, title: item.title, mark: `${m.mark} ${m.label}` });
		}
	}
	return { date: ed.date, dateLong: ed.dateLong, rows, itemCount: ed.itemCount, isDemo: IS_DEMO };
}
