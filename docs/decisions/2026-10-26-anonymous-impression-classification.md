# Decision: anonymous impressions are CLASSIFY-AND-IGNORE (owner-only ledger)

Date: 2026-10-26 · Card: t_e86490c0 · Consumed by: the ranker (t_072d6c12)

## The question

Reading is public (t_43e48cd0): anonymous visitors can open /read/<id>. When a
stranger reads the paper, what happens to the impression their visit would
produce? Two candidate policies:

1. **classify-and-ignore** — the session gate classifies every request
   (owner vs anonymous); anonymous requests are refused at every write path
   and nothing is ledgered. No anon rows exist, ever.
2. **tag-and-downweight** — anon impressions are written with a tag
   (`audience: "anon"`); consumers (the ranker) down-weight or ignore them.

## Decision: classify-and-ignore

The ledger exists to capture **Estifanos's** reader signal. An anonymous
impression is a stranger's signal — not evidence about what the paper should
show *him*. Storing tagged rows would keep pollution one dropped filter away
from every downstream consumer; refusing at the gate keeps exactly one
enforcement point and a ledger that is owner-signal by construction.

This is already how the app behaves since t_43e48cd0 (the client opts out for
anon, and /api/impressions + /api/corrections are session-gated); this card
makes it the *written, binding* rule and gives the ranker a defensive filter.

## The additive schema hook: `audience`

Every ledger event may carry an optional, additive envelope field:

    "audience": "owner" | "anon"

- The server stamps `audience: "owner"` on everything it appends today
  (write-time, in the store adapter — the domain type stays optional so old
  rows, which are implicitly owner rows, read unchanged).
- The ranker's ledger read **ignores any row whose `audience` is present and
  is not `"owner"`** (builder/ranker-store.ts readLedger). Old rows without
  the field still count — they predate strangers being possible.
- Anonymous writes are refused, so no `"anon"` row is ever written today. The
  enum exists so the flip to friends-reads-the-site (tag-and-downweight) only
  touches the gate and the stamp — never the schema, never the readers.

## What the ranker does with this

Nothing extra today: there are no anon rows to ignore. The filter in
readLedger() is the standing guarantee — if an anon-class row ever lands in
the ledger (future policy change, manual import, bug), the ranker skips it
instead of weighing a stranger's reading as Estifanos's.

## Review trigger

If accounts beyond the owner ever exist (friends reading with their own
sessions), revisit: that is the tag-and-downweight world, and this decision
document is the place to record the flip.
