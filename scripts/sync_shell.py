#!/usr/bin/env python3
"""Keep the shared page shell identical across the static pages in ./public.

Pages stay the editable source. Only the regions between
<!-- shell:NAME --> and <!-- /shell:NAME --> belong to this script:

  head      shared <head> tags (theme colour, icon, stylesheet, script)
  header    top bar: name, breadcrumb, Contact, command palette, route menu
  rail      the RoboBoston route (identity > thesis > company > evidence > contact)
  share     the page's shareable URL and a Copy link control
  selector  every company page under public/r/companies/, with its dossier state
  toc       "On this page", built from the <h2 id=...> headings inside <main>
  sources   a collapsed drawer of every [[src:id]] token used on that page,
            each id resolved against site/sources.json
  footer    contact, general material, feedback, the source link and the build fingerprint
  peer-contact  the peer / collab contact line on the home page

A citation is never hand-written on a page: write the literal token
[[src:id]] right after the claim it supports (id must exist in
site/sources.json), then put a single <!-- shell:sources --><!-- /shell:sources -->
marker anywhere on that page. The token becomes a small "[Label]" anchor; the
marker expands into a drawer holding exactly the cards that page's own tokens
reference, in first-appearance order — so a card can never go stale or orphaned
independently of the citation using it.

Owner-controlled values (contact address, LinkedIn / GitHub / Substack profile URLs, feedback
subject) live in site/site.json; a null value renders nothing, and no contact at all renders an
explicit pending state.

The build fingerprint is a hash of the published files with the fingerprint
itself masked out, so it changes only when published content changes. The
fingerprint and the UTC date it last changed are recorded in site/build.json.
It is a content identifier, not a commit hash.

A company page declares data-company-state="targeted|general" on <body>, and each
dossier section declares data-slot="..." data-content="real|draft|pending"; the
selector derives its labels from those attributes.

public/r.html is rewritten as a byte copy of public/index.html.

  python3 scripts/sync_shell.py           # rewrite stale pages
  python3 scripts/sync_shell.py --check   # change nothing; exit 1 if anything is stale
"""
import argparse
import datetime
import hashlib
import html
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent.parent
PUB = ROOT / "public"
SITE = ROOT / "site"
SHELL = SITE / "shell"
COMPANIES = PUB / "r" / "companies"
BUILD_FILE = SITE / "build.json"
SOURCES_FILE = SITE / "sources.json"
REGION = re.compile(r"(<!-- shell:([\w-]+) -->)(.*?)(<!-- /shell:\2 -->)", re.S)
ANCHOR = re.compile(r'<a\b([^>]*?)\shref="([^"]*)"([^>]*)>')
BUILD_TOKEN = re.compile(r"rb-\d{4}-\d{2}-\d{2}\.[0-9a-f]{8}|rb-unbuilt")
GENERATED = {"toc", "selector", "sources"}
# 2026-09-18 (source enrichment pass 007): citations are never hand-copied onto a
# page. A page cites a source by writing the literal token [[src:id]] right after
# the claim it supports; id must exist in site/sources.json. That token becomes a
# small "[Label]" anchor, and a single <!-- shell:sources --> marker anywhere on the
# same page expands into a collapsed drawer holding exactly the cards actually
# referenced on that page, derived by scanning the page for its own [[src:...]]
# tokens — never a hand-maintained per-page list, so a card can't go stale or
# orphaned independently of the citation that uses it.
SRC_TOKEN = re.compile(r"\[\[src:([\w-]+)\]\]")
# A rendered src-ref carries data-src="id" too, so a second run (reading a page that
# was already rendered on disk, where the [[src:id]] token no longer exists as such)
# can still tell which cards that page uses. Re-running the generator must be stable.
# SRC_ANY also matches the fully-rendered anchor so re-rendering it every run keeps
# its visible [Label] in sync with the registry — a registry label edit must not
# require manually reverting the page back to a raw token first (007R1 repair C).
SRC_USED = re.compile(r'\[\[src:([\w-]+)\]\]|data-src="([\w-]+)"')
SRC_ANY = re.compile(r'\[\[src:([\w-]+)\]\]|<a class="src-ref"[^>]*\bdata-src="([\w-]+)"[^>]*>\[[^\]<]*\]</a>')
# 007R1 repair B: a [[src:id]] (or an already-rendered citation) sitting inside an
# HTML comment must never become a visible card or count as a citation on the page.
COMMENT = re.compile(r"<!--.*?-->", re.S)
# 2026-09-18: an audit found company pages hardcoding "General · draft" / "General ·
# pending" next to the thesis/open-letter links in their "general material" ledgers.
# Those pages don't regenerate on their own, so once /r/thesis or /r/open-letter's
# actual content state moved on, ten pages kept citing the old one. NOTE_TARGETS ties
# each link's ledger-note to the live data-content of that page's own primary section,
# so the label can't go stale independently of the page it describes again.
NOTE_TARGETS = {"/r/thesis": "thesis-intro", "/r/open-letter": "letter"}
NOTE_LABEL = {"real": "General", "draft": "General · draft", "pending": "General · pending"}
# 2026-09-18 (repair 002): the same staleness also survived as a literal " Working
# draft." clause inside several pages' ledger-v sentence about /r/thesis, left over
# from before the thesis rewrite. Ties that clause to the same derived state instead
# of a second hand-authored copy: present while thesis is a draft, stripped once it
# is not — currently /r/thesis.html:89's own kicker no longer claims it either.
STALE_STATE_SUFFIX = {"/r/thesis": " Working draft."}


