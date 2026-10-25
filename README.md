# The Morning Edition — builder

Turns an edition JSON into a static Victorian-broadsheet web page (pure black
& white, print-ready, no JS frameworks, no site JS).

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
