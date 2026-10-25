<script lang="ts">
  import '../../app.css';
  import './login.css';
  import type { ActionData, PageData } from './$types.js';

  let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head>
  <title>Sign In — The Morning Edition</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="page">
  <div class="masthead">
    <div class="over">The Morning Edition — Private Door</div>
    <h1>Sign In</h1>
    <p class="under">
      the grading desk, the study panel, and the back office sit behind this door —
      the paper itself stays open at <a href="/">the front page</a>
    </p>
  </div>

  <form class="login" method="POST">
    <input type="hidden" name="next" value={data.next} />
    <label class="fld">
      <span>Name</span>
      <input name="user" autocomplete="username" required />
    </label>
    <label class="fld">
      <span>Password</span>
      <input name="pass" type="password" autocomplete="current-password" required />
    </label>
    {#if form?.error}
      <p class="login-err" role="alert">{form.error}</p>
    {/if}
    <button class="login-btn" type="submit" disabled={!data.configured}>Enter&nbsp;❦</button>
    {#if !data.configured}
      <p class="login-note">
        no lock is configured on this server — set ME_ADMIN_USER / ME_ADMIN_PASS first
      </p>
    {/if}
  </form>

  <footer>B&W · IM Fell · printed nightly · the private door keeps the desk and the marks yours</footer>
</div>
