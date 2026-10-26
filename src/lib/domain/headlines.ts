/* Domain — the editorial headline pass (card t_21c0c195).
   Pure types + rules for co-written headlines: the LLM editorial step rewrites
   feed titles in house newspaper register, and the pipeline applies the result
   under a strict fallback rule (the feed title stands whenever extraction
   failed or a proposed rewrite fails the mechanical gates). Zero I/O, zero
   framework imports, zero node builtins (same architecture rule as edition.ts).

   The seed of the rule set is the t_e9c6b1cc cleanup (no raw URL as a
   headline): those heuristics become the FALLBACK path under this pass —
   a rewrite that is itself junk is rejected, and the feed title survives. */

/** Above this length a headline is sprawl (card t_21c0c195: "no colon-
 *  subtitle sprawl"; ~90 chars was the flag threshold decided on the card). */
export const MAX_HEADLINE_CHARS = 90;

/** A headline in house register runs 6–12 words; the mechanical gate allows
 *  a little slack on each side (4–18) so a tight rewrite isn't bounced. */
export const MIN_HEADLINE_WORDS = 4;
export const MAX_HEADLINE_WORDS = 18;

const URL_LIKE_RE = /^https?:\/\/\S+$/i;
const TRAILING_URL_RE = /\s+https?:\/\/\S+$/i;

export interface TitleVerdict {
  broken: boolean;
  reason?: string;
}

/** Heuristic flags for the broken-title shapes the editorial pass exists to
 *  fix: a raw URL, URL residue, sprawl past the length budget, ALL-CAPS
 *  shouting, or a "Site Name: Actual Title" feed prefix. Informational —
 *  under the co-writing policy EVERY title with extraction text is rewritten;
 *  the verdict labels the audit log and guards the fallback. */
export function inspectFeedTitle(title: string): TitleVerdict {
  const t = String(title ?? "").trim();
  if (!t) return { broken: true, reason: "empty title" };
  if (URL_LIKE_RE.test(t)) return { broken: true, reason: "raw URL as title" };
  if (TRAILING_URL_RE.test(t)) return { broken: true, reason: "trailing URL in title" };
  if (t.length > MAX_HEADLINE_CHARS)
    return { broken: true, reason: `too long (${t.length} > ${MAX_HEADLINE_CHARS} chars)` };
  const allCaps = allCapsReason(t);
  if (allCaps) return { broken: true, reason: allCaps };
  const prefix = sitePrefixReason(t);
  if (prefix) return { broken: true, reason: prefix };
  return { broken: false };
}

function allCapsReason(t: string): string | undefined {
  const letters = t.replace(/[^a-zA-Z]/g, "");
  // Acronyms ("RSS", "LLM") inside an otherwise normal title must not trip
  // the flag: require a decent amount of shouting before calling it ALL-CAPS.
  if (letters.length < 10) return undefined;
  const upper = letters.replace(/[^A-Z]/g, "").length;
  if (upper / letters.length >= 0.85 && t !== t.toLowerCase() && /\s/.test(t.trim()))
    return "ALL-CAPS title";
  return undefined;
}

