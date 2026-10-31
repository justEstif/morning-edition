<script lang="ts">
	import '../app.css';
	import NightToggle from '$lib/NightToggle.svelte';
	import type { EditionItem } from '$lib/domain/edition.js';
	import { impression } from '$lib/impressions.js';
	import { dwellOpen } from '$lib/dwell.js';
	import type { PageData } from './$types.js';

	let { data }: { data: PageData } = $props();
	const ed = $derived(data.edition);

	/* Grading-desk v2: the inline vote pass is gone — its editorial signal is a
	   verdict at the grading desk. What the edition page records is implicit:
	   click-throughs POST a v2 `click` event (keepalive so the POST survives
	   the navigation), each click-through also records an open→return dwell
	   (card t_ea679b5a, shadow-mode), and viewport exposures POST `impression`
	   batches (card t_41df1f78). Existing state stays server-side, any device. */
	const sessionId = crypto.randomUUID();

	/* Impression capture: every rendered item reports its global position in
	   the ranked list below. explore_flag / propensity ride along when the
	   builder attached them (research R3, shadow-mode) — the why-shown log;
	   nothing visual changes. NOTE: the telemetry field `tier` predates the
	   broadsheet tier and still carries the item KIND — a payload contract,
	   unchanged on purpose. */
	function impressionInfo(item: EditionItem, sectionKey: string, position: number) {
		return {
			item_id: item.id,
			item_url: item.url,
			source: item.source,
			edition_date: ed.date,
			section: sectionKey,
			tier: item.kind,
			position,
			...(item.explore_flag === true ? { explore_flag: true } : {}),
			...(item.propensity ? { propensity: item.propensity } : {})
		};
	}

	/* Folds print OPEN: beforeprint opens every fold (restored after). The
	   @media print ::details-content rule covers engines where the event
	   doesn't fire; together the paper never prints a closed fold. */
	let foldStates: boolean[] = [];
	function openFolds() {
		const folds = document.querySelectorAll<HTMLDetailsElement>('details.fold');
		foldStates = [...folds].map((d) => d.open);
		folds.forEach((d) => (d.open = true));
	}
	function restoreFolds() {
		document.querySelectorAll<HTMLDetailsElement>('details.fold').forEach((d, i) => (d.open = foldStates[i] ?? false));
		foldStates = [];
	}

	/* In-paper reader (card t_f06c164b): items whose article text was
	   extracted link INSIDE the paper (/read/<id>); the click event + dwell
	   open below still carry the item's external url, so the ledger's shapes
	   and ids are untouched. Extraction-failed items keep the external link. */
	function itemLink(item: EditionItem): string {
		return item.has_reader ? `/read/${item.id}` : item.url;
	}

	function trackClick(item: EditionItem) {
		// Dwell pairs with the click: record the open now; the return
		// (refocus / next load) settles it into one dwell event — shadow-mode,
		// card t_ea679b5a.
		dwellOpen({
			item_id: item.id,
			edition_date: ed.date,
			url: item.url,
			item_url: item.url,
			source: item.source
		});
		try {
			fetch('/api/corrections', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				keepalive: true,
				body: JSON.stringify({
					type: 'click',
					url: item.url,
					session_id: sessionId,
					item_id: item.id,
					item_url: item.url,
					source: item.source,
					edition_date: ed.date
				})
			}).catch(() => {});
		} catch {
			// click tracking must never break reading
		}
	}

	/* Ranked order (card t_2f627733): the broadsheet tier GRID is retired on
	   this surface — the paper reads like a blog. The list is the builder's
	   rank order made visible: page lead, its side well, then each section's
	   items in the section's priority (= tier) order. Position stays the
	   global list index, so the impression payload's shape is untouched. The
	   domain tier field is ranking data only here — never a visual class. */
	const ranked = $derived.by(() => {
		let pos = 0;
		const top: EditionItem[] = [];
		if (ed.lead) top.push(ed.lead);
		if (ed.leadSide) top.push(ed.leadSide);
		const topItems = top.map((item) => ({ item, pos: ++pos }));
		const sections = ed.sections.map((s) => ({
			...s,
			rankedItems: s.items.map((item) => ({ item, pos: ++pos }))
		}));
		return { topItems, sections };
	});
</script>

<svelte:head>
	<title>The Morning Edition — {ed.dateLong}</title>
	<meta name="description" content="Your personal morning edition, compiled at 7:00 AM." />
</svelte:head>

<svelte:window onbeforeprint={openFolds} onafterprint={restoreFolds} />

<div class="page sheet">
	<div class="masthead">
		<div class="over">Your Personal Morning Edition</div>
		<h1>The Morning Edition</h1>
		<div class="under">the stories worth your attention today, compiled at 7:00 AM</div>
	</div>
	<div class="rail">
		<span>{ed.dateLong}</span><span class="fl">❦</span>
		<a href="/grade">Grade this edition</a>
		<span class="fl">❦</span>
		<NightToggle />
		{#if data.isDemo}<span class="fl">❦</span><span>demo edition — mock data only</span>{/if}
	</div>

	<!-- Plain edition facts (t_243a2248 register), one centered line —
	     no well, no sidecar. -->
	<p class="glance">{ed.itemCount} stories across {ed.sections.length} sections.</p>

	<div class="stream">
		{#each ranked.topItems as entry (entry.item.id)}
			{@const item = entry.item}
			<article class="item" use:impression={impressionInfo(item, item.section, entry.pos)}>
				<h3><a href={itemLink(item)} onclick={() => trackClick(item)}>{item.title}</a></h3>
				{#if item.brief}
					<!-- The unified reading model (t_243a2248), now the ONLY
					     register on this page: every item unfolds in place —
					     the page lead included. No ladder, no labels, no
					     display hierarchy; the fold is the continuation. -->
					<details class="fold">
						<summary><span class="fold-word"></span></summary>
						<p class="fold-body">{item.brief}</p>
					</details>
				{/if}
			</article>
		{/each}
		{#each ranked.sections as section (section.key)}
			<section id="sec-{section.key}">
				<h2 class="col-h">{section.title} <small>{section.items.length} item{section.items.length === 1 ? '' : 's'}</small></h2>
				{#each section.rankedItems as entry (entry.item.id)}
					{@const item = entry.item}
					<article class="item" use:impression={impressionInfo(item, section.key, entry.pos)}>
						<h3><a href={itemLink(item)} onclick={() => trackClick(item)}>{item.title}</a></h3>
						{#if item.brief}
							<details class="fold">
								<summary><span class="fold-word"></span></summary>
								<p class="fold-body">{item.brief}</p>
							</details>
						{/if}
					</article>
				{/each}
			</section>
		{/each}
	</div>

	<div class="toolbar screen-only">
		<a class="grade-link" href="/grade">Grade this edition →</a>
		{#if data.isAdmin}<span class="fl">❦</span><a class="grade-link" href="/admin">Admin</a>{/if}
	</div>

	<footer>— {ed.itemCount} items · edition {ed.date} · compiled by the 7 AM pipeline · read by a human —</footer>
</div>
