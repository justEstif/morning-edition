#!/usr/bin/env -S ../node_modules/.bin/tsx
/* Build a Morning Edition broadsheet page from an edition JSON.

   Usage:
       tsx builder/build_edition.ts <edition.json> <output_dir>

   Reads templates/broadsheet.html, templates/panel.html and templates/broadsheet.css
   (found relative to the repository root) and writes <output_dir>/index.html,
   <output_dir>/panel.html, <output_dir>/grade.html plus assets/style.css and
   assets/feedback.js.
   The output is a pure function of the edition JSON and the templates — no
   timestamps, no randomness — so rebuilding the same edition is deterministic.

   EDITION JSON IS PUBLIC INPUT HERE: anything committed under data/demo/ and
   built into docs/ must be MOCK DATA ONLY. Never build a real personal edition
   into docs/ — that output ships to the public GitHub Pages site.

   Port of builder/build_edition.py (byte-shape parity of the HTML), with one
   declared tightening: the edition JSON is validated against the app's domain
   schema (src/lib/domain/edition.ts parseEdition) before rendering — a
   malformed edition now fails loudly here instead of rendering garbage. */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { longDate, parseEdition } from "../src/lib/domain/edition.js";

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url))); // …/morning-edition/repo
const TEMPLATES_DIR = join(REPO_ROOT, "templates");

const SECTION_ORDER = ["captured", "rust-os", "ai-at-work", "might-like"];
const SECTION_TITLES: Record<string, string> = {
  captured: "Captured",
  "rust-os": "Rust &amp; Operating Systems",
  "ai-at-work": "AI at Work",
  "might-like": "Might Like &mdash; Outside Your Usual Topics",
};
const KIND_MARKS: Record<string, string> = {
  "deep-read": "&#8224;",
  brief: "&#8225;",
  captured: "&#10086;",
};
const KIND_LABELS: Record<string, string> = {
  "deep-read": "Deep read",
  brief: "Brief",
  captured: "Captured",
};

class EditionError extends Error {}

interface Item {
  id: string;
  title: string;
  url: string;
  source: string;
  section: string;
  kind: string;
  brief?: string;
  captured_at?: string;
}

/** html.escape(text, quote=True) equivalent. */
function esc(text: unknown): string {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#x27;");
}

function validateItem(item: Item): void {
  for (const field of ["id", "section", "kind", "title", "url", "source"] as const) {
    if (!item[field]) throw new EditionError(`item ${item.id ?? "?"}: missing field '${field}'`);
  }
  if (!SECTION_ORDER.includes(item.section))
    throw new EditionError(`item '${item.id}': unknown section '${item.section}'`);
  if (!(item.kind in KIND_MARKS))
    throw new EditionError(`item '${item.id}': unknown kind '${item.kind}'`);
  if (item.kind === "brief" && !item.brief)
    throw new EditionError(`item '${item.id}': kind=brief requires a 'brief'`);
  if (item.kind === "captured" && !item.captured_at)
    throw new EditionError(`item '${item.id}': kind=captured requires 'captured_at'`);
}

function sectionNote(items: Item[]): string {
  const deep = items.filter((it) => it.kind === "deep-read").length;
  const n = items.length;
  let note = `${n} item${n !== 1 ? "s" : ""}`;
  if (deep > 0) note += ` &mdash; ${deep} deep read${deep !== 1 ? "s" : ""}`;
  return note;
}

function renderVoteControls(item: Item): string {
  return (
    `        <p class="vote screen-only" data-item-id="${esc(item.id)}">` +
    `<span class="vq">Worth your time?</span> ` +
    `<button type="button" class="vote-btn" data-value="up">commend</button>` +
    `<span class="vsep"> &middot; </span>` +
    `<button type="button" class="vote-btn" data-value="down">dismiss</button></p>`
  );
}

