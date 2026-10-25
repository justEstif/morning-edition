# The Morning Edition

A daily generated broadsheet: the Python builder turns an edition JSON into
edition data; the SvelteKit app renders it (001e borderless-grid design) and
collects feedback server-side. Deployed **privately** on dokku — real editions
are never publicly reachable.

```
Python builder (source of truth)   →  edition JSON  →  SvelteKit app (render + deliver)
~/.hermes/morning-edition/ pipeline                   this repo, adapter-node on dokku
```

## Layout

- `builder/` — Python builder + demo verifier (`verify_demo.py`). The builder
  is deterministic; it is the only writer of edition JSON. It still outputs
  the static demo (`docs/`): `index.html`, `panel.html`, `grade.html`,
  `assets/style.css`, `assets/feedback.js`.
- `data/demo/edition-demo.json` — **demo/mock data only.** This repo is
  public; the binding constraint is: demo data here, real data only on the
  private dokku app's volume. Never commit a real edition or any credential.
- `docs/` — the old static Pages demo, kept for reference (localStorage-only
  feedback, marked "demo edition"). **GitHub Pages is retired** (disabled
  2026-10-24); the site now lives on dokku (below).
- `src/` — the SvelteKit app (adapter-node):
  - `/` — the edition, 001e borderless full-bleed 12-column grid
    (sections `grid-template-columns: subgrid`, items `grid-template-rows:
    subgrid` so titles/bodies/marks align across columns). B&W only,
    IM Fell English/SC + Pirata One, drop caps, dagger marks
    († deep read · ‡ brief · ❦ captured · ✳ suggested).
  - `/panel` — QuickStudy panel: the same data, condensed topic boxes.
  - `/grade` — the grading desk: one pass, one verdict per item
    (`deep-read | skim | drop`; a Readeck save is the capture signal, so there
    is no `capture` grade and no second vote pass). Optional one-tap reason
    chips on any verdict: `wrong-angle | already-read | wrong-source | dup |
    low-quality`. A re-tap within the session SUPERSEDES the earlier event
    (`supersedes: <event id>`) — it never contradicts.
  - `POST /api/corrections` — append one feedback event to the server-side
    JSONL ledger (restart-safe: the file lives on the host volume). `ts` and
    `id` are stamped by the server. Schema v2 events carry the shared
    envelope `id, ts, schema_v:2, session_id, item_id, item_url, source,
    edition_date` plus a type payload:
    `verdict` (`value: deep-read|skim|drop`, optional `reason`, optional
    `supersedes`, server-stamped `flip_ms` when it lands <2s after the
    previous verdict in the same session — bursts are down-weighted at
    analysis time, never last-write-wins), `click` (`url`; the edition page
    posts these on click-through). Implicit signals (`read_progress`,
    `star`, `capture`, `highlight` — the last synced one-per-annotation
    from Readeck with `annotation_id`/`text`/`note`/`created`, joined by
    readeck item id) are synced in by the pipeline; `skip` is derived
    downstream and never stored. The human-facing API accepts only
    `verdict|click`; implicit types ride the trusted sync path. Legacy v1
    bodies (`{"type":"vote|grade","value":"up|down|deep-read|skim|capture",...}`)
    are still accepted and stay readable via `schema_v`.
    A v2 event whose `item_id` is absent from its `edition_date`'s edition is
    rejected (400) and logged to `rejections.jsonl` — test/typo rows never
    reach the ledger.
  - `GET /api/corrections?date=` — ledger count + latest value per item
    (verdict/reason/ev; legacy vote/grade rows remain readable).
  - `GET /api/edition?date=YYYY-MM-DD` — raw edition JSON (default: latest).
- `scripts/import-votes.mjs` — migrate the old localStorage export from the
  retired Pages demo (export it from the demo grade page first):
  `npm run import-votes -- me-feedback-20261025.jsonl --url <app-url> --auth user:pass`

## Edition JSON (canonical shape)

See `data/demo/edition-demo.json`:

```json
{
  "edition_date": "YYYY-MM-DD",
  "items": [
    {
      "id": "miniflux-8123 | readeck-<id>",
      "section": "captured | rust-os | ai-at-work | might-like",
      "kind": "deep-read | brief | captured",
      "title": "...",
      "url": "https://...",
      "source": "miniflux | readeck",
      "brief": "2-3 self-contained sentences; REQUIRED when kind=brief, must NOT be a teaser",
      "captured_at": "ISO-8601, captured items only",
      "shadow_score": 0.0
    }
  ]
}
```

Rendering rules: sections render in the order captured → rust-os → ai-at-work
→ might-like; empty sections are omitted. The first captured item is the lead
feature; the second fills the "Also captured" well; the rest fill the Captured
section. Marks are typographic only: `†` deep read, `‡` brief, `❦` captured,
`✳` suggested (might-like items). `shadow_score` is engine metadata and is
never rendered; placement is never driven by it.

