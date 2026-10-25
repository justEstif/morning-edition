# The Morning Edition — builder

Turns an edition JSON into a static Victorian-broadsheet web page (pure black
& white, print-ready, no JS frameworks) plus a QuickStudy panel page and a
grading desk page — all three renders from the same edition JSON. Outputs:
`<out>/index.html`, `<out>/panel.html`, `<out>/grade.html`,
`<out>/assets/style.css`, `<out>/assets/feedback.js`.

## Build

```sh
python3 builder/build_edition.py data/demo/edition-demo.json docs/
```

The build is deterministic: the same JSON and templates always produce
byte-identical output.

## Public/demo-only constraint (binding)

This repository and its GitHub Pages site are **public**. `docs/` (the Pages
root) must contain **demo/mock data only** — never a real personal edition.
Real editions are built locally and served privately; never commit them here.

## Edition JSON

Canonical shape (see `data/demo/edition-demo.json`):

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
→ might-like; empty sections are omitted. The first `captured` item becomes the
lead feature; remaining captures fill the pinned Captured section. Marks are
typographic only: `†` deep read, `‡` brief, `❦` captured, `✳` suggested
(might-like items). `shadow_score` is engine metadata and is never rendered;
placement is never driven by it.

## The QuickStudy panel

`panel.html` is the second render of the same edition data: the identical
sections and dagger marks, condensed into bordered topic boxes for a fast
scan. The broadsheet's toolbar links to it (`QuickStudy panel →`) and the
panel links back (`← Broadsheet`) — one data model, two layouts, both built
by the same builder run.

## Feedback loop (v1, local-only)

Both pages write one append-only JSONL event stream to
`localStorage['me-feedback-events']` — one JSON object per line:

```json
{"ts": "ISO-8601", "type": "vote | grade", "value": "up | down | deep-read | skim | capture", "item_id": "miniflux-8123", "edition_date": "YYYY-MM-DD"}
```

- `type=vote`: inline like/dislike per item on the edition page (`up | down`).
- `type=grade`: one-tap verdicts on `grade.html` (`deep-read | skim | capture`),
  built from the same edition JSON so item ids always match.
- Duplicate events for the same item+type are allowed; the later timestamp wins
  at analysis time. Never dedupe client-side.
- No network calls: the "Export feedback" affordance (screen-only, both pages)
  downloads the stream as `me-feedback-YYYYMMDD.jsonl` — that file is the v1
  path into the future corrections API / recommend engine.

All feedback affordances are typographic, black & white, and hidden in
`@media print` (`.screen-only`), so the printed paper is unchanged.