function renderItem(item: Item, dropCap: boolean): string {
  let brief = item.brief;
  if (!brief) {
    brief = item.kind === "deep-read" ? "Reserved on your reading shelf for a full sitting." : "";
  }
  let mark = KIND_MARKS[item.kind];
  // Suggested items live in the might-like section and carry the asterisk.
  if (item.section === "might-like") mark = "&#10033;";
  const capCls = dropCap ? " drop-cap" : "";
  const parts = [
    `      <div class="item${capCls}"><div class="div">&#10086;</div>`,
    `        <h3><a href="${esc(item.url)}">${esc(item.title)}</a></h3>`,
  ];
  if (brief) parts.push(`        <p>${esc(brief)}</p>`);
  parts.push(
    `        <p class="mark"><b>${mark} ${KIND_LABELS[item.kind]}</b>` +
      ` &middot; via ${esc(item.source)}` +
      (item.captured_at ? ` &middot; captured ${esc(item.captured_at.slice(0, 10))}` : "") +
      `</p>`,
  );
  parts.push(renderVoteControls(item));
  parts.push(`      </div>`);
  return parts.join("\n");
}

function renderSection(sectionKey: string, items: Item[]): string {
  const title = SECTION_TITLES[sectionKey];
  const rendered = items.map((item, i) => renderItem(item, i === 0)).join("\n");
  return (
    `  <section>\n` +
    `    <h2 class="col-h">${title} <small>${sectionNote(items)}</small></h2>\n` +
    `    <div class="cols">\n${rendered}\n    </div>\n  </section>\n`
  );
}

function groupItems(items: Item[]): Record<string, Item[]> {
  const sections: Record<string, Item[]> = Object.fromEntries(
    SECTION_ORDER.map((key) => [key, []]),
  );
  for (const item of items) {
    validateItem(item);
    sections[item.section].push(item);
  }
  return sections;
}

/** First capture is the lead feature; returns (lead_html, remaining). */
function renderLead(capturedItems: Item[]): [string, Item[]] {
  if (capturedItems.length === 0) return ["", capturedItems];
  const item = capturedItems[0];
  const lead =
    `  <div class="lead">\n` +
    `    <div class="cap">Captured &mdash; saved from your reading, via ${esc(item.source)}</div>\n` +
    `    <h2><a href="${esc(item.url)}">${esc(item.title)}</a></h2>\n` +
    `    <p class="deck">${esc(item.brief || "")}</p>\n` +
    `    ${renderVoteControls(item)}\n` +
    `  </div>\n`;
  return [lead, capturedItems.slice(1)];
}

function renderGradeRows(items: Item[]): string {
  const sections = groupItems(items);
  const chunks: string[] = [];
  for (const key of SECTION_ORDER) {
    if (sections[key].length === 0) continue;
    const rows = sections[key]
      .map(
        (it) =>
          `    <div class="grade-row" data-item-id="${esc(it.id)}">\n` +
          `      <div class="g-body">\n` +
          `        <h3><a href="${esc(it.url)}">${esc(it.title)}</a></h3>\n` +
          `        <p class="mark"><b>${KIND_MARKS[it.kind]} ${KIND_LABELS[it.kind]}</b>` +
          ` &middot; via ${esc(it.source)}</p>\n` +
          `      </div>\n` +
          `      <div class="g-btns screen-only">\n` +
          `        <button type="button" class="grade-btn" data-value="deep-read">deep read</button>\n` +
          `        <button type="button" class="grade-btn" data-value="skim">skim</button>\n` +
          `        <button type="button" class="grade-btn" data-value="capture">capture</button>\n` +
          `      </div>\n` +
          `    </div>`,
      )
      .join("\n");
    chunks.push(
      `  <section>\n    <h2 class="col-h">${SECTION_TITLES[key]}</h2>\n${rows}\n  </section>`,
    );
  }
  return chunks.join("\n");
}

function renderPanelBoxes(items: Item[]): string {
  const sections = groupItems(items);
  const order =
    sections["captured"].length > 0
      ? ["captured", ...SECTION_ORDER.slice(1)]
      : SECTION_ORDER.slice(1);
  const boxes: string[] = [];
  for (const key of order) {
    if (sections[key].length === 0) continue;
    const lis = sections[key]
      .map((it) => {
        const mark = it.section === "might-like" ? "&#10033;" : KIND_MARKS[it.kind];
        return (
          `      <li><a href="${esc(it.url)}"><span class="t">${esc(it.title)}</span></a>` +
          `<span class="mk">${mark}</span>` +
          `<span class="src">${KIND_LABELS[it.kind]} &middot; via ${esc(it.source)}</span></li>`
        );
      })
      .join("\n");
    boxes.push(
      `  <div class="topic-box">\n    <h2>${SECTION_TITLES[key]}</h2>\n    <ul>\n${lis}\n    </ul>\n  </div>`,
    );
  }
  return boxes.join("\n");
}

