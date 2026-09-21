#!/usr/bin/env python3
"""Pre-deploy sanity checks for the static site in ./public.

FAIL blocks the deploy (exit 1). WARN is printed but doesn't block, because
the site can go live before every content slot is filled.
"""
import hashlib
import json
import re
import sys
import zlib
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PUB = ROOT / "public"
QR_DIR = ROOT / "artifacts" / "qr"
QR_URL = "https://zneagle.com/r"
CSS_FILE = PUB / "assets" / "site.css"
# 2026-09-18: an audit found .ledger--links>li silently inheriting the multi-column
# grid that .ledger>li sets at >=780px. The <a> inside is itself a 3-column grid, so
# with no override it was auto-placed into just the <li>'s first ~150-192px track,
# squeezing its own description column toward zero width (word-by-word wrap,
# overlapping the state/status label). The fix decouples the <li> from the grid so
# the <a>'s own responsive grid gets the full row. This check keeps that decoupling
# from silently regressing; it is static/structural, not a rendered measurement —
# it cannot see real browser layout, only that the guarding rule still exists.
GRID_DISPLAY = ("grid", "inline-grid", "flex", "inline-flex")
ALLOWED_EXT = {".html", ".css", ".js", ".svg", ".png", ".jpg", ".jpeg", ".webp", ".ico", ".pdf", ".txt", ".woff2"}
ALLOWED_NAMES = {"_redirects", "_headers", ".assetsignore"}
MAX_BYTES = 500_000
REQUIRED_META = ("description", "viewport", "og:title", "og:description", "og:url")
SITE = "https://zneagle.com"
# .js was added 2026-09-17 for the command palette and the substrate's scroll context. The site
# must stay fully navigable with JavaScript blocked, so the allowance is deliberately narrow:
# first-party files under public/assets only, no network calls, no third-party code, no storage.
# Every page must offer the general fallbacks, so no recruiter route dead-ends (added 2026-09-17).
RECOVERY = ("/r", "/r/resume", "/r/open-letter")
JS_DIR = "assets"
# 2026-09-18 (011B4): 32_000 -> 40_000 for the actuator capsule-transfer controller (pure-logic block
# in site.js, exercised by scripts/test_actuator.js). Still first-party, no network, no storage.
JS_MAX_BYTES = 40_000
JS_FORBIDDEN = ("fetch(", "XMLHttpRequest", "sendBeacon", "WebSocket", "EventSource",
                "import(", "eval(", "document.cookie", "http://", "https://")

fails, warns = [], []


