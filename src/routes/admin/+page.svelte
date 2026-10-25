<script lang="ts">
  import '../../app.css';
  import './admin.css';
  import type { ActionData, PageData } from './$types.js';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  /** One row's descriptive tail — value/reason for verdicts, url for
   *  clicks, dwell/progress for the implicit signals. Read structurally so
   *  event types the schema doesn't model yet still render. */
  function detail(ev: PageData['recent'][number]): string {
    const r = ev as PageData['recent'][number] & Record<string, unknown>;
    const parts: string[] = [];
    if (typeof r.value === 'string') parts.push(r.value);
    if (typeof r.reason === 'string') parts.push('· ' + r.reason);
    if (typeof r.url === 'string') parts.push(r.url);
    if (typeof r.dwell_ms === 'number') parts.push(Math.round(r.dwell_ms / 1000) + 's dwell');
    if (typeof r.progress_pct === 'number') parts.push(r.progress_pct + '%');
    if (typeof r.flip_ms === 'number') parts.push('flip ' + r.flip_ms + 'ms');
    if (typeof r.session_id === 'string') parts.push(r.session_id);
    return parts.join(' ');
  }

  function when(ts: string): string {
    return typeof ts === 'string' ? ts.slice(0, 16).replace('T', ' ') : '';
  }

  function sectionTitle(key: string): string {
    return data.sectionTitles[key] ?? key;
  }

  function pct(n: number | null): string {
    return n === null ? '—' : (100 * n).toFixed(1) + '%';
  }

  const newestFirst = $derived([...data.availableDates].reverse());
  const statusLine = $derived(
    data.health.servedDate === null
      ? 'nothing valid is served'
      : data.health.behindNewest
        ? `serving ${data.health.servedDate} — ${data.health.newestDate} is on disk but not served (restore below)`
        : `serving the newest edition (${data.health.servedDate})`
  );
</script>

