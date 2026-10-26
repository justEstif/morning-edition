<script lang="ts">
	import '../../../app.css';
	import NightToggle from '$lib/NightToggle.svelte';
	import { markFor } from '$lib/domain/edition.js';
	import type { Reason, Verdict, VerdictPostBody } from '$lib/domain/feedback.js';
	import { impression } from '$lib/impressions.js';
	// The dwell module settles any pending open (the front page's click) on
	// load — the in-paper read itself becomes the dwell span, same session
	// semantics as every other surface (card t_ea679b5a, unchanged shapes).
	import '$lib/dwell.js';
	import type { PageData } from './$types.js';

	let { data }: { data: PageData } = $props();
	const d = $derived(data);
	const m = $derived(markFor(d.item));

	/* Impressions flow from the reader too (additive, same event shape): the
	   article element is the exposure, position 1 of its re-opened section.
	   Dedupe is per item+session+edition in $lib/impressions.js, so a story
	   already impressed on the front page never double-counts. NOTE: the
	   telemetry field `tier` predates the broadsheet tier and still carries
	   the item KIND — a payload contract, unchanged on purpose. */
	function impressionInfo() {
		return {
			item_id: d.item.id,
			item_url: d.item.url,
			source: d.item.source,
			edition_date: d.editionDate,
			section: d.item.section,
			tier: d.item.kind,
			position: 1
		};
	}

	const paragraphs = $derived((d.text ?? '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean));
	/* The cap opens the PROSE, not boilerplate — extracted text often starts
	   with a dateline or scraped fragment ("30 Apr, 2026"), and a two-inch
	   "3" atop that is comedy, not typography. First paragraph with real
	   substance carries the cap; earlier fragments still print, uncapped. */
	const DROP_CAP_MIN_CHARS = 60;
	const dropIdx = $derived(paragraphs.findIndex((p) => p.length >= DROP_CAP_MIN_CHARS));

	const sessionId = crypto.randomUUID();
	const VERDICTS: readonly Verdict[] = ['deep-read', 'skim', 'drop'];
	const REASONS: Reason[] = ['wrong-angle', 'already-read', 'wrong-source', 'dup', 'low-quality'];
	let verdict = $state<Verdict | null>(null);
	let reason = $state<Reason | undefined>(undefined);
	let lastEv = $state<string | null>(null);
	let verdictError = $state('');

	$effect(() => {
		// The desk's own reduction: existing verdicts for this edition, so the
		// margin card shows what the ledger already holds (supersede, never
		// contradict — the /grade semantics verbatim).
		fetch(`/api/corrections?date=${d.editionDate}`)
			.then((r) => r.json())
			.then((res: { last?: Record<string, { verdict?: string; reason?: string; ev?: string }> }) => {
				const slot = res.last?.[d.item.id];
				if (slot?.verdict) verdict = slot.verdict as Verdict;
				if (slot?.reason) reason = slot.reason as Reason;
				if (slot?.ev) lastEv = slot.ev;
			})
			.catch(() => {});
	});

	async function postVerdict(value: Verdict, why?: Reason) {
		const prevVerdict = verdict;
		const prevReason = reason;
		verdict = value; // optimistic
		reason = why;
		verdictError = '';
		try {
			const body: VerdictPostBody = {
				type: 'verdict',
				value,
				session_id: sessionId,
				item_id: d.item.id,
				item_url: d.item.url,
				source: d.item.source,
				edition_date: d.editionDate
			};
			if (why) body.reason = why;
			if (lastEv) body.supersedes = lastEv;
			const r = await fetch('/api/corrections', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (!r.ok) throw new Error((await r.json()).error || String(r.status));
			const res = await r.json();
			if (res.event?.id) lastEv = res.event.id;
		} catch (err) {
			verdict = prevVerdict;
			reason = prevReason;
			verdictError = 'verdict failed to reach the ledger — ' + (err instanceof Error ? err.message : String(err));
		}
	}

	function pick(value: Verdict) {
		postVerdict(value, undefined);
	}

	function chip(why: Reason) {
		if (verdict === null) return; // a reason rides a verdict, never stands alone
		postVerdict(verdict, reason === why ? undefined : why);
	}

	/* An outbound hop from the reader (wire-note link, "more in this section"
	   external link) records the same click event the front page records —
	   item ids unchanged, one open → one dwell, nothing new on the wire. */
	function trackOutbound(url: string) {
		try {
			fetch('/api/corrections', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				keepalive: true,
				body: JSON.stringify({
					type: 'click',
					url,
					session_id: sessionId,
					item_id: d.item.id,
					item_url: d.item.url,
					source: d.item.source,
					edition_date: d.editionDate
				})
			}).catch(() => {});
		} catch {
			// tracking must never break reading
		}
	}

	function hostOf(url: string): string {
		try {
			return new URL(url).hostname.replace(/^www\./, '');
		} catch {
			return url;
		}
	}
	const host = $derived(hostOf(d.item.url));
</script>

<svelte:head>
	<title>{d.item.title} — The Morning Edition — {d.dateLong}</title>
	<meta name="description" content={d.item.brief ?? d.item.title} />
</svelte:head>

<div class="page reader">
	<div class="masthead inside">
		<div class="over">The Morning Edition — Inside</div>
		<h1><a href="/">The Morning Edition</a></h1>
		<div class="under">continued from the front page — the story in full</div>
	</div>
	<div class="rail">
		<span>{d.dateLong}</span><span class="fl">❦</span>
		<span>{d.sectionTitle}</span><span class="fl">❦</span>
		<a href="/">↩ Return to the front page</a>
		<span class="fl">❦</span>
		<a href="/grade">Grade this edition</a>
		<span class="fl">❦</span>
		<NightToggle />
		{#if d.isDemo}<span class="fl">❦</span><span>demo edition — mock data only</span>{/if}
	</div>

	<div class="reader-grid">
		<article class="reader-main" use:impression={impressionInfo()} data-item-id={d.item.id}>
			<p class="kicker"><b>{m.mark} {m.label}</b> · via {d.item.source}{#if d.item.captured_at} · captured {d.item.captured_at.slice(0, 10)}{/if}</p>
			<h1 class="display">{d.item.title}</h1>
			<!-- Extension point (depth ladder, t_2f96c207): a pre-read tier slots
			     HERE, between headline and body — the grid below is unaffected. -->

			{#if d.text}
				<div class="reader-body">
					{#each paragraphs as p, i (i)}
						<p class={i === dropIdx ? 'dc' : ''}>{p}</p>
					{/each}
				</div>
			{:else}
				<!-- Designed failure state (spike decision #4): the extraction
				     failed — the wire note says so plainly, the external door
				     stays open, the margin keeps note + verdicts. -->
				<div class="wire-note">
					<p>This story resisted our press — no full text could be set in these columns.</p>
					<p><a href={d.item.url} onclick={() => trackOutbound(d.item.url)}>Read it at the source ↗</a></p>
				</div>
			{/if}

			<div class="end-furniture">
				<span class="fl">❦</span>
				<a href="/">↩ Return to the front page</a>
				<span class="fl">·</span>
				<a href="/grade">Grade this edition →</a>
				<span class="fl">❦</span>
			</div>
		</article>

		<aside class="reader-margin">
			{#if d.item.brief}
				<!-- The engine's voice, typographically fenced (spike decision #1):
				     italic marginalia, never confusable with the author's text. -->
				<div class="paper-note">
					<div class="cap">The paper's note</div>
					<p>{d.item.brief}</p>
				</div>
			{/if}

			<!-- The story registry made visible (spike decision #2). -->
			<div class="provenance">
				<div class="cap">Provenance</div>
				<dl>
					<dt>Source</dt><dd>via {d.item.source} · {host}</dd>
					<dt>Angle</dt><dd>{d.sectionTitle}</dd>
					{#if d.item.captured_at}<dt>Captured</dt><dd>{d.item.captured_at.slice(0, 10)}</dd>{/if}
					<dt>First showing</dt><dd>edition {d.editionDate}</dd>
				</dl>
			</div>

			<!-- Sticky verdict card (spike decision #3): grade while you read,
			     same /grade semantics — supersede, never contradict. -->
			<div class="verdict-card screen-only">
				<span class="vq">Worth your time?</span>
				<div class="vc-btns">
					{#each VERDICTS as v (v)}
						<button type="button" class="grade-btn" class:picked={verdict === v} onclick={() => pick(v)}>
							{v === 'deep-read' ? 'deep read' : v}
						</button>
					{/each}
				</div>
				{#if verdict}
					<div class="chips">
						<span class="vq">why?</span>
						{#each REASONS as c (c)}
							<button type="button" class="chip-btn" class:picked={reason === c} onclick={() => chip(c)}>{c}</button>
						{/each}
					</div>
				{/if}
				{#if verdictError}<span class="vote-note">{verdictError}</span>{/if}
			</div>
		</aside>
	</div>

	{#if d.more.length > 0}
		<!-- Continue-reading exit (spike decision #5): finishing a story starts
		     the next one. Continuous scroll; no pagination anywhere. -->
		<div class="more-section">
			<h2 class="col-h">More in {d.sectionTitle}</h2>
			{#each d.more as o (o.id)}
				<p class="more-item">
					{#if o.inPaper}
						<a href={o.href} data-item-id={o.id}>{o.title}</a>
					{:else}
						<a href={o.href} data-item-id={o.id} onclick={() => trackOutbound(o.href)}>{o.title} ↗</a>
					{/if}
				</p>
			{/each}
		</div>
	{/if}

	<footer>— edition {d.editionDate} · compiled by the 7 AM pipeline · read by a human —</footer>
</div>
