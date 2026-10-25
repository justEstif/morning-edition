<script>
	import '../../app.css';

	let { data } = $props();
	const d = $derived(data);

	/* Grading desk v2 — one pass, one verdict (deep-read | skim | drop). A
	   Readeck save is the capture signal, so `capture` is gone; the separate
	   vote pass is gone (its editorial signal lives in the optional reason
	   chips). Every POST carries the v2 envelope; re-taps within this session
	   SUPERSEDE the earlier event instead of contradicting it. */
	const VERDICTS = ['deep-read', 'skim', 'drop'];
	const REASONS = ['wrong-angle', 'already-read', 'wrong-source', 'dup', 'low-quality'];

	const sessionId = crypto.randomUUID();
	let verdicts = $state({}); // item_id -> { value, reason? }
	let lastEv = $state({}); // item_id -> latest event id this client knows of
	let sessionCount = $state(0);
	let gradeError = $state('');

	$effect(() => {
		fetch(`/api/corrections?date=${d.date}`)
			.then((r) => r.json())
			.then((res) => {
				for (const [itemId, v] of Object.entries(res.last || {})) {
					if (v.verdict) verdicts[itemId] = { value: v.verdict, reason: v.reason || undefined };
					if (v.ev) lastEv[itemId] = v.ev;
				}
			})
			.catch(() => {});
	});

	async function post(row, value, reason) {
		const prev = verdicts[row.id];
		const prevEv = lastEv[row.id];
		verdicts[row.id] = { value, reason }; // optimistic
		gradeError = '';
		try {
			const body = {
				type: 'verdict',
				value,
				session_id: sessionId,
				item_id: row.id,
				item_url: row.url,
				source: row.source,
				edition_date: d.date
			};
			if (reason) body.reason = reason;
			if (prevEv) body.supersedes = prevEv;
			const r = await fetch('/api/corrections', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (!r.ok) throw new Error((await r.json()).error || r.status);
			const res = await r.json();
			if (res.event?.id) lastEv[row.id] = res.event.id;
			sessionCount++;
		} catch (err) {
			if (prev === undefined) delete verdicts[row.id];
			else verdicts[row.id] = prev;
			gradeError = 'verdict failed to reach the ledger — ' + err.message;
		}
	}

	function verdict(row, value) {
		post(row, value, undefined);
	}

	function reason(row, chip) {
		const cur = verdicts[row.id];
		// re-tapping the picked chip clears it (supersede, never contradict)
		post(row, cur.value, cur.reason === chip ? undefined : chip);
	}

	const gradedCount = $derived(Object.keys(verdicts).length);
</script>

<svelte:head>
	<title>The Grading Desk — The Morning Edition — {d.dateLong}</title>
</svelte:head>

<div class="page">
	<div class="masthead">
		<div class="over">Your Personal Morning Edition</div>
		<h1>The Grading Desk</h1>
		<div class="under">one pass, one verdict — deep read, skim, or drop</div>
	</div>
	<div class="rail">
		<span>{d.dateLong}</span><span class="fl">❦</span>
		<span id="grade-count">{gradedCount} of {d.rows.length} items graded</span><span class="fl">❦</span>
		<span>{sessionCount} verdict{sessionCount === 1 ? '' : 's'} this visit</span>
		{#if d.isDemo}<span class="fl">❦</span><span>demo edition — mock data only</span>{/if}
	</div>

	{#each d.rows as row (row.id)}
		<div class="grade-row" data-item-id={row.id}>
			<div class="g-body">
				<h3>{row.title}</h3>
				{#if row.brief}
					<p class="g-brief">{row.brief}</p>
				{:else}
					<p class="g-brief none">no brief — headline-only item</p>
				{/if}
				<p class="mark">{row.mark}</p>
			</div>
			<div class="g-btns screen-only">
				{#each VERDICTS as v, vi (v)}
					{#if vi > 0}<span class="vsep">·</span>{/if}
					<button class="grade-btn" class:picked={verdicts[row.id]?.value === v} onclick={() => verdict(row, v)}>{v === 'deep-read' ? 'deep read' : v}</button>
				{/each}
			</div>
			{#if verdicts[row.id]}
				<div class="chips screen-only">
					<span class="vq">why? (optional)</span>
					{#each REASONS as chip (chip)}
						<button class="chip-btn" class:picked={verdicts[row.id]?.reason === chip} onclick={() => reason(row, chip)}>{chip}</button>
					{/each}
				</div>
			{/if}
		</div>
	{/each}

	<div class="toolbar screen-only">
		<a class="grade-link" href="/">← Back to the edition</a>
		<span class="fl">❦</span>
		<span class="vote-note">{gradeError || 'verdicts post to the private ledger on this server — re-taps supersede, never contradict'}</span>
	</div>

	<footer>— {d.itemCount} items · edition {d.date} · one pass, one verdict —</footer>
</div>
