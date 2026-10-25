import ast
import json
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
docs = (REPO / "docs" / "index.html").read_text(encoding="utf-8")
css = (REPO / "docs" / "assets" / "style.css").read_text(encoding="utf-8")
builder = (REPO / "builder" / "build_edition.py").read_text(encoding="utf-8")

checks = []
def check(name, ok, detail=""):
    checks.append((name, ok, detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  [{detail}]" if detail else ""))

check("masthead", "The Morning Edition" in docs)
check("dagger legend", "&#8224; deep read &#8225; brief &#10086; captured &#10033; suggested" in docs)
order = [m.group(1) for m in re.finditer(r'<h2 class="col-h">([^<]+)', docs)]
check("section order", order == ["Captured ", "Rust &amp; Operating Systems ", "AI at Work ", "Might Like &mdash; Outside Your Usual Topics "], str(order))
lead_pos = docs.find('class="lead"')
sec_pos = docs.find('<section>')
check("captured lead pinned first", 0 < lead_pos < sec_pos)
check("captured cap line", "Captured &mdash; saved from your reading" in docs)
check("print @media", "@media print" in css)
check("print @page", "@page" in css)
check("print 2-col", "grid-template-columns:repeat(2,1fr)" in css)
check("screen chrome hidden", ".screen-only { display:none" in css)
check("fonts CDN", "IM+Fell+English" in docs and "Pirata+One" in docs)
colors = sorted(set(re.findall(r'#[0-9a-fA-F]{3,6}|rgba?\([^)]*\)', css)))
check("palette only", set(colors) <= {"#141414", "#57534a", "#9a968c", "#fff", "#ffffff"}, str(colors))
check("fonts in CSS", "'IM Fell English'" in css and "'Pirata One'" in css)
teaser = re.findall(r'this article|this piece discusses|read more|continue reading', docs, re.I)
check("no teaser phrasing", not teaser, str(teaser))
hosts = sorted(set(re.findall(r'href="(https?://[^/"]+)', docs)))
check("fake URLs only", set(hosts) <= {"https://example.com", "https://fonts.googleapis.com", "https://fonts.gstatic.com"}, str(hosts))
check("drop cap scoped to opener", ".item.drop-cap p:first-of-type::first-letter" in css)
ast.parse(builder)
check("builder parses", True)

# empty-section omission end-to-end
empty_ed = {"edition_date": "2026-10-25", "items": [{
    "id": "readeck-1", "section": "might-like", "kind": "brief",
    "title": "T", "url": "https://example.com/t", "source": "readeck",
    "brief": "Self-contained summary. Second sentence.", "shadow_score": 0.5}]}
Path("/tmp/me-empty.json").write_text(json.dumps(empty_ed))
subprocess.run([sys.executable, str(REPO / "builder" / "build_edition.py"),
                "/tmp/me-empty.json", "/tmp/me-empty-out"], check=True, capture_output=True)
empty_html = Path("/tmp/me-empty-out/index.html").read_text(encoding="utf-8")
check("empty sections omitted", "col-h" in empty_html and "Rust" not in empty_html)

# schema validation rejects bad input
bad = {"edition_date": "2026-01-01", "items": [{
    "id": "x", "section": "rust-os", "kind": "brief", "title": "T",
    "url": "https://e.com", "source": "miniflux"}]}
Path("/tmp/me-bad.json").write_text(json.dumps(bad))
r = subprocess.run([sys.executable, str(REPO / "builder" / "build_edition.py"),
                    "/tmp/me-bad.json", "/tmp/me-bad-out"], capture_output=True, text=True)
check("rejects brief-less brief item", r.returncode != 0 and "requires a 'brief'" in r.stderr, r.stderr.strip())

# briefs self-contained: each kind=brief item has >= 2 sentences
data = json.loads((REPO / "data" / "demo" / "edition-demo.json").read_text())
short = [i["id"] for i in data["items"]
         if i["kind"] == "brief" and i.get("brief", "").count(".") < 2]
check("briefs multi-sentence", not short, str(short))

fails = [c for c in checks if not c[1]]
print(f"\n{len(checks) - len(fails)}/{len(checks)} checks passed")
sys.exit(1 if fails else 0)