function fillTemplate(
  template: string,
  editionDate: string,
  itemCount: number,
  replacements: Record<string, string>,
): string {
  const dateLong = longDate(editionDate);
  let page = template
    .replaceAll("{{MASTHEAD_DATE}}", esc(dateLong))
    .replaceAll("{{EDITION_DATE}}", esc(editionDate))
    .replaceAll("{{ITEM_COUNT}}", String(itemCount));
  for (const [key, value] of Object.entries(replacements)) {
    page = page.replaceAll(`{{${key}}}`, value);
  }
  return page;
}

export function build(editionPath: string, outputDir: string): void {
  const raw = JSON.parse(readFileSync(editionPath, "utf-8"));
  // Domain validation (loud, before anything is rendered or deployed).
  const edition = parseEdition(raw);
  if (!edition)
    throw new EditionError("edition JSON does not match the domain schema (parseEdition)");
  const { edition_date: editionDate, items } = edition;
  if (items.length === 0)
    throw new EditionError("edition has no items; an empty edition is not worth a page");
  const sections = groupItems(items);

  const [leadHtml, restCaptured] = renderLead(sections["captured"]);
  sections["captured"] = restCaptured;

  // Captured is pinned first; empty sections are omitted entirely.
  const order =
    restCaptured.length > 0 ? ["captured", ...SECTION_ORDER.slice(1)] : SECTION_ORDER.slice(1);
  const sectionsHtml = order
    .filter((key) => sections[key].length > 0)
    .map((key) => renderSection(key, sections[key]))
    .join("");

  const template = readFileSync(join(TEMPLATES_DIR, "broadsheet.html"), "utf-8");
  const page = fillTemplate(template, editionDate, items.length, {
    TITLE: `The Morning Edition &mdash; ${longDate(editionDate)}`,
    LEAD: leadHtml,
    SECTIONS: sectionsHtml,
  });

  const gradeTemplate = readFileSync(join(TEMPLATES_DIR, "grade.html"), "utf-8");
  const gradePage = fillTemplate(gradeTemplate, editionDate, items.length, {
    TITLE: `The Grading Desk &mdash; ${longDate(editionDate)}`,
    GRADE_ROWS: renderGradeRows(items),
  });

  const panelTemplate = readFileSync(join(TEMPLATES_DIR, "panel.html"), "utf-8");
  const panelPage = fillTemplate(panelTemplate, editionDate, items.length, {
    TITLE: `The Morning Edition &mdash; QuickStudy panel &mdash; ${longDate(editionDate)}`,
    PANEL_SECTIONS: renderPanelBoxes(items),
  });

  mkdirSync(outputDir, { recursive: true });
  const assets = join(outputDir, "assets");
  mkdirSync(assets, { recursive: true });
  copyFileSync(join(TEMPLATES_DIR, "broadsheet.css"), join(assets, "style.css"));
  copyFileSync(join(TEMPLATES_DIR, "feedback.js"), join(assets, "feedback.js"));
  writeFileSync(join(outputDir, "index.html"), page);
  writeFileSync(join(outputDir, "grade.html"), gradePage);
  writeFileSync(join(outputDir, "panel.html"), panelPage);
  const sectionCount = order.filter((key) => (sections[key] ?? []).length > 0).length;
  console.log(
    `wrote ${join(outputDir, "index.html")} (${items.length} items, ` +
      `${sectionCount + (leadHtml ? 1 : 0)} sections incl. lead; also grade.html, panel.html)`,
  );
}

async function main(argv: string[]): Promise<number> {
  if (argv.length !== 4) {
    console.error(
      "Build a Morning Edition broadsheet page from an edition JSON.\n\n" +
        "Usage:\n    tsx builder/build_edition.ts <edition.json> <output_dir>",
    );
    return 2;
  }
  try {
    build(argv[2], argv[3]);
  } catch (exc) {
    console.error(`error: ${exc instanceof Error ? exc.message : String(exc)}`);
    return 1;
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exit(await main(process.argv));
}
