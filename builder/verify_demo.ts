/* Verify the demo (public) build: masthead, marks, sections, palette, grade
   page, panel — plus builder behavior probes (empty-section omission,
   brief-less rejection, demo brief quality).

   Port of builder/verify_demo.py. The two subprocess probes become in-process
   calls into builder/build_edition.ts (same assertions; the builder module is
   also exercised end-to-end by the CLI above the probes). */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "./build_edition.js";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));

/** string-array subset test (JS Sets have no issubset). */
function isSubset(sub: string[], sup: string[]): boolean {
  const supSet = new Set(sup);
  return sub.every((s) => supSet.has(s));
}
const DEMO_HOSTS = [
  "https://example.com",
  "https://fonts.googleapis.com",
  "https://fonts.gstatic.com",
];
const docs = readFileSync(join(REPO, "docs", "index.html"), "utf-8");
const css = readFileSync(join(REPO, "docs", "assets", "style.css"), "utf-8");

const checks: Array<[string, boolean, string]> = [];
function check(name: string, ok: boolean, detail = ""): void {
  checks.push([name, ok, detail]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}` + (detail ? `  [${detail}]` : ""));
}

check("masthead", docs.includes("The Morning Edition"));
check(
  "dagger legend",
  docs.includes("&#8224; deep read &#8225; brief &#10086; captured &#10033; suggested"),
);
const order = [...docs.matchAll(/<h2 class="col-h">([^<]+)/g)].map((m) => m[1]);
check(
  "section order",
  JSON.stringify(order) ===
    JSON.stringify([
      "Captured ",
      "Rust &amp; Operating Systems ",
      "AI at Work ",
      "Might Like &mdash; Outside Your Usual Topics ",
    ]),
  JSON.stringify(order),
);
const leadPos = docs.indexOf('class="lead"');
const secPos = docs.indexOf("<section>");
check("captured lead pinned first", 0 < leadPos && leadPos < secPos);
check("captured cap line", docs.includes("Captured &mdash; saved from your reading"));
check("print @media", css.includes("@media print"));
check("print @page", css.includes("@page"));
check("print 2-col", css.includes("grid-template-columns:repeat(2,1fr)"));
check("screen chrome hidden", css.includes(".screen-only { display:none"));
check("fonts CDN", docs.includes("IM+Fell+English") && docs.includes("Pirata+One"));
const colors = (
  [...new Set(css.match(/#[0-9a-fA-F]{3,6}|rgba?\([^)]*\)/g) ?? [])] as string[]
).sort();
check(
  "palette only",
  isSubset(colors, ["#141414", "#57534a", "#9a968c", "#fff", "#ffffff"]),
  JSON.stringify(colors),
);
check("fonts in CSS", css.includes("'IM Fell English'") && css.includes("'Pirata One'"));
const teaser = docs.match(/this article|this piece discusses|read more|continue reading/gi) ?? [];
check("no teaser phrasing", teaser.length === 0, JSON.stringify(teaser));
const hosts = [
  ...new Set((docs.match(/href="(https?:\/\/[^/"]+)/g) ?? []).map((m: string) => m.slice(6))),
].sort();
check("fake URLs only", isSubset(hosts, DEMO_HOSTS), JSON.stringify(hosts));
check("drop cap scoped to opener", css.includes(".item.drop-cap p:first-of-type::first-letter"));
check("builder parses", typeof build === "function");

// empty-section omission end-to-end (in-process; the Python port used a
// subprocess — same builder, same assertion)
const emptyEd = {
  edition_date: "2026-10-25",
  items: [
    {
      id: "readeck-1",
      section: "might-like",
      kind: "brief",
      title: "T",
      url: "https://example.com/t",
      source: "readeck",
      brief: "Self-contained summary. Second sentence.",
      shadow_score: 0.5,
    },
  ],
};
const tmpEmpty = join(REPO, "..", "tmp-me-empty.json");
const outEmpty = join(REPO, "..", "tmp-me-empty-out");
writeFileSync(tmpEmpty, JSON.stringify(emptyEd));
rmSync(outEmpty, { recursive: true, force: true });
mkdirSync(outEmpty, { recursive: true });
build(tmpEmpty, outEmpty);
const emptyHtml = readFileSync(join(outEmpty, "index.html"), "utf-8");
check("empty sections omitted", emptyHtml.includes("col-h") && !emptyHtml.includes("Rust"));

// schema validation rejects bad input
const bad = {
  edition_date: "2026-01-01",
  items: [
    {
      id: "x",
      section: "rust-os",
      kind: "brief",
      title: "T",
      url: "https://e.com",
      source: "miniflux",
    },
  ],
};
const tmpBad = join(REPO, "..", "tmp-me-bad.json");
writeFileSync(tmpBad, JSON.stringify(bad));
let rejected = false;
let rejectedMsg = "";
try {
  build(tmpBad, join(REPO, "..", "tmp-me-bad-out"));
} catch (exc) {
  rejected = true;
  rejectedMsg = exc instanceof Error ? exc.message : String(exc);
}
check(
  "rejects brief-less brief item",
  rejected && rejectedMsg.includes("requires a 'brief'"),
  rejectedMsg,
);

// briefs self-contained: each kind=brief item has >= 2 sentences
const data = JSON.parse(readFileSync(join(REPO, "data", "demo", "edition-demo.json"), "utf-8"));
const shortBriefs = data.items
  .filter(
    (i: { kind: string; brief?: string }) =>
      i.kind === "brief" && (i.brief ?? "").split(".").length < 3,
  )
  .map((i: { id: string }) => i.id);
check("briefs multi-sentence", shortBriefs.length === 0, JSON.stringify(shortBriefs));

// --- Card 2: feedback UI (inline votes + grade page) -------------------------
const grade = readFileSync(join(REPO, "docs", "grade.html"), "utf-8");
const fbJs = readFileSync(join(REPO, "docs", "assets", "feedback.js"), "utf-8");
const itemIds = data.items.map((i: { id: string }) => i.id);

check("grade page built", grade.includes("The Grading Desk"));
check(
  "grade rows match item ids",
  itemIds.every((id: string) => grade.includes(`data-item-id="${id}"`)),
);
check(
  "grade verdict buttons",
  (["deep-read", "skim", "capture"] as const).every((v) => grade.includes(`data-value="${v}"`)),
);
check(
  "inline votes on every item",
  docs.split('class="vote screen-only"').length - 1 === itemIds.length,
  String(docs.split('class="vote screen-only"').length - 1),
);
check("vote values", docs.includes('data-value="up"') && docs.includes('data-value="down"'));
check(
  "feedback.js shared",
  fbJs.includes("me-feedback-events") &&
    docs.includes("me-feedback-events") &&
    grade.includes("me-feedback-events"),
);
check(
  "export affordance",
  docs.includes('id="fb-export"') &&
    grade.includes('id="fb-export"') &&
    fbJs.includes("exportJSONL"),
);
check(
  "edition date on body",
  docs.includes(`data-edition-date="${data.edition_date}"`) &&
    grade.includes(`data-edition-date="${data.edition_date}"`),
);
check("no network calls", !fbJs.includes("fetch(") && !fbJs.includes("XMLHttpRequest"));
const gstyle: string =
  [...docs.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
    .map((m: RegExpMatchArray) => m[1])
    .join("") +
  " " +
  [...docs.matchAll(/style="([^"]*)"/g)].map((m: RegExpMatchArray) => m[1]).join(" ");
const gcolors = [
  ...new Set(gstyle.match(/#[0-9a-fA-F]{3,6}\b|rgba?\([^)]*\)/g) ?? []),
].sort() as string[];
check("grade page palette only", gcolors.length === 0, JSON.stringify(gcolors));
check(
  "grade hosts clean",
  isSubset(
    (grade.match(/href="(https?:\/\/[^/"]+)/g) ?? []).map((m: string) => m.slice(6)),
    DEMO_HOSTS,
  ),
);

// --- Card 1b: QuickStudy panel (panel.html) — same data model, second render -
const KIND_MARKS: Record<string, string> = {
  "deep-read": "&#8224;",
  brief: "&#8225;",
  captured: "&#10086;",
};
const panel = readFileSync(join(REPO, "docs", "panel.html"), "utf-8");
check("panel built", panel.includes("QuickStudy panel") && panel.includes("topic-box"));
check(
  "panel lists every item",
  data.items.every((i: { title: string }) => panel.includes(escTitle(i.title))),
);
check(
  "panel marks every item",
  data.items
    .filter((i: { section: string }) => i.section !== "might-like")
    .every((i: { kind: string }) => panel.includes(KIND_MARKS[i.kind])) &&
    panel.includes("&#10033;"),
);
check(
  "broad↔panel toggle",
  docs.includes('href="panel.html"') && panel.includes('href="index.html"'),
);
check(
  "panel hosts clean",
  isSubset(
    (panel.match(/href="(https?:\/\/[^/"]+)/g) ?? []).map((m: string) => m.slice(6)),
    DEMO_HOSTS,
  ),
);
const panelEmpty = readFileSync(join(outEmpty, "panel.html"), "utf-8");
check(
  "panel omits empty sections",
  !panelEmpty.includes("Rust") && panelEmpty.includes("Might Like"),
);

/** html.escape(title, quote=True) — matches the builder's esc(). */
function escTitle(title: string): string {
  return title
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#x27;");
}

const fails = checks.filter(([, ok]) => !ok);
console.log(`\n${checks.length - fails.length}/${checks.length} checks passed`);
rmSync(tmpEmpty, { force: true });
rmSync(tmpBad, { force: true });
rmSync(outEmpty, { recursive: true, force: true });
process.exit(fails.length > 0 ? 1 : 0);
