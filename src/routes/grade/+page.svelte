<script>
	import '../../app.css';

	let { data } = $props();
	const d = $derived(data);

	/* Grade state comes from the server ledger (restart-safe, any device). */
	let grades = $state({});
	let sessionCount = $state(0);
	let gradeError = $state('');

	$effect(() => {
		fetch(`/api/corrections?date=${d.date}`)
			.then((r) => r.json())
			.then((res) => {
				for (const [itemId, v] of Object.entries(res.last || {})) {
					if (v.grade) grades[itemId] = v.grade;
				}
			})
			.catch(() => {});
	});

	async function grade(row, value) {
		const prev = grades[row.id];
		grades[row.id] = value; // optimistic
		gradeError = '';
		try {
			const r = await fetch('/api/corrections', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ type: 'grade', value, item_id: row.id, edition_date: d.date })
			});
			if (!r.ok) throw new Error((await r.json()).error || r.status);
			sessionCount++;
		} catch (err) {
			if (prev === undefined) delete grades[row.id];
			else grades[row.id] = prev;
			gradeError = 'grade failed to reach the ledger — ' + err.message;
		}
	}

	const gradedCount = $derived(Object.keys(grades).length);
</script>

<svelte:head>
	<title>The Grading Desk — The Morning Edition — {d.dateLong}</title>
</svelte:head>

<div class="page">
	<div class="masthead">
		<div class="over">Your Personal Morning Edition</div>
		<h1>The Grading Desk</h1>
		<div class="under">one tap per item — deep read, skim, or capture</div>
	</div>
	<div class="rail">
		<span>{d.dateLong}</span><span class="fl">❦</span>
		<span id="grade-count">{gradedCount} of {d.rows.length} items graded</span><span class="fl">❦</span>
		<span>{sessionCount} grade{sessionCount === 1 ? '' : 's'} this visit</span>
		{#if d.isDemo}<span class="fl">❦</span><span>demo edition — mock data only</span>{/if}
	</div>

	{#each d.rows as row (row.id)}
		<div class="grade-row" data-item-id={row.id}>
			<div class="g-body">
				<h3>{row.title}</h3>
				<p class="mark">{row.mark}</p>
			</div>
			<div class="g-btns screen-only">
				<button class="grade-btn" class:picked={grades[row.id] === 'deep-read'} onclick={() => grade(row, 'deep-read')}>deep read</button>
				<span class="vsep">·</span>
				<button class="grade-btn" class:picked={grades[row.id] === 'skim'} onclick={() => grade(row, 'skim')}>skim</button>
				<span class="vsep">·</span>
				<button class="grade-btn" class:picked={grades[row.id] === 'capture'} onclick={() => grade(row, 'capture')}>capture</button>
			</div>
		</div>
	{/each}

	<div class="toolbar screen-only">
		<a class="grade-link" href="/">← Back to the edition</a>
		<span class="fl">❦</span>
		<span class="vote-note">{gradeError || 'grades post to the private ledger on this server'}</span>
	</div>

	<footer>— {d.itemCount} items · edition {d.date} · grading appends to the same feedback ledger as the edition page —</footer>
</div>
