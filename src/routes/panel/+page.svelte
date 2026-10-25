<script lang="ts">
	import '../../app.css';
	import { impression } from '$lib/impressions.js';
	import type { PageData } from './$types.js';

	let { data }: { data: PageData } = $props();
	const d = $derived(data);

	/* Folds print OPEN — same contract as the broadsheet (card t_dfe82b06). */
	let foldStates: boolean[] = [];
	function openFolds() {
		const folds = document.querySelectorAll<HTMLDetailsElement>('details.fold');
		foldStates = [...folds].map((dt) => dt.open);
		folds.forEach((dt) => (dt.open = true));
	}
	function restoreFolds() {
		document.querySelectorAll<HTMLDetailsElement>('details.fold').forEach((dt, i) => (dt.open = foldStates[i] ?? false));
		foldStates = [];
	}
</script>

<svelte:head>
	<title>The Morning Edition — QuickStudy Panel — {d.dateLong}</title>
</svelte:head>

<svelte:window onbeforeprint={openFolds} onafterprint={restoreFolds} />

<div class="page">
	<div class="masthead">
		<div class="over">Your Personal Morning Edition</div>
		<h1><a href="/">The Morning Edition</a></h1>
		<div class="under">the stories worth your attention today, compiled at 7:00 AM</div>
	</div>
	<div class="rail">
		<span>{d.dateLong}</span><span class="fl">❦</span>
		<span>† deep read ‡ brief ❦ captured ✳&#xFE0E; suggested</span><span class="fl">❦</span>
		{#if d.isDemo}<span>demo edition — mock data only</span>{/if}
	</div>

	<div class="panel-cap">QuickStudy panel — the same {d.itemCount} stories, condensed for a fast scan{d.markCount ? ` · ${d.markCount} of your highlights quoted below` : ''}</div>
	<div class="panel-grid">
		{#each d.topics as topic (topic.title)}
			<div class="topic-box">
				<h2>{topic.title}</h2>
				<ul>
					{#each topic.items as item, j (item.id)}
						<li
							use:impression={{
								item_id: item.id,
								item_url: item.url,
								source: item.source,
								edition_date: d.date,
								section: topic.key,
								tier: item.tier,
								position: j + 1
							}}
						>
							<span class="mk">{item.mark}</span>
							<a href={item.url}>{item.title}</a>
							<span class="src">{item.kind} · via {item.source}</span>
							{#if item.brief}
								<details class="fold">
									<summary><span class="fold-word"></span></summary>
									<p class="fold-body">{item.brief}</p>
								</details>
							{/if}
						</li>
					{/each}
				</ul>
				{#if d.marks.bySection[topic.key]?.length}
					<div class="marks">
						<h3>From your marks</h3>
						{#each d.marks.bySection[topic.key] as m (m.id)}
							<blockquote>
								<p class="mark-quote">&ldquo;{m.text}&rdquo;</p>
								{#if m.note}<p class="mark-note">your note: {m.note}</p>{/if}
								<a class="mark-src" href={m.url}>{m.title}</a>
							</blockquote>
						{/each}
					</div>
				{/if}
			</div>
		{/each}
		{#if d.marks.earlier.length}
			<div class="topic-box">
				<h2>From your marks — earlier</h2>
				<div class="marks">
					{#each d.marks.earlier as m (m.id)}
						<blockquote>
							<p class="mark-quote">&ldquo;{m.text}&rdquo;</p>
							{#if m.note}<p class="mark-note">your note: {m.note}</p>{/if}
							<a class="mark-src" href={m.url}>{m.title}</a>
						</blockquote>
					{/each}
				</div>
			</div>
		{/if}
	</div>

	<div class="toolbar screen-only">
		<a class="grade-link" href="/">← Broadsheet</a>
		<span class="fl">❦</span>
		<a class="grade-link" href="/grade">Grade this edition →</a>
	</div>

	<footer>— {d.itemCount} items · edition {d.date} · compiled by the 7 AM pipeline —</footer>
</div>
