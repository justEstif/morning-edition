/* Shared edition shaping — pure functions, no server imports.
   The Python builder is the source of truth; these helpers only shape its
   edition JSON for rendering. Locked rules (parent card t_05ddeae1):
   section order captured → rust-os → ai-at-work → might-like; empty sections
   omitted; first captured item is the lead feature; marks are typographic
   only: † deep read, ‡ brief, ❦ captured, ✳ suggested (might-like items);
   shadow_score is never rendered. */
import type { EditionItem, MarkInfo, RawEdition, ShapedEdition, ShapedSection } from './types.js';

export const SECTION_ORDER = ['captured', 'rust-os', 'ai-at-work', 'might-like'];

export const SECTION_TITLES: Record<string, string> = {
	'captured': 'Captured',
	'rust-os': 'Rust & Operating Systems',
	'ai-at-work': 'AI at Work',
	'might-like': 'Might Like — Outside Your Usual Topics'
};

const MARKS: Record<string, string> = { 'deep-read': '†', 'brief': '‡', 'captured': '❦' };
const LABELS: Record<string, string> = { 'deep-read': 'Deep read', 'brief': 'Brief', 'captured': 'Captured' };

/** Typographic mark + label for an item (✳︎ wins for might-like suggestions;
 *  VS15 forces text presentation so ✳ never renders as a green emoji). */
export function markFor(item: EditionItem): MarkInfo {
	if (item.section === 'might-like') return { mark: '✳\uFE0E', label: LABELS[item.kind] || 'Suggested' };
	return { mark: MARKS[item.kind] || '‡', label: LABELS[item.kind] || 'Brief' };
}

/** "2026-10-25" → "Sunday, October 25, 2026" (UTC-stable). */
export function longDate(dateStr: string): string {
	const d = new Date(dateStr + 'T12:00:00Z');
	return d.toLocaleDateString('en-US', {
		weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC'
	});
}

/**
 * Shape raw edition JSON for rendering.
 * Returns { date, dateLong, lead, leadSide, glance, sections, itemCount }.
 * lead = first captured item; leadSide = second capture ("also captured"
 * well); sections = non-empty sections in locked order, the Captured section
 * holding captures beyond the first two.
 */
export function shapeEdition(raw: RawEdition | null): ShapedEdition {
	const items: EditionItem[] = Array.isArray(raw?.items) ? raw.items : [];
	const bySection: Record<string, EditionItem[]> = Object.fromEntries(
		SECTION_ORDER.map((k): [string, EditionItem[]] => [k, []])
	);
	for (const item of items) {
		if (bySection[item.section]) bySection[item.section].push(item);
	}
	const captures = bySection['captured'];
	const lead = captures[0] || null;
	const leadSide = captures[1] || null; // "Also captured" well
	const rest: Record<string, EditionItem[]> = Object.fromEntries(
		Object.entries(bySection).map(([k, v]): [string, EditionItem[]] => [k, v])
	);
	rest['captured'] = captures.slice(2); // beyond lead + side well
	const sections: ShapedSection[] = SECTION_ORDER.map((key) => ({
		key,
		title: SECTION_TITLES[key],
		items: rest[key]
	})).filter((s) => s.items.length > 0);
	const briefs = items.filter((i) => i.kind === 'brief').length;
	const deepReads = items.filter((i) => i.kind === 'deep-read').length;
	const captureCount = items.filter((i) => i.kind === 'captured').length;
	const suggestions = bySection['might-like'].length;
	return {
		date: raw?.edition_date || '',
		dateLong: longDate(raw?.edition_date || '1970-01-01'),
		lead,
		leadSide,
		glance:
			`${sections.length} sections, ${deepReads} deep reads, ${briefs} briefs, ` +
			`${captureCount} captures pinned` +
			(suggestions ? `, ${suggestions} suggestion${suggestions === 1 ? '' : 's'} from outside your usual topics awaiting your verdict.` : '.'),
		sections,
		itemCount: items.length
	};
}

/** Column width class for an item inside its section (001e: w4/w6). */
export function widthClass(section: ShapedSection, _index: number): string {
	if (section.items.length === 1 || section.items.length === 2) return 'w6';
	return 'w4';
}
