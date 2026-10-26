<script lang="ts">
	import '../../app.css';
	import NightToggle from '$lib/NightToggle.svelte';
	import type { CorrectionsSummary, Reason, Verdict, VerdictPostBody } from '$lib/domain/feedback.js';
	import type { PageData } from './$types.js';

	let { data }: { data: PageData } = $props();
	const d = $derived(data);

	/** One grading-desk row as produced by the page's server load. */
	type GradeRow = PageData['rows'][number];

	/* Grading desk v2 — one pass, one verdict (deep-read | skim | drop | skip).
	   A Readeck save is the capture signal, so `capture` is gone; the separate
	   vote pass is gone (its editorial signal lives in the optional reason
	   chips). `skip` (card t_1e178af7) is the explicit not-interested verdict —
	   the strongest negative: it scopes the item's topic/source for future
	   editions, and the reason chips say why. Every POST carries the v2
	   envelope; re-taps within this session SUPERSEDE the earlier event instead
	   of contradicting it. */
	const VERDICTS: readonly Verdict[] = ['deep-read', 'skim', 'drop', 'skip'];
	const REASONS: Reason[] = ['wrong-angle', 'already-read', 'wrong-source', 'dup', 'low-quality'];

	const sessionId = crypto.randomUUID();
	let verdicts = $state<Record<string, { value: Verdict; reason?: Reason }>>({}); // item_id -> { value, reason? }
	let lastEv = $state<Record<string, string>>({}); // item_id -> latest event id this client knows of
	let sessionCount = $state(0);
	let gradeError = $state('');

	$effect(() => {
		fetch(`/api/corrections?date=${d.date}`)
			.then((r) => r.json())
			.then((res: CorrectionsSummary) => {
				for (const [itemId, v] of Object.entries(res.last || {})) {
					// slot fields are loose (legacy v1 rows ride in the same map);
					// verdict values here came from validated v2 events
					if (v.verdict) verdicts[itemId] = { value: v.verdict as Verdict, reason: (v.reason || undefined) as Reason | undefined };
					if (v.ev) lastEv[itemId] = v.ev;
				}
			})
			.catch(() => {});
	});

	async function post(row: GradeRow, value: Verdict, reason?: Reason) {
		const prev = verdicts[row.id];
		const prevEv = lastEv[row.id];
		verdicts[row.id] = { value, reason }; // optimistic
		gradeError = '';
		try {
			const body: VerdictPostBody = {
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
			gradeError = 'verdict failed to reach the ledger — ' + (err instanceof Error ? err.message : String(err));
		}
	}

	function verdict(row: GradeRow, value: Verdict) {
		post(row, value, undefined);
	}

	function reason(row: GradeRow, chip: Reason) {
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
		<div class="under">one pass, one verdict — deep read, skim, drop, or not interested</div>
	</div>
	<div class="rail">
		<span>{d.dateLong}</span><span class="fl">❦</span>
		<span id="grade-count">{gradedCount} of {d.rows.length} items graded</span><span class="fl">❦</span>
		<span>{sessionCount} verdict{sessionCount === 1 ? '' : 's'} this visit</span>
		<span class="fl">❦</span>
		<NightToggle />
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
					<button class="grade-btn" class:picked={verdicts[row.id]?.value === v} onclick={() => verdict(row, v)}>{v === 'deep-read' ? 'deep read' : v === 'skip' ? 'not interested' : v}</button>
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
