<script lang="ts">
	import { page } from '$app/state';
	import '../app.css';
</script>

<div class="page">
	<div class="masthead">
		<div class="over">Your Personal Morning Edition</div>
		<h1>{page.status}</h1>
		<div class="under">{page.error?.message ?? 'something went astray'}</div>
	</div>
	<div class="rail"><a href="/">← back to the latest edition</a></div>
</div>
