#!/usr/bin/env python3
"""Build a Morning Edition broadsheet page from an edition JSON.

Usage:
    python3 builder/build_edition.py <edition.json> <output_dir>

Reads templates/broadsheet.html and templates/broadsheet.css (found relative to
the repository root) and writes <output_dir>/index.html, <output_dir>/grade.html
plus assets/style.css and assets/feedback.js.
The output is a pure function of the edition JSON and the templates — no
timestamps, no randomness — so rebuilding the same edition is deterministic.

EDITION JSON IS PUBLIC INPUT HERE: anything committed under data/demo/ and
built into docs/ must be MOCK DATA ONLY. Never build a real personal edition
into docs/ — that output ships to the public GitHub Pages site.
"""

import html
import json
import shutil
import sys
from pathlib import Path
from urllib.parse import quote

REPO_ROOT = Path(__file__).resolve().parent.parent
TEMPLATES_DIR = REPO_ROOT / "templates"

SECTION_ORDER = ["captured", "rust-os", "ai-at-work", "might-like"]
SECTION_TITLES = {
    "captured": "Captured",
    "rust-os": "Rust &amp; Operating Systems",
    "ai-at-work": "AI at Work",
    "might-like": "Might Like &mdash; Outside Your Usual Topics",
}
KIND_MARKS = {"deep-read": "&#8224;", "brief": "&#8225;", "captured": "&#10086;"}
KIND_LABELS = {
    "deep-read": "Deep read",
    "brief": "Brief",
    "captured": "Captured",
}
MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]
WEEKDAYS = [
    "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
]


class EditionError(ValueError):
    pass


def esc(text):
    return html.escape(str(text), quote=True)


def validate_item(item):
    for field in ("id", "section", "kind", "title", "url", "source"):
        if not item.get(field):
            raise EditionError(f"item {item.get('id', '?')!r}: missing field {field!r}")
    if item["section"] not in SECTION_ORDER:
        raise EditionError(f"item {item['id']!r}: unknown section {item['section']!r}")
    if item["kind"] not in KIND_MARKS:
        raise EditionError(f"item {item['id']!r}: unknown kind {item['kind']!r}")
    if item["kind"] == "brief" and not item.get("brief"):
        raise EditionError(f"item {item['id']!r}: kind=brief requires a 'brief'")
    if item["kind"] == "captured" and not item.get("captured_at"):
        raise EditionError(f"item {item['id']!r}: kind=captured requires 'captured_at'")


def long_date(edition_date):
    y, m, d = (int(part) for part in edition_date.split("-"))
    # Zeller-style weekday via datetime (deterministic, locale-free formatting)
    import datetime
    dt = datetime.date(y, m, d)
    return f"{WEEKDAYS[dt.weekday()]}, {MONTHS[m - 1]} {d}, {y}"


def section_note(items):
    deep = sum(1 for it in items if it["kind"] == "deep-read")
    n = len(items)
    note = f"{n} item" + ("s" if n != 1 else "")
    if deep:
        note += f" &mdash; {deep} deep read" + ("s" if deep != 1 else "")
    return note


def render_item(item, drop_cap):
    brief = item.get("brief")
    if not brief:
        if item["kind"] == "deep-read":
            brief = "Reserved on your reading shelf for a full sitting."
        else:
            brief = ""
    mark = KIND_MARKS[item["kind"]]
    # Suggested items live in the might-like section and carry the asterisk.
    if item["section"] == "might-like":
        mark = "&#10033;"
    cap_cls = " drop-cap" if drop_cap else ""
    parts = [
        f'      <div class="item{cap_cls}"><div class="div">&#10086;</div>',
        f'        <h3><a href="{esc(item["url"])}">{esc(item["title"])}</a></h3>',
    ]
    if brief:
        parts.append(f"        <p>{esc(brief)}</p>")
    parts.append(
        f'        <p class="mark"><b>{mark} {KIND_LABELS[item["kind"]]}</b>'
        f' &middot; via {esc(item["source"])}'
        + (f' &middot; captured {esc(item["captured_at"][:10])}' if item.get("captured_at") else "")
        + "</p>"
    )
    parts.append(render_vote_controls(item))
    parts.append("      </div>")
    return "\n".join(parts)


def render_vote_controls(item):
    """Screen-only inline vote controls; typographic, part of the mark system."""
    return (
        f'        <p class="vote screen-only" data-item-id="{esc(item["id"])}">'
        f'<span class="vq">Worth your time?</span> '
        f'<button type="button" class="vote-btn" data-value="up">commend</button>'
        f'<span class="vsep"> &middot; </span>'
        f'<button type="button" class="vote-btn" data-value="down">dismiss</button></p>'
    )


def render_section(section_key, items):
    title = SECTION_TITLES[section_key]
    rendered = "\n".join(
        render_item(item, drop_cap=(i == 0)) for i, item in enumerate(items)
    )
    return (
        f'  <section>\n'
        f'    <h2 class="col-h">{title} <small>{section_note(items)}</small></h2>\n'
        f'    <div class="cols">\n{rendered}\n    </div>\n  </section>\n'
    )


