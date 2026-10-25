import { error } from '@sveltejs/kit';
import { loadEdition, IS_DEMO } from '$lib/server/store.js';
import { shapeEdition, SECTION_TITLES, markFor } from '$lib/edition.js';

/** QuickStudy panel — the same edition data, condensed into topic boxes. */
export async function load({ url }) {
	const date = url.searchParams.get('date') || undefined;
	const raw = await loadEdition(date);
	if (!raw) {
		throw error(404, 'No edition found — run the builder first');
	}
	const ed = shapeEdition(raw);
	const topics = ed.sections.map((s) => ({
		title: SECTION_TITLES[s.key],
		// the panel shows headlines + marks only, source under each
		items: s.items.map((item) => ({
			id: item.id,
			title: item.title,
			url: item.url,
			mark: markFor(item).mark,
			source: item.source,
			kind: markFor(item).label
		}))
	}));
	return { date: ed.date, dateLong: ed.dateLong, topics, itemCount: ed.itemCount, isDemo: IS_DEMO };
}
