<script lang="ts">
	import '../../../app.css';
	import NightToggle from '$lib/NightToggle.svelte';
	import { markFor } from '$lib/domain/edition.js';
	import { paragraphSegments, type Seg } from '$lib/domain/annotations.js';
	import type { Reason, Verdict, VerdictPostBody } from '$lib/domain/feedback.js';
	import { impression } from '$lib/impressions.js';
	// The dwell module settles any pending open (the front page's click) on
	// load — the in-paper read itself becomes the dwell span, same session
	// semantics as every other surface (card t_ea679b5a, unchanged shapes).
	// For anonymous readers any settlement POST is refused by the session
	// gate (owner-only /api) — an anonymous read writes nothing (t_43e48cd0).
	import '$lib/dwell.js';
	import type { PageData } from './$types.js';

	let { data }: { data: PageData } = $props();
	const d = $derived(data);
	const m = $derived(markFor(d.item));

	/* Impressions flow from the reader too (additive, same event shape): the
	   article element is the exposure, position 1 of its re-opened section.
	   Dedupe is per item+session+edition in $lib/impressions.js, so a story
	   already impressed on the front page never double-counts. ANONYMOUS
	   visitors (public read, t_43e48cd0): no exposure is attached at all —
	   the action gets null and never tracks — so an anonymous read writes
	   nothing to the owner's ranker signal. NOTE: the telemetry field `tier`
	   predates the broadsheet tier and still carries the item KIND — a
	   payload contract, unchanged on purpose. */
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
	/* Reader quality gate (card t_b3782402): digest mode requires BOTH the
	   builder's claim (item.reader_mode) and the stored digest — either side
	   missing falls back to the honest tiers below (full text or wire note).
	   The digest is the main content, labeled in the marginalia; the raw
	   extract demotes below the fold. Full mode renders byte-identically. */
	const digestMode = $derived(d.readerMode === 'digest' && !!d.digest);
	const digestParagraphs = $derived(
		(d.digest ?? '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
	);
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
		// Anonymous readers carry no verdict state — the card isn't rendered
		// below, and /api/corrections is owner-only anyway.
		if (!d.isOwner) return;
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
	   item ids unchanged, one open → one dwell, nothing new on the wire.
	   Anonymous readers: the hop is just a hop — no click event, no dwell
	   open from this surface (public read writes nothing, t_43e48cd0). */
	function trackOutbound(url: string) {
		if (!d.isOwner) return;
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

	/* ---- Owner marginalia (card t_e86490c0) ----
	   Highlights anchor to CHARACTER OFFSETS IN THE STORED EXTRACTED TEXT:
	   the load hands the owner the paragraph→offset map (paraStarts), the
	   selection is mapped into those offsets locally, and the server slices
	   the quote out of the stored text at write time. The render-time drift
   pass already ran server-side (verifyAnchor): only anchor-verified marks
   render in the body — a drifted mark appears in the margin flagged,
   never silently mis-highlighted. Anonymous readers get none of this:
   no marks, no offsets, no controls (public read writes nothing). */
	type OwnerMark = PageData['marginalia'][number];

	let marks = $state<OwnerMark[]>([]);
	let pendingSel = $state<{ start: number; end: number; excerpt: string } | null>(null);
	let markError = $state('');
	let savingMark = $state(false);
	let composing = $state<{ kind: 'note' | 'comment'; markId: string } | null>(null);
	let composeText = $state('');

	$effect(() => {
		// Re-hydrate from the owner payload on every load (client-side nav
		// between articles reuses this component instance).
		marks = d.marginalia;
		pendingSel = null;
		composing = null;
	});

	/* The anchor-verified marks are the only ones allowed to touch the body. */
	const verifiedMarks = $derived(marks.filter((mk) => mk.anchor.ok));

	function segsFor(i: number, text: string): Seg[] {
		const start = d.paraStarts?.[i];
		if (!d.isOwner || start === undefined || verifiedMarks.length === 0)
			return [{ text, markId: null }];
		return paragraphSegments({ text, start, end: start + text.length }, verifiedMarks);
	}

	/* Selection → stored-text offsets. Both boundaries must sit inside a
	   .reader-body paragraph (the digest lede is NOT stored text — marks
	   there are impossible by construction). */
	function textOffsetInPara(p: HTMLElement, node: Node, offset: number): number | null {
		if (node === p) return offset === 0 ? 0 : null;
		const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
		let acc = 0;
		while (walker.nextNode()) {
			const n = walker.currentNode;
			if (n === node) return acc + offset;
			acc += n.textContent?.length ?? 0;
		}
		return null;
	}

	function paraOf(node: Node): { el: HTMLElement; idx: number } | null {
		const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement);
		const p = el?.closest?.('p[data-p]');
		if (!p || !p.closest('.reader-body')) return null;
		return { el: p as HTMLElement, idx: Number((p as HTMLElement).dataset.p) };
	}

	function captureSelection() {
		if (!d.isOwner || !d.paraStarts) {
			pendingSel = null;
			return;
		}
		const sel = document.getSelection();
		if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
			pendingSel = null;
			return;
		}
		const range = sel.getRangeAt(0);
		const a = paraOf(range.startContainer);
		const b = paraOf(range.endContainer);
		const oa = a ? textOffsetInPara(a.el, range.startContainer, range.startOffset) : null;
		const ob = b ? textOffsetInPara(b.el, range.endContainer, range.endOffset) : null;
		const sa = a ? d.paraStarts[a.idx] : undefined;
		const sb = b ? d.paraStarts[b.idx] : undefined;
		if (oa === null || ob === null || sa === undefined || sb === undefined) {
			pendingSel = null;
			return;
		}
		let start = sa + oa;
		let end = sb + ob;
		if (start > end) [start, end] = [end, start];
		if (end - start < 3) {
			pendingSel = null; // a stray click is not a passage
			return;
		}
		pendingSel = {
			start,
			end,
			excerpt: sel.toString().replace(/\s+/g, ' ').trim().slice(0, 160)
		};
	}

	async function saveMark() {
		if (!pendingSel || savingMark) return;
		savingMark = true;
		markError = '';
		try {
			const r = await fetch('/api/annotations', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					type: 'highlight',
					item_id: d.item.id,
					edition_date: d.editionDate,
					start: pendingSel.start,
					end: pendingSel.end
				})
			});
			if (!r.ok) throw new Error((await r.json()).error || String(r.status));
			const res = await r.json();
			marks = [...marks, { ...res.row, notes: [], comments: [], anchor: { ok: true } }];
			pendingSel = null;
			document.getSelection()?.removeAllRanges();
		} catch (err) {
			markError =
				'the mark never reached the desk — ' +
				(err instanceof Error ? err.message : String(err));
		} finally {
			savingMark = false;
		}
	}

	function startCompose(kind: 'note' | 'comment', markId: string) {
		composing = { kind, markId };
		composeText = '';
	}

	async function saveCompose() {
		if (!composing || !composeText.trim()) return;
		const { kind, markId } = composing;
		const text = composeText.trim();
		try {
			const r = await fetch('/api/annotations', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ type: kind, target: markId, text })
			});
			if (!r.ok) throw new Error((await r.json()).error || String(r.status));
			const res = await r.json();
			marks = marks.map((mk) =>
				mk.id === markId
					? {
							...mk,
							[kind === 'note' ? 'notes' : 'comments']: [
								...mk[kind === 'note' ? 'notes' : 'comments'],
								{ id: res.row.id, ts: res.row.ts, text: res.row.text }
							]
						}
					: mk
			);
			composing = null;
			composeText = '';
		} catch (err) {
			markError =
				'it never reached the desk — ' + (err instanceof Error ? err.message : String(err));
		}
	}

	async function discard(id: string) {
		try {
			const r = await fetch('/api/annotations', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ type: 'retract', target: id })
			});
			if (!r.ok) throw new Error((await r.json()).error || String(r.status));
			marks = marks.filter((mk) => mk.id !== id);
			if (composing?.markId === id) composing = null;
		} catch (err) {
			markError =
				'the retraction never reached the desk — ' +
				(err instanceof Error ? err.message : String(err));
		}
	}

	/* The depth ladder (card t_2f96c207, spike 002 variant B): the pre-read
	   stacks under the headline; the full piece stays behind the explicit
	   ✶ continue until asked for. OPENING IT IS THE DEEP-READ SIGNAL — one
	   additive `escalate` event per page load, owner-session only (anonymous
	   readers write nothing, t_43e48cd0; closing and reopening doesn't
	   double-count — the commitment, not the toggle, is the datum). */
	const preReadParas = $derived(
		(d.preRead ?? '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
	);
	let escalated = false;
	function onContinueToggle(ev: Event) {
		if (!(ev.currentTarget instanceof HTMLDetailsElement) || !ev.currentTarget.open) return;
		if (escalated || !d.isOwner) return;
		escalated = true;
		try {
			fetch('/api/corrections', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				keepalive: true,
				body: JSON.stringify({
					type: 'escalate',
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
</script>

<svelte:document onselectionchange={captureSelection} />

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
		{#if d.isOwner}<a href="/grade">Grade this edition</a>
			<span class="fl">❦</span>
			<a href="/admin">The desk</a>
			<span class="fl">❦</span>{/if}
		<NightToggle />
		{#if d.isDemo}<span class="fl">❦</span><span>demo edition — mock data only</span>{/if}
	</div>

	<div class="reader-grid">
		<article
			class="reader-main"
			use:impression={d.isOwner ? impressionInfo() : null}
			data-item-id={d.item.id}
		>
			<p class="kicker"><b>{m.mark} {m.label}</b> · via {d.item.source}{#if d.item.captured_at} · captured {d.item.captured_at.slice(0, 10)}{/if}</p>
			<h1 class="display">{d.item.title}</h1>
			{#if d.preRead}
				<!-- The depth ladder's pre-read tier (card t_2f96c207, spike 002
				     variant B): the five-minute version — the actual arguments,
				     the contentious parts, the assumptions, who should bother.
				     It stacks UNDER the headline; the brief stays in the margin
				     (the 15-second artifact is unchanged); the full piece waits
				     behind the explicit ✶ below. -->
				<section class="pre-read" aria-label="Pre-read — the five-minute version">
					<div class="pre-read-cap">
						The five-minute version <span class="fl">❦</span> ≈{d.preReadMinutes} min read
					</div>
					{#each preReadParas as p, i (i)}
						<p class={i === 0 ? 'pre-read-lede' : ''}>{p}</p>
					{/each}
				</section>
				<details class="continue" ontoggle={onContinueToggle}>
					<summary>✶ Continue to the full piece</summary>
					<div class="continue-body">
						{#if digestMode}
							<div class="digest-main">
								{#each digestParagraphs as p, i (i)}
									<p class={i === 0 ? 'digest-lede' : ''}>{p}</p>
								{/each}
							</div>
							<details class="digest-raw">
								<summary>The raw extract, as scraped</summary>
								<div class="reader-body digest-raw-body">
									{#each paragraphs as p, i (i)}
										<p>{p}</p>
									{/each}
								</div>
							</details>
						{:else if d.text}
							<div class="reader-body">
								{#each paragraphs as p, i (i)}
									{@const segs = segsFor(i, p)}
									<p class={i === dropIdx ? 'dc' : ''} data-p={i}
										>{#each segs as s, j (j)}{#if s.markId}<mark class="rd-mark" data-mark={s.markId}
											>{s.text}</mark
										>{:else}{s.text}{/if}{/each}</p
									>
								{/each}
							</div>
						{/if}
						</div>
						</details>
						{:else if digestMode}
				<!-- Reader quality gate (card t_b3782402): the source gave little,
				     so the paper's digest is the story — labeled in the margin,
				     not styled as a full article. The raw extract sits below the
				     fold (details), the honest provenance keeps the source door
				     open. -->
				<div class="digest-main">
					{#each digestParagraphs as p, i (i)}
						<p class={i === 0 ? 'digest-lede' : ''}>{p}</p>
					{/each}
				</div>
				<details class="digest-raw">
					<summary>The raw extract, as scraped</summary>
					<div class="reader-body digest-raw-body">
						{#each paragraphs as p, i (i)}
							{@const segs = segsFor(i, p)}
							<p data-p={i}
								>{#each segs as s, j (j)}{#if s.markId}<mark class="rd-mark" data-mark={s.markId}
										>{s.text}</mark
									>{:else}{s.text}{/if}{/each}</p
							>
						{/each}
					</div>
				</details>
			{:else if d.text}
				<div class="reader-body">
					{#each paragraphs as p, i (i)}
						{@const segs = segsFor(i, p)}
						<p class={i === dropIdx ? 'dc' : ''} data-p={i}
							>{#each segs as s, j (j)}{#if s.markId}<mark class="rd-mark" data-mark={s.markId}
									>{s.text}</mark
								>{:else}{s.text}{/if}{/each}</p
						>
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
				{#if d.isOwner}
					<span class="fl">·</span>
					<a href="/grade">Grade this edition →</a>
				{/if}
				<span class="fl">❦</span>
			</div>
		</article>

		<aside class="reader-margin">
			{#if digestMode}
				<!-- The gate's marginalia label (card t_b3782402), in the house
				     register: honest about how much the source gave. -->
				<div class="paper-note digest-note">
					<div class="cap">A short one</div>
					<p>a short one &mdash; the paper&rsquo;s digest. The source yielded only a fragment; it is condensed at left, and the raw scrap is set below the digest.</p>
				</div>
			{/if}
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
					{#if digestMode}
						<dt>At the source</dt>
						<dd><a href={d.item.url} onclick={() => trackOutbound(d.item.url)}>{host} ↗</a></dd>
					{/if}
					<dt>Angle</dt><dd>{d.sectionTitle}</dd>
					{#if d.item.captured_at}<dt>Captured</dt><dd>{d.item.captured_at.slice(0, 10)}</dd>{/if}
					<dt>First showing</dt><dd>edition {d.editionDate}</dd>
				</dl>
			</div>

			<!-- Owner marginalia (card t_e86490c0): the owner's private marks,
		     notes and longer comments — set in the house register (small caps,
		     dagger marks, hairline rules), never a floating annotator toolbar.
		     Anonymous readers get nothing here. -->
		{#if d.isOwner}
			<div class="marginalia">
				<div class="cap">Marginalia</div>
				{#if pendingSel}
					<div class="mark-pending">
						<p class="mp-quote">†&nbsp;{pendingSel.excerpt}</p>
						<div class="mk-actions">
							<button type="button" class="mk-btn" onclick={saveMark} disabled={savingMark}>
								{savingMark ? 'setting…' : 'mark it'}
							</button>
							<button type="button" class="mk-btn" onclick={() => (pendingSel = null)}>dismiss</button>
						</div>
					</div>
				{/if}
				{#each marks as mk (mk.id)}
					<div class="mark-entry" class:drifted={!mk.anchor.ok}>
						{#if mk.anchor.ok}
							<p class="mk-quote">†&nbsp;{mk.quote}</p>
						{:else}
							<p class="mk-quote mk-drift">†&nbsp;lost its anchor — the stored text changed under this mark</p>
						{/if}
						{#each mk.notes as n (n.id)}<p class="mk-note">{n.text}</p>{/each}
						{#each mk.comments as c (c.id)}<p class="mk-comment">{c.text}</p>{/each}
						{#if composing && composing.markId === mk.id}
							<textarea
								class="mk-input"
								bind:value={composeText}
								placeholder={composing.kind === 'note' ? 'a note, short…' : 'a longer remark…'}
							></textarea>
							<div class="mk-actions">
								<button type="button" class="mk-btn" onclick={saveCompose}>save</button>
								<button type="button" class="mk-btn" onclick={() => (composing = null)}>cancel</button>
							</div>
						{:else}
							<div class="mk-actions">
								<button type="button" class="mk-btn" onclick={() => startCompose('note', mk.id)}>note</button>
								<button type="button" class="mk-btn" onclick={() => startCompose('comment', mk.id)}>comment</button>
								<button type="button" class="mk-btn" onclick={() => discard(mk.id)}>discard</button>
							</div>
						{/if}
					</div>
				{/each}
				{#if marks.length === 0 && !pendingSel}
					<p class="mk-empty">select any passage below to set a private mark.</p>
				{/if}
				{#if markError}<span class="vote-note">{markError}</span>{/if}
			</div>
		{/if}

		<!-- Sticky verdict card (spike decision #3): grade while you read,
			     same /grade semantics — supersede, never contradict. Owner-only
			     (t_43e48cd0): anonymous readers get no verdict card, no grade
			     links, no sign-in nagging — reading is the whole public surface. -->
			{#if d.isOwner}
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
		{/if}
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