def route_of(rel):
    """The route a page presents; None for the 404 page. index.html and r.html are the /r surface."""
    path = rel.as_posix()
    if path == "404.html":
        return None
    if path in ("index.html", "r.html"):
        return "/r"
    if path.endswith("/index.html"):
        return "/" + path[: -len("index.html")]
    return "/" + path[: -len(".html")]


def crumbs(route):
    items = ['<li><a href="/r">zneagle.com/r</a></li>']
    if route is None:
        items.append('<li aria-current="page">not-found</li>')
    elif route != "/r":
        segs = route.strip("/").split("/")[1:]
        for i, seg in enumerate(segs):
            label = html.escape(seg)
            if i == len(segs) - 1:
                items.append(f'<li aria-current="page">{label}</li>')
                continue
            href = "/r/" + "/".join(segs[: i + 1]) + "/"
            if (PUB / href.strip("/") / "index.html").is_file():
                items.append(f'<li><a href="{href}">{label}</a></li>')
            else:
                items.append(f"<li>{label}</li>")
    return '<nav class="crumbs" aria-label="Breadcrumb"><ol>' + "".join(items) + "</ol></nav>"


def mark_current(fragment, route):
    def repl(m):
        pre, href, post = m.groups()
        if route is not None and href == route:
            return f'<a{pre} href="{href}"{post} aria-current="page">'
        if route is not None and href not in ("/", route) and href.endswith("/") and route.startswith(href):
            return f'<a{pre} href="{href}"{post} aria-current="true">'
        return m.group(0)

    return ANCHOR.sub(repl, fragment)


class Headings(HTMLParser):
    """Collects (id, text) for every <h2 id=...> inside <main>, skipping aria-hidden children."""

    def __init__(self):
        super().__init__()
        self.items, self._id, self._buf, self._hidden, self._main = [], None, [], 0, 0

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "main":
            self._main += 1
        elif self._main and tag == "h2" and a.get("id"):
            self._id, self._buf, self._hidden = a["id"], [], 0
        elif self._id and a.get("aria-hidden") == "true":
            self._hidden += 1

    def handle_endtag(self, tag):
        if tag == "main":
            self._main -= 1
        elif tag == "h2" and self._id:
            self.items.append((self._id, " ".join("".join(self._buf).split())))
            self._id = None
        elif self._id and self._hidden and tag == "span":
            self._hidden -= 1

    def handle_data(self, data):
        if self._id and not self._hidden:
            self._buf.append(data)