Folds: on screen each item's brief sits behind a typographic fold (a ❧ fleuron
+ small-caps "unfold the brief", `<details>`-based, no UI chrome); the /panel
topic boxes fold the same briefs, and /grade prints briefs inline unfolded so
a verdict never costs a tap. Items without a brief render headline-only (the
layout's subgrid keeps marks baseline-aligned). Print always unfolds: a
beforeprint handler opens every fold and a `::details-content` print rule
covers engines where the event doesn't fire — the paper never prints a closed
fold. The 2-3-sentence brief contract above is the length budget; briefs are
not truncated in the UI.

## Data directory (env `ME_DATA_DIR`)

The app reads everything from one directory (`ME_DATA_DIR`, default
`data/demo` = demo mode; the rail then says "demo edition — mock data only"):

```
$ME_DATA_DIR/
  edition.json                        # latest edition (no ?date= reads this)
  editions/<YYYY-MM-DD>/edition.json  # dated editions (?date=... reads these)
  corrections.jsonl                   # append-only feedback ledger (server-writable)
  rejections.jsonl                    # write-time referential rejections
  corrections-quarantine.jsonl        # quarantined rows; excluded from all reads
```

On the dokku app, `ME_DATA_DIR=/data` with a host volume mount; the daily
build rsyncs new edition JSON into it. The app never writes edition JSON.

## Build & run

```sh
npm ci
npm run build        # vite build + adapter-node
PORT=3000 npm start  # node build
```

Docker (what dokku builds): pinned `node:22-bookworm-slim`, `npm ci`,
`npm run build`, `CMD ["node","build"]`.

Static demo rebuild (unchanged, deterministic):

```sh
python3 builder/build_edition.py data/demo/edition-demo.json docs/
```

## Private dokku deploy (contabo)

```sh
# one-time server setup (ssh contabo)
dokku apps:create morning-edition
dokku git:set morning-edition deploy-branch main
mkdir -p /var/lib/morning-edition/editions
dokku storage:add morning-edition /var/lib/morning-edition:/data
dokku config:set morning-edition ME_DATA_DIR=/data ORIGIN=https://morning-edition.estifanos.cc
dokku domains:add morning-edition morning-edition.estifanos.cc
dokku letsencrypt:enable morning-edition
# private: nginx-level basic auth (credentials generated out-of-band, NEVER committed)
dokku http-auth:add morning-edition <user> <password>
dokku ps:scale morning-edition web=1

# deploy (from the repo)
git remote add dokku dokku@contabo:morning-edition   # one-time
git push dokku main

# POST-DEPLOY AUTH ASSERTION (run after EVERY deploy — see incident note below)
for p in / /grade /api/corrections; do
  code=$(curl -s -o /dev/null -w '%{http_code}' -A 'Mozilla/5.0' "https://morning-edition.estifanos.cc$p")
  [ "$code" = "401" ] || { echo "AUTH DOWN: $p returned $code"; exit 1; }
done
echo "auth OK: 401 without credentials on all routes"

# daily edition refresh (run by the 7am ET Hermes cron; no manual steps)
rsync -a ~/.hermes/morning-edition/editions/<today>/edition.json \
  contabo:/var/lib/morning-edition/editions/<today>/edition.json
rsync -a ~/.hermes/morning-edition/editions/<today>/edition.json \
  contabo:/var/lib/morning-edition/edition.json
```

The daily build pipeline itself is documented in
`~/.hermes/morning-edition/RUNBOOK.md` (local-only; not in this repo).

**Auth incident note (2026-10-25).** Dokku's `http-auth` plugin stores its
enabled state as a single file, `<app>/nginx.conf.d/http-auth.conf` (the
report derives "enabled" from that file's existence; `htpasswd` holds the
users). That file was found deleted on 2026-10-25 (deletion window:
05:19 CET, ~20 minutes after the previous night's deploy session ended; no
dokku event or command log records the deletion — most likely a stray
cleanup command from that session). The result was a fully public site with
no credentials required, caught by review the same day. Restoring is one
command — the users in `htpasswd` are untouched by a disable:

```sh
ssh contabo 'APP_ROOT=/home/dokku/morning-edition; \
  sigil -f /var/lib/dokku/plugins/available/http-auth/templates/http-auth.conf \
  APP_ROOT=$APP_ROOT ALLOWED_IPS="" HAS_ALLOWED_USERS=true | cat -s \
  > $APP_ROOT/nginx.conf.d/http-auth.conf && nginx -s reload'
```

Deploys do NOT clear auth (`nginx.conf` includes `nginx.conf.d/*.conf`),
but run the POST-DEPLOY AUTH ASSERTION above after every deploy anyway — a
silent disable must not recur undetected.

## Demo verifier / CI

`python3 builder/verify_demo.py` — acceptance checks over the committed demo
edition (CI runs it, rebuilds `docs/`, and fails if `docs/` is stale). CI also
builds the SvelteKit app (`npm ci && npm run build`) so the node side cannot
silently rot.