def group_items(items):
    sections = {key: [] for key in SECTION_ORDER}
    for item in items:
        validate_item(item)
        sections[item["section"]].append(item)
    return sections


def render_lead(captured_items):
    """First capture is the lead feature; returns (lead_html, remaining)."""
    if not captured_items:
        return "", captured_items
    item = captured_items[0]
    lead = (
        f'  <div class="lead">\n'
        f'    <div class="cap">Captured &mdash; saved from your reading, via {esc(item["source"])}</div>\n'
        f'    <h2><a href="{esc(item["url"])}">{esc(item["title"])}</a></h2>\n'
        f'    <p class="deck">{esc(item.get("brief", ""))}</p>\n'
        f'    {render_vote_controls(item)}\n'
        f'  </div>\n'
    )
    return lead, captured_items[1:]


def render_grade_rows(items):
    """Grade-page rows for every item, grouped under the same section headers."""
    sections = group_items(items)
    chunks = []
    for key in SECTION_ORDER:
        if not sections[key]:
            continue
        rows = "\n".join(
            f'    <div class="grade-row" data-item-id="{esc(it["id"])}">\n'
            f'      <div class="g-body">\n'
            f'        <h3><a href="{esc(it["url"])}">{esc(it["title"])}</a></h3>\n'
            f'        <p class="mark"><b>{KIND_MARKS[it["kind"]]} {KIND_LABELS[it["kind"]]}</b>'
            f' &middot; via {esc(it["source"])}</p>\n'
            f'      </div>\n'
            f'      <div class="g-btns screen-only">\n'
            f'        <button type="button" class="grade-btn" data-value="deep-read">deep read</button>\n'
            f'        <button type="button" class="grade-btn" data-value="skim">skim</button>\n'
            f'        <button type="button" class="grade-btn" data-value="capture">capture</button>\n'
            f'      </div>\n'
            f'    </div>'
            for it in sections[key]
        )
        chunks.append(
            f'  <section>\n'
            f'    <h2 class="col-h">{SECTION_TITLES[key]}</h2>\n'
            f'{rows}\n'
            f'  </section>'
        )
    return "\n".join(chunks)


def build(edition_path, output_dir):
    edition = json.loads(Path(edition_path).read_text(encoding="utf-8"))
    edition_date = edition.get("edition_date")
    if not edition_date:
        raise EditionError("edition JSON must set 'edition_date'")
    items = edition.get("items") or []
    if not items:
        raise EditionError("edition has no items; an empty edition is not worth a page")
    sections = group_items(items)

    lead_html, rest_captured = render_lead(sections["captured"])
    sections["captured"] = rest_captured

    # Captured is pinned first; empty sections are omitted entirely.
    order = ["captured"] + SECTION_ORDER[1:] if rest_captured else SECTION_ORDER[1:]
    sections_html = "".join(
        render_section(key, sections[key]) for key in order if sections[key]
    )

    template = (TEMPLATES_DIR / "broadsheet.html").read_text(encoding="utf-8")
    page = (
        template.replace("{{TITLE}}", f"The Morning Edition &mdash; {long_date(edition_date)}")
        .replace("{{MASTHEAD_DATE}}", esc(long_date(edition_date)))
        .replace("{{EDITION_DATE}}", esc(edition_date))
        .replace("{{ITEM_COUNT}}", str(len(items)))
        .replace("{{LEAD}}", lead_html)
        .replace("{{SECTIONS}}", sections_html)
    )

    grade_template = (TEMPLATES_DIR / "grade.html").read_text(encoding="utf-8")
    grade_page = (
        grade_template.replace("{{TITLE}}", f"The Grading Desk &mdash; {long_date(edition_date)}")
        .replace("{{MASTHEAD_DATE}}", esc(long_date(edition_date)))
        .replace("{{EDITION_DATE}}", esc(edition_date))
        .replace("{{ITEM_COUNT}}", str(len(items)))
        .replace("{{GRADE_ROWS}}", render_grade_rows(items))
    )

    output_dir = Path(output_dir)
    assets = output_dir / "assets"
    assets.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(TEMPLATES_DIR / "broadsheet.css", assets / "style.css")
    shutil.copyfile(TEMPLATES_DIR / "feedback.js", assets / "feedback.js")
    (output_dir / "index.html").write_text(page, encoding="utf-8")
    (output_dir / "grade.html").write_text(grade_page, encoding="utf-8")
    print(f"wrote {output_dir / 'index.html'} ({len(items)} items, "
          f"{sum(1 for k in order if sections.get(k)) + (1 if lead_html else 0)} sections incl. lead)")


def main(argv):
    if len(argv) != 3:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    try:
        build(argv[1], argv[2])
    except (EditionError, OSError, json.JSONDecodeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