def load_companies():
    out = []
    for f in COMPANIES.glob("*.html") if COMPANIES.is_dir() else []:
        if f.name == "index.html":
            continue
        text = f.read_text(encoding="utf-8")
        m = re.search(r"<h1[^>]*>(.*?)</h1>", text, re.S)
        name_html = " ".join(re.sub(r"<[^>]+>", "", m.group(1)).split()) if m else f.stem
        state = re.search(r'data-company-state="(\w+)"', text)
        out.append({
            "slug": f.stem,
            "name_html": name_html,
            "name": html.unescape(name_html),
            "state": state.group(1) if state else "general",
            "slots": re.findall(r'data-slot="[\w-]+" data-content="(\w+)"', text),
        })
    return sorted(out, key=lambda c: c["name"].lower())


def dossier_state(company):
    if company["state"] != "targeted":
        return "general", "General material"
    slots = set(company["slots"])
    if not slots or slots == {"pending"}:
        return "pending", "Dossier — pending"
    if slots == {"real"}:
        return "real", "Research dossier"
    return "draft", "Dossier — draft"


def selector(companies):
    rows = []
    for c in companies:
        kind, label = dossier_state(c)
        rows.append(
            f'  <li data-company="{c["slug"]}" data-dossier="{kind}"><a href="/r/companies/{c["slug"]}">'
            f'<span class="sel-name" style="view-transition-name:co-{c["slug"]}">{c["name_html"]}</span>'
            f'<span class="sel-state">{label}</span><span class="sel-go" aria-hidden="true">→</span></a></li>'
        )
    return '<ul class="selector-list" data-selector>\n' + "\n".join(rows) + "\n</ul>"


def companies_json(companies):
    data = {c["slug"]: {"name": c["name"], "dossier": dossier_state(c)[0]} for c in companies}
    return json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")


def company_sub(route, companies):
    m = re.fullmatch(r"/r/companies/([\w-]+)", route or "")
    match = next((c for c in companies if m and c["slug"] == m.group(1)), None)
    if not match:
        return ""
    return f'<ol class="bus bus--sub"><li><a href="/r/companies/{match["slug"]}">{match["name_html"]}</a></li></ol>'


def social_display(url):
    """How a public profile URL is shown: no scheme, no leading www., no trailing slash (as on the business card)."""
    return re.sub(r"^https?://(www\.)?", "", url).rstrip("/")


def contact_block(cfg):
    contact = cfg["contact"]
    lines = []
    email = contact.get("email")
    if email:
        e = html.escape(email)
        lines.append(f'      <p class="contact-line"><a class="contact-email" href="mailto:{e}">{e}</a></p>')
    for key in ("linkedin", "github", "substack"):
        url = contact.get(key)
        if url:
            url = url if url.startswith(("http://", "https://")) else "https://" + url
            lines.append(f'      <p class="contact-line"><a href="{html.escape(url)}" rel="me">{html.escape(social_display(url))}</a></p>')
    if not lines:
        lines.append('      <p class="contact-pending"><span class="pending-k">Pending — contact address</span>'
                     " An approved address is published here once it is confirmed.</p>")
    return "\n".join(lines)


def feedback_block(cfg, route, build):
    email = cfg["contact"].get("email")
    if not email:
        return '      <p class="fb fb--pending"><span class="fb-k">Bug / compliment</span> Opens once the contact address is set.</p>'
    body = f"Page: {route or 'not-found'}\nBuild: {build}\n\nWhat worked, what broke, or what you expected:\n"
    href = f"mailto:{email}?subject={quote(cfg['feedback_subject'])}&body={quote(body)}"
    return f'      <p class="fb"><a class="fb-link" href="{html.escape(href)}" data-feedback>Bug / compliment</a></p>'


