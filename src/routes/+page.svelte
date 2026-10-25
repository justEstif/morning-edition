<script>
	import '../app.css';
	import { markFor, widthClass } from '$lib/edition.js';

	let { data } = $props();
	const ed = $derived(data.edition);

	/* Grading-desk v2: the inline vote pass is gone — its editorial signal is a
	   verdict at the grading desk. What the edition page records is implicit:
	   click-throughs POST a v2 `click` event (keepalive so the POST survives
	   the navigation). Existing state stays server-side, any device. */
	const sessionId = crypto.randomUUID();

	/* Folds print OPEN: beforeprint opens every fold (restored after). The
	   @media print ::details-content rule covers engines where the event
	   doesn't fire; together the paper never prints a closed fold. */
	let foldStates = [];
	function openFolds() {
		foldStates = [...document.querySelectorAll('details.fold')].map((d) => d.open);
		document.querySelectorAll('details.fold').forEach((d) => (d.open = true));
	}
	function restoreFolds() {
		document.querySelectorAll('details.fold').forEach((d, i) => (d.open = foldStates[i] ?? false));
		foldStates = [];
	}

	function trackClick(item) {
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
		{#if data.isDemo}<span class="fl">❦</span><span>demo edition — mock data only</span>{/if}
	</div>

	{#if ed.lead}
		<div class="lead">
			<div class="lead-main">
				<div class="cap">Captured — you saved this yesterday, from {ed.lead.source}</div>
				<h2><a href={ed.lead.url} onclick={() => trackClick(ed.lead)}>{ed.lead.title}</a></h2>
				<p class="deck">{ed.lead.brief || ed.lead.title}</p>
			</div>
			{#if ed.leadSide}
				<div class="lead-side1 well">
					<div class="cap">Also captured</div>
					<h3><a href={ed.leadSide.url} onclick={() => trackClick(ed.leadSide)}>{ed.leadSide.title}</a></h3>
					<p>{ed.leadSide.brief || ed.leadSide.title}</p>
					<span class="mark"><b>Captured</b> · your save</span>
				</div>
			{/if}
			<div class="lead-side2 well">
				<div class="cap">Today at a glance</div>
				<p>{ed.glance}</p>
			</div>
		</div>
	{/if}

	{#each ed.sections as section (section.key)}
		<section>
			<h2 class="col-h">{section.title} <small>{section.items.length} item{section.items.length === 1 ? '' : 's'}</small></h2>
			<div class="cols">
				{#each section.items as item, i (item.id)}
					{@const m = markFor(item)}
					<div class="item {widthClass(section, i)}">
						<h3><a href={item.url} onclick={() => trackClick(item)}>{item.title}</a></h3>
						{#if item.brief}
							<!-- the fold: the item's actual brief, one typographic tap away -->
							<details class="fold">
								<summary><span class="fold-word"></span></summary>
								<p class="fold-body">{item.brief}</p>
							</details>
						{:else}
							<!-- no brief: keep the item's 3-row subgrid so marks stay baseline-aligned -->
							<div class="fold-empty" aria-hidden="true"></div>
						{/if}
						<div class="markrow">
							<span class="mark"><b>{m.mark} {m.label}</b>{#if item.captured_at} · captured {item.captured_at.slice(0, 10)}{/if}</span>
						</div>
					</div>
				{/each}
			</div>
		</section>
	{/each}

	<div class="toolbar screen-only">
		<a class="grade-link" href="/panel">QuickStudy panel</a>
		<span class="fl">❦</span>
		<a class="grade-link" href="/grade">Grade this edition →</a>
		<span class="fl">❦</span>
		<span class="vote-note">clicks post to the private ledger on this server · editorial calls live at the grading desk</span>
	</div>

	<footer>— {ed.itemCount} items · edition {ed.date} · compiled by the 7 AM pipeline · read by a human —</footer>
</div>
