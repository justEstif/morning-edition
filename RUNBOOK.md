# RUNBOOK — repo-side ops

The daily build + deploy pipeline runbook is **local-only** (it touches real
editions and credentials) at `~/.hermes/morning-edition/RUNBOOK.md`. This file
covers the one thing that belongs in the public repo: how to film and share
the demo safely.

## Filming/sharing the demo

**The rule: never film the real edition.** The real app carries Estifanos's
actual reading history; anything on camera is the mock-only demo below. This
is the same binding constraint as the repo itself (demo data only, ever).

### 1. Regenerate the demo fixtures (optional, deterministic)

```sh
npx tsx scripts/make-demo-data.ts
```

Rewrites `data/demo/edition.json` (56 items, varied realistic titles, per-item
self-contained briefs, `has_reader` everywhere) and
`data/demo/reader-articles.json` (full mock article text for every item, so
each `/read/<id>` page has real prose). Seeded — re-runs are byte-identical.
Never hand-edit the fixtures; edit the generator.

### 2. Serve the demo locally (no `ME_DATA_DIR` → demo mode)

```sh
npm run build
PORT=3000 npm start        # node build — no ME_DATA_DIR set
```

With `ME_DATA_DIR` unset the app reads `data/demo/` and shows the
"demo edition — mock data only" rail. `/` and `/api/edition` are public;
the gated pages need a login (next step).

### 3. Demo login env (for filming `/grade`, `/panel`, `/admin`)

```sh
ME_ADMIN_USER=demo ME_ADMIN_PASS=<anything-you-choose> \
ME_SESSION_SECRET=<any 64-hex string> \
ORIGIN=http://localhost:3000 \
PORT=3000 node build
```

- `ORIGIN` is required: without it adapter-node's CSRF check rejects the
  login form POST with 403.
- These are local throwaway values — **never** the dokku credentials, and
  never a secret you use anywhere else.

### 4. CDP-frames capture recipe

Drive Chromium headfully with `--remote-debugging-port=9222` and capture over
the DevTools protocol:

- One frame per scroll step: navigate (`Page.navigate`), wait for load, then
  `Page.captureScreenshot` after each scroll/viewport change; name frames
  `frame_%04d.png`.
- Or continuous: `Page.startScreencast`, harvest `screencastFrame` events,
  `Page.screencastFrameAck` each one.
- Assemble: `ffmpeg -framerate 30 -i frame_%04d.png -c:v libx264 -pix_fmt yuv420p out.mp4`
- The Hermes browser tooling (`browser_exec`) does this directly — its
  `capture_screenshot` helper is a CDP screenshot per step, which is how the
  2026-10-25 demo video was shot.

### 5. Smoke check before recording

- `/` shows no `variant N` anywhere (a title artifact means the fixtures are
  stale — rerun step 1).
- Scrolling shows **different** briefs on every item.
- Click any headline → `/read/<id>` renders full article text.
- Browser console is clean.
- `npx tsx builder/verify_demo.ts` passes (it asserts all of the above
  against the committed fixtures).