def source_block(cfg):
    """A link to the public source repository's development-approach section, in the footer's Signal column."""
    link = cfg.get("source_link")
    if not link:
        return ""
    return f'      <div class="foot-nav"><a href="{html.escape(link["url"])}">{html.escape(link["label"])}</a></div>'


def peer_block(cfg):
    """The peer / collab contact line in the home page's "Here for the same reason?" section."""
    email = cfg["contact"].get("email")
    if not email:
        return ('    <p class="fb fb--pending" style="margin-top:16px"><span class="fb-k">Peer / collab contact</span>'
                " Opens once the contact address is set.</p>")
    return (f'    <p class="fb" style="margin-top:16px"><a class="fb-link" href="mailto:{html.escape(email)}">'
            "Peer / collab contact</a></p>")


def section_content_state(text, section_id):
    """The data-content value of the <section> whose aria-labelledby is section_id."""
    for m in re.finditer(r"<section\b[^>]*>", text):
        tag = m.group(0)
        if f'aria-labelledby="{section_id}"' in tag:
            dm = re.search(r'data-content="(\w+)"', tag)
            return dm.group(1) if dm else None
    return None


def general_states(sources):
    """{'/r/thesis': 'real', ...}, the live data-content of each target page's own
    primary section (see NOTE_TARGETS)."""
    return {
        href: section_content_state(sources.get(href.strip("/") + ".html", ""), section_id)
        for href, section_id in NOTE_TARGETS.items()
    }


LINK_NOTE = re.compile(
    r'(<a href="(/r/thesis|/r/open-letter)(?:\?[^"]*)?">.*?<span class="ledger-note">)[^<]*(</span></a>)'
)
LEDGER_V_SUFFIX = re.compile(
    r'(<a href="(/r/thesis|/r/open-letter)(?:\?[^"]*)?">.*?<span class="ledger-v">[^<]*?)( Working draft\.)(</span>)'
)


def apply_general_notes(text, states):
    """A ledger-note or ledger-v clause next to a thesis/open-letter link can't cite a
    stale draft/pending state once that page has actually moved on: both are derived
    from the live state (states), never hand-copied."""
    def note(m):
        label = NOTE_LABEL.get(states.get(m.group(2)), "General")
        return f"{m.group(1)}{label}{m.group(3)}"

    def suffix(m):
        href, clause = m.group(2), STALE_STATE_SUFFIX.get(m.group(2))
        if clause and clause == m.group(3) and states.get(href) != "draft":
            return f"{m.group(1)}{m.group(4)}"
        return m.group(0)

    return LEDGER_V_SUFFIX.sub(suffix, LINK_NOTE.sub(note, text))


def lookup_src(src_id, src_registry, rel):
    entry = src_registry.get(src_id)
    if not entry:
        sys.exit(f"public/{rel}: [[src:{src_id}]] does not match any id in site/sources.json")
    return entry


def render_src_ref(src_id, src_registry, rel):
    entry = lookup_src(src_id, src_registry, rel)
    return f'<a class="src-ref" href="#src-{src_id}" data-src="{src_id}">[{html.escape(entry["label"])}]</a>'


def visible_text(text):
    """text with every HTML comment blanked out — used only to decide which
    [[src:id]] / data-src references are live. A citation inside a comment must
    not count as used and must not render (007R1 repair B)."""
    return COMMENT.sub("", text)


def visible_ids(text):
    """[[src:id]] and data-src="id" references outside HTML comments, in first-
    appearance order, deduplicated."""
    return list(dict.fromkeys(a or b for a, b in SRC_USED.findall(visible_text(text))))


def sub_outside_comments(pattern, repl, text):
    """pattern.sub(repl, text), but a match inside an HTML comment is left untouched
    (repair B) — comment segments are passed through byte-for-byte."""
    out, pos = [], 0
    for m in COMMENT.finditer(text):
        out.append(pattern.sub(repl, text[pos : m.start()]))
        out.append(m.group(0))
        pos = m.end()
    out.append(pattern.sub(repl, text[pos:]))
    return "".join(out)


