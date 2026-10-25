<script>
	import '../../app.css';

	let { data } = $props();
	const d = $derived(data);
</script>

<svelte:head>
	<title>The Morning Edition — QuickStudy Panel — {d.dateLong}</title>
</svelte:head>

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

	<div class="panel-cap">QuickStudy panel — the same {d.itemCount} stories, condensed for a fast scan</div>
	<div class="panel-grid">
		{#each d.topics as topic (topic.title)}
			<div class="topic-box">
				<h2>{topic.title}</h2>
				<ul>
					{#each topic.items as item (item.id)}
						<li>
							<span class="mk">{item.mark}</span>
							<a href={item.url}>{item.title}</a>
							<span class="src">{item.kind} · via {item.source}</span>
						</li>
					{/each}
				</ul>
			</div>
		{/each}
	</div>

	<div class="toolbar screen-only">
		<a class="grade-link" href="/">← Broadsheet</a>
		<span class="fl">❦</span>
		<a class="grade-link" href="/grade">Grade this edition →</a>
	</div>

	<footer>— {d.itemCount} items · edition {d.date} · compiled by the 7 AM pipeline —</footer>
</div>
