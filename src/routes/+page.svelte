<script>
	import '../app.css';
	import { markFor, widthClass } from '$lib/edition.js';

	let { data } = $props();
	const ed = $derived(data.edition);

	/* Inline votes: POST to /api/corrections (server-side JSONL ledger).
	   Existing verdicts load from the server so they survive any device. */
	let votes = $state({});
	let voteError = $state('');

	$effect(() => {
		fetch(`/api/corrections?date=${ed.date}`)
			.then((r) => r.json())
			.then((d) => {
				for (const [itemId, v] of Object.entries(d.last || {})) {
					if (v.vote) votes[itemId] = v.vote;
				}
			})
			.catch(() => {});
	});

	async function vote(item, value) {
		const prev = votes[item.id];
		votes[item.id] = value; // optimistic
		voteError = '';
		try {
			const r = await fetch('/api/corrections', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					type: 'vote',
					value,
					item_id: item.id,
					edition_date: ed.date
				})
			});
			if (!r.ok) throw new Error((await r.json()).error || r.status);
		} catch (err) {
			if (prev === undefined) delete votes[item.id];
			else votes[item.id] = prev;
			voteError = 'vote failed to reach the ledger — ' + err.message;
		}
	}
</script>

<svelte:head>
	<title>The Morning Edition — {ed.dateLong}</title>
	<meta name="description" content="Your personal morning edition, compiled at 7:00 AM." />
</svelte:head>

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
				<h2><a href={ed.lead.url}>{ed.lead.title}</a></h2>
				<p class="deck">{ed.lead.brief || ed.lead.title}</p>
				<div class="vote screen-only">
					<span class="vq">your call:</span>
					<button class="vote-btn" class:voted={votes[ed.lead.id] === 'up'} onclick={() => vote(ed.lead, 'up')}>keep</button>
					<span class="vsep">·</span>
					<button class="vote-btn" class:voted={votes[ed.lead.id] === 'down'} onclick={() => vote(ed.lead, 'down')}>pass</button>
				</div>
			</div>
			{#if ed.leadSide}
				<div class="lead-side1 well">
					<div class="cap">Also captured</div>
					<h3><a href={ed.leadSide.url}>{ed.leadSide.title}</a></h3>
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
						<h3><a href={item.url}>{item.title}</a></h3>
						<p>{item.brief || item.title}</p>
						<div class="markrow">
							<span class="mark"><b>{m.mark} {m.label}</b>{#if item.captured_at} · captured {item.captured_at.slice(0, 10)}{/if}</span>
							<span class="vote screen-only">
								<span class="vq">your call:</span>
								<button class="vote-btn" class:voted={votes[item.id] === 'up'} onclick={() => vote(item, 'up')}>keep</button>
								<span class="vsep">·</span>
								<button class="vote-btn" class:voted={votes[item.id] === 'down'} onclick={() => vote(item, 'down')}>pass</button>
							</span>
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
		<span class="vote-note">{voteError || 'votes post to the private ledger on this server'}</span>
	</div>

	<footer>— {ed.itemCount} items · edition {ed.date} · compiled by the 7 AM pipeline · read by a human —</footer>
</div>