def render_src_card(src_id, entry):
    fields = {k: html.escape(str(v)) for k, v in entry.items()}
    return (
        f'  <article class="src-card" id="src-{src_id}">\n'
        f'    <p class="src-title"><span class="state">{fields["source_type"]}</span> '
        f'{fields["title"]} <span class="src-year">({fields["year"]})</span></p>\n'
        f'    <p class="src-org">{fields["author_or_org"]}</p>\n'
        f'    <p class="src-why"><span class="src-tag">Why it matters</span> {fields["why_it_matters"]}</p>\n'
        f'    <p class="src-supports"><span class="src-tag">Supports</span> {fields["claim_scope"]}</p>\n'
        f'    <p class="src-open"><a href="{fields["url"]}" rel="noopener">Open source ↗</a></p>\n'
        f"  </article>"
    )


def render_sources_drawer(ids, src_registry, rel):
    if not ids:
        return "<!-- no [[src:...]] tokens on this page -->"
    noun = "source" if len(ids) == 1 else "sources"
    cards = "\n".join(render_src_card(i, lookup_src(i, src_registry, rel)) for i in ids)
    # open by default: a [source] link jumps to #src-id, and details-auto-expand-on-
    # fragment-navigation is Chrome-only today (no Firefox signal, broken on Safari
    # 18.6) — starting open means the jump always lands somewhere visible everywhere.
    # Still collapsible; the :target highlight still shows which card was jumped to.
    return (
        '<details class="trace src-drawer" open>\n'
        f"  <summary>Sources ({len(ids)} {noun})</summary>\n"
        f'  <div class="trace-body src-list">\n{cards}\n  </div>\n'
        "</details>"
    )


def apply_src_refs(text, src_registry, rel):
    """Renders every live [[src:id]] token AND re-renders every already-rendered
    src-ref anchor from scratch, so a registry label edit shows up on the next
    generation without anyone reverting the page to a raw token first (repair C).
    Never touches a match sitting inside an HTML comment (repair B)."""
    def repl(m):
        src_id = m.group(1) or m.group(2)
        return render_src_ref(src_id, src_registry, rel)

    return sub_outside_comments(SRC_ANY, repl, text)


def build_page(text, rel, partials, companies, cfg, build, states, src_registry):
    route = route_of(rel)

    def region(m):
        name = m.group(2)
        if name == "toc":
            heads = Headings()
            heads.feed(text)
            items = "\n".join(
                f'    <li><a href="#{hid}"><span class="toc-k">{n:02d}</span>{html.escape(label, quote=False)}</a></li>'
                for n, (hid, label) in enumerate(heads.items, 1)
            )
            body = partials["toc"].replace("{{items}}", items)
        elif name == "selector":
            body = selector(companies)
        elif name == "sources":
            body = render_sources_drawer(visible_ids(text), src_registry, rel)
        else:
            body = partials[name].replace("{{route_index}}", partials["route-index"].rstrip())
            for key, value in (
                ("{{crumbs}}", crumbs(route)),
                ("{{company_sub}}", company_sub(route, companies)),
                ("{{share_url}}", "zneagle.com" + (route or "/r")),
                ("{{contact}}", contact_block(cfg)),
                ("{{feedback}}", feedback_block(cfg, route, build)),
                ("{{peer_contact}}", peer_block(cfg)),
                ("{{source_link}}", source_block(cfg)),
                ("{{build_label}}", html.escape(cfg["build_label"])),
                ("{{build}}", build),
                ("{{companies_json}}", companies_json(companies)),
            ):
                body = body.replace(key, value)
            body = mark_current(body, route)
        return f"{m.group(1)}\n{body.rstrip()}\n{m.group(4)}"

    return apply_src_refs(apply_general_notes(REGION.sub(region, text), states), src_registry, rel)


