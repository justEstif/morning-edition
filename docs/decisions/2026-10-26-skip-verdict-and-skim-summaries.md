# Decision: the `skip` verdict (explicit not-interested) + inline skim summaries on the QuickStudy panel

Date: 2026-10-26 · Card: t_1e178af7 · Feeds: the recommendations loop (t_b45f60dc)

## Part 1 — the `skip` verdict

### The question

The grading desk had three verdicts — `deep-read | skim | drop` — none of
which says "I am not interested in this *subject*". `drop` reads as an
item-level call ("this piece wasn't worth it", topic-neutral); nothing told
the pipeline to stop surfacing a topic or source. The RegretsReporter RCT
(t_54dfda6e) is blunt about the failure mode: single-button negatives change
~11–12% of recommendations because they cannot say *why* or *at what scope*.

### Decision

A fourth verdict, value **`skip`**, rendered on the desk as **"not
interested"**:

- **Semantics** — the strongest explicit negative the reader can give.
  It scopes PAST the item: "don't show me this topic/source again".
  `drop` keeps its existing item-level meaning; `skip` is the
  topic/source-level call. Signal ordering for the loop:
  `deep-read (+1.0) > capture (0.6) > skim (−0.4) > drop (−0.7) > skip (−1.0)`.
- **Reason chips attach to it** — the existing chips
  (`wrong-angle | already-read | wrong-source | dup | low-quality`) already
  render for every verdict, so a skip can carry its cause. `wrong-source` on
  a skip is the source-scoped negative; `dup`/`already-read` are
  evidence the *curation* was right and the item redundant.
- **Naming, and the one trap** — the ledger already had a `skip` EVENT TYPE
  (the derived implicit negative: ≥2 editions presented + real exposure +
  zero engagement, sync-path only, research R5). The new verdict is a
  different lane and never collides byte-wise: explicit =
  `{"type":"verdict","value":"skip",...}`, derived =
  `{"type":"skip","origin":"derived",...}`. Consumers dispatch on
  `(type, value)`, never on the word alone. This document is the warning.

### Where it lands

| Surface | Change |
| --- | --- |
| `/grade` desk | 4th button "not interested"; reason chips as for any verdict |
| Ledger | v2 verdict events with `value:"skip"`, envelope + `supersedes` + `flip_ms` exactly as other verdicts; `/api/corrections` accepts it (validator union extended) |
| Ranker (`signalValue`) | skip = **−1.0** — strongest typed signal; flows through the usual per-topic/per-source multipliers (`clamp(exp(0.1·Σ value·burst·decay), 0.5, 2.0)`), so repeated skips on a topic/source demote it toward the 0.5 floor |
| Promotion gate | skip verdicts count as verdicts-in-window; for agreement they sit in the **drop bucket** (a skip agrees with the engine's `drop` suggestion) |
| Derived `skip` events | unchanged — still derived, sync-path only, low-confidence |

### Integration points for the recommendations loop (t_b45f60dc) — NOT implemented here

This card defines and stores the negative signal; the suppression loop itself
is t_b45f60dc's. The hooks, in the order they should consume skips:

1. **Ranker demotion (live today)** — skip already demotes via the multiplier
   above. No loop needed for the soft version.
2. **Builder classifier suppression** — `make_edition.ts classify` should
   read a suppression ledger (topics/sources with recent skip+`wrong-source`
   or skip+`wrong-angle` events) and drop or demote candidates before
   section assignment. Natural home: extend the story registry's
   `negative_signal` flag to fold in explicit skips (today it only flags
   zero-engagement stories).
3. **Rubric / embedding centroids** — the shadow harness
   (`~/.hermes/feedback-loop/`, read-only ledger rsync from
   `contabo:/var/lib/morning-edition/`) should feed skip(+reason) rows as
   negative examples: per-source multipliers get a stronger prior;
   embedding centroids get skip items as negatives (the sync harness's
   SkipEvent is low-confidence and must NOT be pooled with explicit skips —
   weight them separately, see the confidence note in feedback.ts).
4. **Time-boxed pause (future)** — a "pause this topic for a week" affordance
   would store as a skip with a scoped TTL; reserved, not built.

## Part 2 — skim summaries on the QuickStudy panel

### The question

Panel items without briefs render as title-only outbound links. The reading
triage already writes AI summaries for skimmed URLs — they live in
`~/.hermes/reading-triage/archive.json` (and the Skim Digest RSS). Where
should the panel get them: serve-time merge with the archive, or build-time
merge into edition.json?

### Decision: build-time merge — edition.json is the only source

`make_edition.ts build` reads `archive.json` (env override
`ME_ARCHIVE_JSON`; default `~/.hermes/reading-triage/archive.json`), matches
entries to items by **normalized URL** (`normalizeUrl`, the same rule the
registry uses), and stamps the summary on the item as an additive
`skim_summary` string before writing edition.json.

Rationale:

- **The panel stays self-contained** — it reads one edition.json, like `/`
  and `/grade`. No serve-time cross-store read, no second file to rsync to
  contabo, no app-side archive dependency.
- **Precedent** — briefs.json and headlines.json already merge at build time
  by item id; the archive merge is the same pattern keyed by URL (the triage
  lane and the paper do not share id spaces).
- **archive.json is consumed as-is** — the triage pipeline, Readeck, and the
  feed are never touched (explicitly out of scope).
- Absent/corrupt archive → **no merge, loudly logged, never a build
  failure** (the paper cannot depend on the triage lane's health).

### Rendering rule

On `/panel`, an item shows its skim summary **only when it has no brief**:
brief-less items (deep-read teasers, captures) were exactly the title-only
outbound links; items with a brief keep the brief, which was co-written for
the paper and already passes the teaser/length gates. The summary renders in
the same register as a fold-body (agate label "skim summary", bullet lines
preserved), so the piece reads without clicking out.

`parseEditionItem` accepts `skim_summary` as an optional string (additive;
old editions parse unchanged).

## Verification (2026-10-26)

- `npm run check`, `npm test` (vitest, incl. new skip/skim cases), production
  build + local run against the real editions; skip verdict POSTed to a
  scratch ledger and read back through `/api/corrections`.
- Builder rebuild of the live edition: skim summaries matched and stamped
  (logged count), `verify_pipeline.ts` all green.