<svelte:head>
  <title>Back Office — The Morning Edition</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="page">
  <div class="masthead">
    <div class="over">The Morning Edition — Back Office</div>
    <h1>The Back Office</h1>
    <p class="under">health · ledger · restore · quarantine · read-stats{data.isDemo ? ' · DEMO DATA' : ''}</p>
  </div>

  <div class="rail">
    <a href="/">the paper</a> <span class="fl">❦</span>
    <a href="/grade">grading desk</a> <span class="fl">❦</span>
    <a href="/panel">study panel</a> <span class="fl">❦</span>
    <form method="POST" action="/logout" class="inline"><button class="tool-btn" type="submit">sign out</button></form>
  </div>

  {#if form?.error}
    <p class="notice err" role="alert">† {form.error}</p>
  {:else if form?.ok}
    <p class="notice">❦ {form.message}</p>
  {/if}

  <!-- ============ Press health ============ -->
  <section>
    <h2 class="col-h">Press Health <small>what is served vs what exists</small></h2>
    <div class="statgrid">
      <div class="topic-box">
        <h2>Served</h2>
        <p class="big">{data.health.servedDate ?? '—'}</p>
        <p class="src">the file readers actually get</p>
      </div>
      <div class="topic-box">
        <h2>Newest on disk</h2>
        <p class="big">{data.health.newestDate ?? '—'}</p>
        <p class="src">{data.availableDates.length} edition{data.availableDates.length === 1 ? '' : 's'} available</p>
      </div>
      <div class="topic-box">
        <h2>Verdict</h2>
        <p class="big {data.health.behindNewest || (data.health.daysBehindToday ?? 0) > 1 ? 'warn' : ''}">
          {data.health.behindNewest ? 'behind' : (data.health.daysBehindToday ?? 0) > 1 ? 'stale' : 'current'}
        </p>
        <p class="src">
          {statusLine}{data.health.daysBehindToday !== null && data.health.daysBehindToday > 0
            ? ` · builder last ran ${data.health.daysBehindToday}d ago`
            : ''}
        </p>
      </div>
    </div>

    <div class="admin-col">
      <h3 class="sub-h">Restore a previous edition</h3>
      <p class="fine">
        copies editions/&lt;date&gt;/edition.json over the served file — verbatim, atomic; the builder stays the
        source of truth. Re-run the deploy pipeline (<code>deploy_edition.sh</code>) to publish a fresh build
        instead.
      </p>
      <form class="restore" method="POST" action="?/restore">
        <select name="date">
          {#each newestFirst as d (d)}
            <option value={d}>{d}</option>
          {/each}
        </select>
        <label class="confirm">
          <input type="checkbox" name="confirm" value="yes" required />
          <span>confirm the overwrite</span>
        </label>
        <button class="tool-btn strong" type="submit">restore as served</button>
      </form>
    </div>
  </section>

  <!-- ============ Ledger ============ -->
  <section>
    <h2 class="col-h">The Ledger <small>{data.counts.total} events</small></h2>
    <div class="admin-col">
      <p class="fine">
        by type:
        {#each Object.entries(data.counts.byType) as [t, n], i (t)}
          {i > 0 ? ' · ' : ''}<b>{t}</b> {n}
        {/each}
        {#if data.counts.total === 0}— the book is blank{/if}
      </p>
      <p class="fine">
        by edition:
        {#each Object.entries(data.counts.byEdition).sort((a, b) => b[0].localeCompare(a[0])) as [d, n], i (d)}
          {i > 0 ? ' · ' : ''}<b>{d}</b> {n}
        {/each}
      </p>
      <h3 class="sub-h">Recent events — last {data.recentTotal}</h3>
      <div class="ledger">
        {#each data.recent as ev, i (i)}
          <div class="lrow">
            <span class="lwhen">{when(ev.ts)}</span>
            <span class="ltype">{ev.type}</span>
            <span class="litem">{ev.item_id}</span>
            <span class="led">{ev.edition_date}</span>
            <span class="ldetail">{detail(ev)}</span>
          </div>
        {:else}
          <p class="fine">no events yet</p>
        {/each}
      </div>
      <h3 class="sub-h">Rejections — write-time, never in the ledger</h3>
      <div class="ledger">
        {#each data.rejections as r, i (i)}
          <div class="lrow rej">
            <span class="lwhen">{when(r.ts)}</span>
            <span class="ltype">{r.type ?? '?'}</span>
            <span class="ldetail">{r.reason}</span>
          </div>
        {:else}
          <p class="fine">nothing rejected</p>
        {/each}
      </div>
    </div>
  </section>

  <!-- ============ Quarantine ============ -->
  <section>
    <h2 class="col-h">Quarantine <small>rows held out of every read</small></h2>
    <div class="admin-col">
      <p class="fine">
        re-instate = append the row to the ledger (fresh id/ts — the ledger is append-only and is never rewritten),
        then drop it from the pen. discard = drop from the pen; the ledger is untouched.
      </p>
      <div class="ledger">
        {#each data.quarantined as row, i (i)}
          <div class="lrow qrow">
            <span class="lwhen">{when(row.ts)}</span>
            <span class="ltype">{row.type}</span>
            <span class="litem">{row.item_id}</span>
            <span class="ldetail">{detail(row)}</span>
            <span class="lacts">
              <form method="POST" action="?/reinstate" class="inline">
                <input type="hidden" name="token" value="q{i}" />
                <button class="tool-btn" type="submit">re-instate</button>
              </form>
              <span class="fl">·</span>
              <form method="POST" action="?/discard" class="inline">
                <input type="hidden" name="token" value="q{i}" />
                <button class="tool-btn" type="submit">discard</button>
              </form>
            </span>
          </div>
        {:else}
          <p class="fine">the pen is empty</p>
        {/each}
      </div>
    </div>
  </section>

  <!-- ============ Read-stats (shadow-mode audit) ============ -->
  <section>
    <h2 class="col-h">
      Read-Stats <small>the shadow-mode audit — impressions, click-through, dwell, explore slots</small>
    </h2>
    <div class="admin-col">
      <p class="fine">
        totals:
        {#each Object.entries(data.stats.totals) as [t, n], i (t)}
          {i > 0 ? ' · ' : ''}<b>{t}</b> {n}
        {/each}
        {#if Object.keys(data.stats.totals).length === 0}— no signals yet{/if}
      </p>
      <div class="ledger">
        <div class="lrow head">
          <span class="litem">section</span>
          <span class="ltype">impressions</span>
          <span class="ltype">clicks</span>
          <span class="ltype">CTR</span>
          <span class="ltype">verdicts</span>
          <span class="ltype">explore imp/clicks</span>
        </div>
        {#each data.stats.perSection as s (s.section)}
          <div class="lrow">
            <span class="litem">{sectionTitle(s.section)}</span>
            <span class="ltype">{s.impressions ?? '—'}</span>
            <span class="ltype">{s.clicks}</span>
            <span class="ltype">{pct(s.ctr)}</span>
            <span class="ltype">{s.verdicts}</span>
            <span class="ltype">{s.exploreImpressions}/{s.exploreClicks}</span>
          </div>
        {:else}
          <p class="fine">no exposure data yet</p>
        {/each}
      </div>
      {#if !data.stats.hasImpressionData}
        <p class="fine italic">
          CTR denominators wait for real impression events — nothing is guessed here.
        </p>
      {/if}
      <p class="fine">
        dwell (open→return):
        {data.stats.dwellBuckets.b0_30s} &lt;30s · {data.stats.dwellBuckets.b30s_2m} 30s–2m ·
        {data.stats.dwellBuckets.b2m_10m} 2–10m · {data.stats.dwellBuckets.b10m_30m} 10–30m
      </p>
      {#if data.stats.topItems.length > 0}
        <p class="fine">
          most clicked:
          {#each data.stats.topItems as it, i (it.itemId)}
            {i > 0 ? ' · ' : ''}{it.itemId} ({it.clicks})
          {/each}
        </p>
      {/if}
    </div>
  </section>

  <footer>
    {#if data.isDemo}demo data — set ME_DATA_DIR on the server for the real volume · {/if}printed by the back
    office · B&W
  </footer>
</div>
