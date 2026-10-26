<script lang="ts">
	import '../app.css';
	import NightToggle from '$lib/NightToggle.svelte';
	import { markFor } from '$lib/domain/edition.js';
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

	/* Impression capture: lead + lead-side well are captured #1/#2, so the
	   items rendered in the Captured section continue at #3. explore_flag /
	   propensity ride along when the builder attached them (research R3,
	   shadow-mode) — the why-shown log; nothing visual changes. NOTE: the
	   telemetry field `tier` predates the broadsheet tier and still carries
	   the item KIND — a payload contract, unchanged on purpose. */
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
</script>

<svelte:head>
	<title>The Morning Edition — {ed.dateLong}</title>
	<meta name="description" content="Your personal morning edition, compiled at 7:00 AM." />
</svelte:head>

<svelte:window onbeforeprint={openFolds} onafterprint={restoreFolds} />

<div class="page">
	<div class="masthead">
		<div class="over">Your Personal Morning Edition</div>
		<h1>The Morning Edition</h1>
		<div class="under">the stories worth your attention today, compiled at 7:00 AM</div>
	</div>
	<div class="rail">
		<span>{ed.dateLong}</span><span class="fl">❦</span>
		<span>† deep read ‡ brief ❦ captured ✳&#xFE0E; suggested</span><span class="fl">❦</span>
		<a href="/panel">QuickStudy panel</a><span class="fl">·</span>
		<a href="/grade">Grade this edition</a>
		<span class="fl">❦</span>
		<NightToggle />
		{#if data.isDemo}<span class="fl">❦</span><span>demo edition — mock data only</span>{/if}
	</div>

	{#if ed.sections.length > 0}
		<!-- The index strip: a real broadsheet needs an "In This Edition" agate
		     line under the nameplate (research R5) — at ~100 items it is what
		     makes the page navigable, and it doubles as the keyboard/SR outline. -->
		<nav class="index" aria-label="In this edition">
			<span class="idx-cap">In This Edition</span>
			{#each ed.sections as section (section.key)}
				<span class="idx-entry">
					<a href="#sec-{section.key}">
						<span class="idx-sec">{section.title}</span>
						<span class="idx-lead">— {section.sectionLead?.title ?? section.items[0]?.title}</span>
					</a>
					<span class="fl">❦</span>
				</span>
			{/each}
		</nav>
	{/if}

	{#if ed.lead}
		{@const lead = ed.lead}
		<!-- The page lead: the ONLY item allowed to dominate. Pirata One display
		     headline (blackletter = display-only, research Q4), kicker →
		     headline → deck in the ~36→18→14 layering ratio, brief opened wide
		     with the page's rationed drop cap. -->
		<div class="lead">
			<div class="lead-main" use:impression={impressionInfo(lead, 'captured', 1)}>
				<div class="cap">Captured — you saved this yesterday, from {lead.source}</div>
				<h2 class="display"><a href={itemLink(lead)} onclick={() => trackClick(lead)}>{lead.title}</a></h2>
				{#if lead.brief}
					<p class="deck dc">{lead.brief}</p>
				{:else}
					<p class="deck">{lead.title}</p>
				{/if}
			</div>
			{#if ed.leadSide}
				{@const leadSide = ed.leadSide}
				<div class="lead-side1 well" use:impression={impressionInfo(leadSide, 'captured', 2)}>
					<div class="cap">Also captured</div>
					<h3><a href={itemLink(leadSide)} onclick={() => trackClick(leadSide)}>{leadSide.title}</a></h3>
					<p>{leadSide.brief || leadSide.title}</p>
					<span class="mark"><b>Captured</b> · your save</span>
				</div>
			{/if}
			<div class="lead-side2 well">
				<div class="cap">Today at a glance</div>
				<p>{ed.glance}</p>
			</div>
		</div>
	{/if}

	{#each ed.sections as section, si (section.key)}
		<section id="sec-{section.key}">
			<h2 class="col-h">{section.title} <small>{section.items.length} item{section.items.length === 1 ? '' : 's'}</small></h2>
			<!-- Systematic chaos (research R10): the layout template rotates
			     deterministically per section — same tier structure, three
			     different grids, so no two sections sit alike and no rebuild
			     is random. Columns deliberately do NOT share baselines.
			     no-lead: the Captured section's display stories live in the
			     page-lead block above, so its grid must fill without one. -->
			<div class="cols t{si % 3} {section.sectionLead ? '' : 'no-lead'}">
				{#if section.sectionLead}
					{@const item = section.sectionLead}
					{@const m = markFor(item)}
					<article class="item tier-lead" use:impression={impressionInfo(item, section.key, 1)}>
						<h3><a href={itemLink(item)} onclick={() => trackClick(item)}>{item.title}</a></h3>
						{#if item.brief}
							<!-- Drop caps are rationed to ≤3 per page (research R4):
							     the page lead above + the first two section leads. -->
							<p class="body {si < 2 ? 'dc' : ''}">{item.brief}</p>
						{/if}
						<div class="markrow">
							<span class="mark"><b>{m.mark} {m.label}</b>{#if item.captured_at} · captured {item.captured_at.slice(0, 10)}{/if}</span>
						</div>
					</article>
				{/if}
				{#each section.secondary as item, i (item.id)}
					{@const m = markFor(item)}
					{@const pos = 2 + i}
					<article class="item tier-secondary sec{i}" use:impression={impressionInfo(item, section.key, pos)}>
						<h4><a href={itemLink(item)} onclick={() => trackClick(item)}>{item.title}</a></h4>
						{#if item.brief}
							<p class="body tight">{item.brief}</p>
						{/if}
						<div class="markrow">
							<span class="mark"><b>{m.mark} {m.label}</b>{#if item.captured_at} · captured {item.captured_at.slice(0, 10)}{/if}</span>
						</div>
					</article>
				{/each}
				{#if section.briefs.length > 0}
					<!-- The briefs well: agate-density, anchored home every day
					     (research R6). Hairline rule above each brief, column rules
					     between the columns, ragged right, no drop caps. The
					     typographic folds live here — a jumpline is only honest when
					     a story really continues across a break, so none are faked:
					     the fold IS the continuation (research amendment #3). -->
					<div class="briefs">
						<div class="briefs-cap">‡ Briefs <span class="briefs-count">{section.briefs.length}</span></div>
						<div class="briefs-cols">
							{#each section.briefs as item, i (item.id)}
								{@const m = markFor(item)}
								{@const pos = 2 + section.secondary.length + i}
								<article class="brief" use:impression={impressionInfo(item, section.key, pos)}>
									<h4 class="brief-h"><a href={itemLink(item)} onclick={() => trackClick(item)}>{item.title}</a></h4>
									{#if item.brief}
										<details class="fold">
											<summary><span class="fold-word"></span></summary>
											<p class="fold-body">{item.brief}</p>
										</details>
									{/if}
									<div class="brief-mark"><b>{m.mark} {m.label}</b> · via {item.source}</div>
								</article>
							{/each}
						</div>
					</div>
				{/if}
			</div>
		</section>
	{/each}

	<div class="toolbar screen-only">
		<a class="grade-link" href="/panel">QuickStudy panel</a>
		<span class="fl">❦</span>
		<a class="grade-link" href="/grade">Grade this edition →</a>
		{#if data.isAdmin}<span class="fl">❦</span><a class="grade-link" href="/admin">Admin</a>{/if}
		<span class="fl">❦</span>
		<span class="vote-note">clicks post to the private ledger on this server · editorial calls live at the grading desk</span>
	</div>

	<footer>— {ed.itemCount} items · edition {ed.date} · compiled by the 7 AM pipeline · read by a human —</footer>
</div>
