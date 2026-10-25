<script lang="ts">
	/* The night-edition toggle (card t_bc1e3666): a typographic text control,
	   not UI chrome — same language as the verdict buttons (real <button>,
	   small-caps, fleuron mark). State lives on <html data-theme>, set before
	   first paint by the inline script in app.html; a manual choice persists
	   in localStorage ("me-theme"), no choice follows prefers-color-scheme. */
	let dark = $state(false);

	$effect(() => {
		dark = document.documentElement.dataset.theme === 'dark';
		/* No manual choice yet → keep following the system when it changes
		   mid-visit. A stored choice wins forever until cleared manually. */
		const mq = window.matchMedia('(prefers-color-scheme: dark)');
		const followSystem = (e: MediaQueryListEvent) => {
			try {
				if (localStorage.getItem('me-theme')) return;
			} catch {
				/* storage unavailable — follow the system */
			}
			dark = e.matches;
			if (e.matches) document.documentElement.setAttribute('data-theme', 'dark');
			else document.documentElement.removeAttribute('data-theme');
		};
		mq.addEventListener('change', followSystem);
		return () => mq.removeEventListener('change', followSystem);
	});

	function flip() {
		dark = !dark;
		if (dark) document.documentElement.setAttribute('data-theme', 'dark');
		else document.documentElement.removeAttribute('data-theme');
		try {
			localStorage.setItem('me-theme', dark ? 'dark' : 'light');
		} catch {
			/* storage unavailable — the choice just doesn't persist */
		}
	}
</script>

<button
	class="tool-btn night-toggle"
	type="button"
	aria-pressed={dark}
	title={dark ? 'switch to the day edition' : 'switch to the night edition'}
	onclick={flip}
>
	<span class="fl" aria-hidden="true">{dark ? '✶&#xFE0E;' : '☾'}</span>&nbsp;{dark ? 'day' : 'night'}
</button>