def content_id(rendered):
    """Hash of every published file, with build fingerprints masked. r.html is a copy, so it is skipped."""
    h = hashlib.sha256()
    for f in sorted(p for p in PUB.rglob("*") if p.is_file() and p.name != ".DS_Store"):
        rel = f.relative_to(PUB).as_posix()
        if rel == "r.html":
            continue
        data = BUILD_TOKEN.sub("rb-BUILD", rendered[rel]).encode() if rel in rendered else f.read_bytes()
        h.update(rel.encode() + b"\0" + data + b"\0")
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser(description="Sync the shared page shell into public/*.html.")
    ap.add_argument("--check", action="store_true", help="report stale pages without writing")
    args = ap.parse_args()

    cfg = json.loads((SITE / "site.json").read_text(encoding="utf-8"))
    src_registry = json.loads(SOURCES_FILE.read_text(encoding="utf-8"))
    partials = {p.stem: p.read_text(encoding="utf-8") for p in SHELL.glob("*.html")}
    companies = load_companies()
    record = json.loads(BUILD_FILE.read_text()) if BUILD_FILE.is_file() else {"id": None, "date": None, "build": "rb-unbuilt"}
    pages = {f.relative_to(PUB).as_posix(): f for f in sorted(PUB.rglob("*.html")) if f.relative_to(PUB).as_posix() != "r.html"}
    sources = {rel: f.read_text(encoding="utf-8") for rel, f in pages.items()}

    for rel, text in sources.items():
        region_names = [m.group(2) for m in REGION.finditer(text)]
        unknown = sorted(set(region_names) - partials.keys() - GENERATED)
        if unknown:
            sys.exit(f"public/{rel}: unknown shell region(s): {', '.join(unknown)}")
        # 007R1 repair 3A: two sources drawers on one page would duplicate every
        # card's id (invalid HTML) and leave it ambiguous which drawer is canonical.
        src_regions = region_names.count("sources")
        if src_regions > 1:
            sys.exit(f"public/{rel}: {src_regions} <!-- shell:sources --> regions on one page; exactly one is allowed")
        # 007R1 repair 3D: a visible citation with nowhere to land must fail, not
        # silently produce a dangling href="#src-id".
        ids = visible_ids(text)
        if ids and not src_regions:
            sys.exit(f"public/{rel}: cites {ids} but has no <!-- shell:sources --> region to hold the cards")
        # 007R1 repair 3E: fail closed on an id that doesn't exist in the registry,
        # before rendering or writing anything for any page.
        unknown_ids = [i for i in ids if i not in src_registry]
        if unknown_ids:
            sys.exit(f"public/{rel}: unknown source id(s) not in site/sources.json: {', '.join(unknown_ids)}")

    states = general_states(sources)

    def render(build):
        return {
            rel: build_page(text, Path(rel), partials, companies, cfg, build, states, src_registry)
            for rel, text in sources.items()
        }

    stale = []
    rendered = render(record["build"])
    cid = content_id(rendered)
    if cid != record["id"]:
        stale.append("site/build.json")
        if not args.check:
            today = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")
            record = {"id": cid, "date": today, "build": f"rb-{today}.{cid[:8]}"}
            rendered = render(record["build"])
            BUILD_FILE.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")

    for rel, text in rendered.items():
        if text != sources[rel]:
            stale.append(f"public/{rel}")
            if not args.check:
                pages[rel].write_text(text, encoding="utf-8")

    index, mirror = PUB / "index.html", PUB / "r.html"
    if not mirror.is_file() or mirror.read_bytes() != index.read_bytes():
        stale.append("public/r.html")
        if not args.check:
            mirror.write_bytes(index.read_bytes())

    for path in stale:
        print(f"{'STALE' if args.check else 'SYNCED'}  {path}")
    if args.check:
        print("shell: FAIL (run python3 scripts/sync_shell.py)" if stale else f"shell: PASS  build {record['build']}")
        return 1 if stale else 0
    print(f"shell: {len(stale)} file(s) updated  build {record['build']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