class Page(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids, self.refs, self.meta, self.links, self.text = set(), [], {}, {}, []
        self.scripts, self.inline = [], []
        self.title, self._in_title, self._skip = "", False, 0

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if "id" in a:
            self.ids.add(a["id"])
        for k in ("href", "src"):
            if a.get(k):
                self.refs.append(a[k])
        if tag == "script" and a.get("src"):
            self.scripts.append(a["src"])
        elif tag == "script":
            self.inline.append(a.get("type") or "")
        if tag == "meta" and (a.get("name") or a.get("property")):
            self.meta[a.get("name") or a.get("property")] = a.get("content") or ""
        if tag == "link" and a.get("rel"):
            self.links[a["rel"]] = a.get("href") or ""
        if tag == "title":
            self._in_title = True
        if tag in ("script", "style"):
            self._skip += 1

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False
        if tag in ("script", "style"):
            self._skip -= 1

    def handle_data(self, data):  # comments never reach here, so TODOs in comments are allowed
        if self._in_title:
            self.title += data
        elif not self._skip:
            self.text.append(data)


def resolve(path):
    """Map a site-absolute URL path to the file the host would serve."""
    path = path.split("#")[0].split("?")[0]
    if path.endswith("/"):
        return PUB / path.lstrip("/") / "index.html"
    p = PUB / path.lstrip("/")
    return p if p.suffix else p.with_suffix(".html")


def route_of(rel):
    """The URL path a page is served at; None for the 404 page."""
    path = rel.as_posix()
    if path == "404.html":
        return None
    if path in ("index.html", "r.html"):  # r.html is a byte copy of the home page
        return "/"
    if path.endswith("/index.html"):
        return "/" + path[: -len("index.html")]
    return "/" + path[: -len(".html")]


def check_page(f, rel):
    page = Page()
    page.feed(f.read_text(encoding="utf-8"))
    name = rel.as_posix()
    route = route_of(rel)
    if not page.title.strip():
        fails.append(f"{name}: missing <title>")
    required = ("description", "viewport") if route is None else REQUIRED_META
    for key in required:
        if not page.meta.get(key):
            fails.append(f"{name}: missing meta {key}")
    if "icon" not in page.links:
        fails.append(f"{name}: missing favicon link")
    if route is not None:
        canonical = SITE + route
        if page.links.get("canonical") != canonical:
            fails.append(f"{name}: canonical should be {canonical}")
        if page.meta.get("og:url") and page.meta["og:url"] != canonical:
            fails.append(f"{name}: og:url should be {canonical}")
    for kind in page.inline:
        if kind != "application/json":
            fails.append(f"{name}: inline <script> must be type=application/json data, not code")
    if route is not None or name == "404.html":
        missing = [r for r in RECOVERY if r not in page.refs]
        if missing:
            fails.append(f"{name}: no route back to {', '.join(missing)} (recruiter pages must not dead-end)")
    for src in page.scripts:
        if not src.startswith("/") or src.startswith("//"):
            fails.append(f"{name}: script src {src!r} is not a first-party absolute path")
    for ref in page.refs:
        if ref.startswith("#"):
            if ref[1:] not in page.ids:
                fails.append(f"{name}: anchor {ref} has no matching id")
        elif ref.startswith("/") and not ref.startswith("//"):
            if not resolve(ref).is_file():
                fails.append(f"{name}: {ref} does not resolve to a file in public/")
    visible = " ".join(" ".join(page.text).split())
    if "TODO" in visible:
        fails.append(f"{name}: visible TODO text on a public page (keep TODOs in HTML comments)")
    return page


def pdf_text(path):
    """Raw bytes of a PDF plus every inflated stream: enough to find a plain string in a small, uncompressed-font PDF."""
    data = path.read_bytes()
    parts = [data]
    for m in re.finditer(rb"stream\r?\n(.*?)\r?\nendstream", data, re.S):
        try:
            parts.append(zlib.decompress(m.group(1)))
        except zlib.error:
            pass
    return b"\n".join(parts)


def check_pdf_contact():
    """The PDFs are produced separately from the pages (scripts/gen_pdfs.py). Their contact statement must not drift
    from site/site.json: the address is present in the résumé, and no PDF still says none is published."""
    email = (json.loads((ROOT / "site" / "site.json").read_text(encoding="utf-8")).get("contact") or {}).get("email")
    for f in sorted((PUB / "r" / "downloads").glob("*.pdf")):
        text = pdf_text(f)
        for stale in (b"no public address", b"Contact via the site"):
            if stale in text:
                fails.append(f"public/r/downloads/{f.name}: still says {stale.decode()!r} (regenerate: python3 scripts/gen_pdfs.py)")
        if email and "resume" in f.name.lower() and email.encode() not in text:
            fails.append(f"public/r/downloads/{f.name}: does not carry the contact address {email} from site/site.json")


def check_anchors(pages):
    """A link to another page's fragment must land on an id that exists there."""
    for name, page in pages.items():
        for ref in page.refs:
            if not ref.startswith("/") or ref.startswith("//") or "#" not in ref:
                continue
            path, _, frag = ref.partition("#")
            try:
                key = resolve(path).relative_to(PUB).as_posix()
            except ValueError:
                continue
            if frag and key in pages and frag not in pages[key].ids:
                fails.append(f"{name}: {ref} has no matching id on {key}")


def rule_body(css, selector):
    """The declaration block for the first `selector{...}` found verbatim, or None."""
    m = re.search(re.escape(selector) + r"\{([^}]*)\}", css)
    return m.group(1) if m else None


def check_ledger_layout():
    """Guard against .ledger--links>li silently re-inheriting a multi-column grid
    from .ledger>li (see CSS_FILE comment). Structural only: confirms the decoupling
    rule and the <a>'s own responsive columns are still in place, not a rendered
    measurement of any actual page at any viewport width."""
    if not CSS_FILE.is_file():
        fails.append(f"{CSS_FILE.relative_to(ROOT)}: missing")
        return
    css = CSS_FILE.read_text(encoding="utf-8")
    name = CSS_FILE.relative_to(ROOT).as_posix()

    li = rule_body(css, ".ledger--links>li")
    if li is None:
        fails.append(f"{name}: .ledger--links>li rule not found (nested-grid collapse guard removed)")
    else:
        m = re.search(r"display\s*:\s*([\w-]+)", li)
        if not m:
            fails.append(f"{name}: .ledger--links>li no longer sets display — "
                          f"it can re-inherit .ledger>li's grid and collapse its <a>'s own columns")
        elif m.group(1).lower() in GRID_DISPLAY:
            fails.append(f"{name}: .ledger--links>li has display:{m.group(1)} — a nested grid/flex "
                          f"<li> around the <a>'s own grid reproduces the description-column collapse")

    a_desktop = rule_body(css, "@media (min-width:780px){.ledger--links a")
    if a_desktop is None or "grid-template-columns" not in a_desktop:
        fails.append(f"{name}: .ledger--links a lost its >=780px multi-column layout")
    a_mobile = rule_body(css, ".ledger--links a")
    if a_mobile is None or "display:grid" not in a_mobile.replace(" ", ""):
        fails.append(f"{name}: .ledger--links a is no longer a grid — mobile single-column layout may have changed")


def main():
    if not PUB.is_dir():
        sys.exit("public/ not found")
    check_ledger_layout()

    for f in sorted(p for p in PUB.rglob("*") if p.is_file()):
        rel = f.relative_to(PUB)
        if f.name == ".DS_Store":
            continue
        if f.suffix.lower() not in ALLOWED_EXT and f.name not in ALLOWED_NAMES:
            fails.append(f"public/{rel}: file type not allowed in the publish dir")
        if f.stat().st_size > MAX_BYTES:
            warns.append(f"public/{rel}: {f.stat().st_size} bytes, consider optimizing")
        if f.suffix.lower() == ".js":
            if len(rel.parts) != 2 or rel.parts[0] != JS_DIR:
                fails.append(f"public/{rel}: JavaScript is only allowed at public/{JS_DIR}/<name>.js")
            if f.stat().st_size > JS_MAX_BYTES:
                fails.append(f"public/{rel}: {f.stat().st_size} bytes over the {JS_MAX_BYTES}-byte enhancement budget")
            source = f.read_text(encoding="utf-8")
            for token in JS_FORBIDDEN:
                if token in source:
                    fails.append(f"public/{rel}: contains {token!r}; site JavaScript stays offline and first-party")

    missing = [name for name in ("index.html", "r.html", "404.html") if not (PUB / name).is_file()]
    if missing:
        fails.extend(f"public/{name} missing" for name in missing)
        return report()

    if (PUB / "index.html").read_bytes() != (PUB / "r.html").read_bytes():
        fails.append("public/r.html differs from public/index.html (run: cp public/index.html public/r.html)")

    pages = {f.relative_to(PUB).as_posix(): check_page(f, f.relative_to(PUB)) for f in sorted(PUB.rglob("*.html"))}
    check_anchors(pages)

    check_pdf_contact()
    refs = [ref for page in pages.values() for ref in page.refs]
    if not any(r.startswith("mailto:") for r in refs):
        warns.append("site: no mailto: contact link yet (CONTACT gate stays open)")
    if not any(r.lower().endswith(".pdf") and "resume" in r.lower() for r in refs):
        warns.append("site: no résumé document linked yet (RESUME gate stays open)")
    for state in ("draft", "pending"):
        slots = {name: (PUB / name).read_text(encoding="utf-8").count(f'data-content="{state}"') for name in pages if name != "r.html"}
        if sum(slots.values()):
            detail = ", ".join(f"{name}×{n}" for name, n in sorted(slots.items()) if n)
            warns.append(f"site: {sum(slots.values())} {state.upper()} content block(s), not publication-ready — {detail}")

    manifest = dict(
        line.split("=", 1) for line in (QR_DIR / "QR_MANIFEST.txt").read_text().splitlines() if "=" in line
    )
    if manifest.get("encoded_url") != QR_URL:
        fails.append(f"QR_MANIFEST encoded_url is {manifest.get('encoded_url')!r}, expected {QR_URL}")
    verify_sums(QR_DIR / "SHA256SUMS.txt")

    return report()


def verify_sums(sums, hint=""):
    for line in sums.read_text().splitlines():
        if not line.strip():
            continue
        digest, name = line.split(maxsplit=1)
        target = sums.parent / name.strip()
        if not target.is_file() or hashlib.sha256(target.read_bytes()).hexdigest() != digest:
            fails.append(f"{target.relative_to(ROOT)}: checksum mismatch or missing{hint}")


def report():
    for w in warns:
        print(f"WARN  {w}")
    for f in fails:
        print(f"FAIL  {f}")
    print("check: FAIL" if fails else "check: PASS" + (" (with warnings)" if warns else ""))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