function sitePrefixReason(t: string): string | undefined {
  // "Site Name: The Actual Headline" — the part before the first colon is a
  // short run of capitalized words. Legit subtitle colons survive: "Postgres
  // 18: the release notes" has a numeral word, "io_uring: where it breaks"
  // has a lowercase word — neither matches.
  const m = /^([^:]{1,40}):\s+\S/.exec(t);
  if (!m) return undefined;
  const words = m[1].trim().split(/\s+/);
  if (words.length > 4) return undefined;
  const allCapitalized = words.every((w) => /^[A-Z][\w'&.-]*$/.test(w));
  return allCapitalized ? `site-prefix title ("${m[1].trim()}")` : undefined;
}

export interface RewriteVerdict {
  ok: boolean;
  reason?: string;
}

/** The mechanical acceptance gate for a proposed rewritten headline. This is
 *  the "rewritten headline would disagree with the article" clause's mechanical
 *  half: junk rewrites are refused and the feed title stands (grounding itself
 *  is the prompt's contract, enforced only by the audit trail + review). */
export function acceptRewrittenHeadline(original: string, rewritten: string): RewriteVerdict {
  const t = String(rewritten ?? "").trim();
  if (!t) return { ok: false, reason: "empty rewrite" };
  if (t === String(original ?? "").trim())
    return { ok: false, reason: "rewrite echoes the feed title (no edit)" };
  const broken = inspectFeedTitle(t);
  if (broken.broken) return { ok: false, reason: `rewrite is broken: ${broken.reason}` };
  const words = t.split(/\s+/).length;
  if (words < MIN_HEADLINE_WORDS)
    return { ok: false, reason: `too short (${words} words; min ${MIN_HEADLINE_WORDS})` };
  if (words > MAX_HEADLINE_WORDS)
    return { ok: false, reason: `too long (${words} words; max ${MAX_HEADLINE_WORDS})` };
  return { ok: true };
}

/* --------------------------------------------------------------- overlap -- */

/** Words too common to count as "restating the headline". */
const STOPWORDS = new Set(
  (
    "a an and are as at be but by for from has have how in into is it its of on or " +
    "that the their there these this to was were what when where which why will " +
    "with you your can could should would new now"
  ).split(" "),
);

function significantWords(text: string): string[] {
  return String(text ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

/** True when the brief largely restates the headline instead of complementing
 *  it (card contract: "substance + takeaway, no wording overlap"). Measured as
 *  the share of the headline's significant words that also appear in the
 *  brief. Sharing the SUBJECT is inevitable and fine (a product story must
 *  name the product); restating means the brief carries essentially the whole
 *  headline — most of its content words (>= 75%, at least 4 of them) — and
 *  adds nothing. */
export function briefRestatesHeadline(headline: string, brief: string): boolean {
  const h = significantWords(headline);
  if (h.length < 3) return false; // too few content words to judge
  const b = new Set(significantWords(brief));
  const shared = h.filter((w) => b.has(w)).length;
  return shared >= 4 && shared / h.length >= 0.75;
}

/* ------------------------------------------------------------ application -- */

export interface EditorialItem {
  id: string;
  /** The title as classified (feed title, possibly with a registry
   *  continuation suffix) — what the paper would show without this pass. */
  title: string;
  /** Provenance/fallback: the raw feed title. Backfilled from `title` by the
   *  caller when the classification predates the field. */
  original_title?: string;
  /** True when extraction text existed for this item — the ONLY condition
   *  under which a rewrite may be applied (never rewrite from title alone). */
  hasText: boolean;
}

export interface EditorialDecision {
  /** Display uses the co-written headline. */
  applied: boolean;
  /** The title to render (rewritten headline, or the feed title untouched). */
  title: string;
  original_title: string;
  reason?: string;
  was_broken?: boolean;
}

/** Apply one editorial headline under the fallback rule: extraction text must
 *  exist, and the rewrite must pass the mechanical gate. Anything else keeps
 *  the feed title — loudly reported via `reason` so the build log is the audit
 *  trail's companion. */
export function applyEditorialTitle(
  item: EditorialItem,
  headline: string | undefined,
): EditorialDecision {
  const original_title = (item.original_title ?? "").trim() || item.title.trim();
  const verdict = inspectFeedTitle(item.title);
  if (!item.hasText)
    return {
      applied: false,
      title: item.title,
      original_title,
      reason:
        item.hasText === false && headline
          ? "no extraction text (never rewrite from title alone)"
          : "no extraction text",
      was_broken: verdict.broken,
    };
  if (!headline || !String(headline).trim())
    return { applied: false, title: item.title, original_title, was_broken: verdict.broken };
  const gate = acceptRewrittenHeadline(item.title, headline);
  if (!gate.ok)
    return {
      applied: false,
      title: item.title,
      original_title,
      reason: `rewrite rejected: ${gate.reason}`,
      was_broken: verdict.broken,
    };
  return {
    applied: true,
    title: String(headline).trim(),
    original_title,
    was_broken: verdict.broken,
  };
}
