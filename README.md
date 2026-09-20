# zneagle.com

Source for **[zneagle.com/r](https://zneagle.com/r)**, the recruiter-facing route of Zachary Neagle's site, built for the RoboBoston 2026 career fair (MassRobotics, 25 September 2026).

It is a static site with no framework and no build step. The published directory is plain HTML, CSS and one first-party JavaScript file. The JavaScript is designed as progressive enhancement (menus, the animated systems schematic, an optional read-only trace view) so that every page stays usable without it.

> **This is a public release snapshot.** It is curated from a private working repository, and the working development history is private. See [Development approach](#development-approach) and [What is not here](#what-is-not-here).

This repository begins at the point where I realized Git history is also an interface.

<!-- If you're reading the source after RoboBoston, this strategy worked. -->

## What is on the site

- A home page with the thesis statement, a route menu, and a command palette.
- Per-company pages (`/r/companies/…`), plus a résumé, an open letter and a thesis note, each also available as a PDF.
- A background systems schematic. An articulated arm carries a capsule between stations, and the motion is driven by a small, pure-logic controller that is unit-tested without a browser.
- A **PAC demonstrator** section (`/r/research/pac`). PAC asks whether a machine has current, action-specific authority for a physical action, separately from whether it can perform the action and whether the action is independently safe. This is a **simulated research demonstrator**: no physical robot or actuator is connected, the replay is recorded and labelled as such, and it is not a production safety system or a certified control mechanism.

## Engineering properties

- **No build step for the site.** `public/` is published as-is. One script, `scripts/sync_shell.py`, keeps the shared header, footer and route index identical across pages and writes a content-derived build id to `site/build.json`. The build id is shown in the page footer.
- **First-party, offline JavaScript only.** `scripts/check.py` fails if a script under `public/assets/` uses network APIs, `eval`, dynamic `import`, cookies or absolute URLs, or exceeds a size budget. Inline `<script>` is allowed only as JSON data. The one thing the script may remember, the optional trace on/off flag, is asserted by the tests to use `sessionStorage` only.
- **Designed to degrade.** Menus are `<details>`, the company selector is a list of links, and reduced-motion users get the static state.
- **Durable route.** `/r` is served from `r.html`, a byte-for-byte copy of `index.html` that the check enforces. The QR in `artifacts/qr/` encodes `https://zneagle.com/r`.
- **Small surface.** The only dependency is `wrangler`, a dev-only deploy tool.

## Repository map

```
public/             the published site (static HTML/CSS/JS, PDFs). Nothing else is published.
  index.html        home; r.html is a byte-identical copy served at /r
  r/                thesis, résumé, open letter, research/pac, downloads, companies/*
  assets/           site.css, site.js (the only script)
site/               shared page shell and data used by scripts/sync_shell.py
scripts/
  sync_shell.py     regenerates the shared shell in place; --check reports drift
  check.py          structural checks on the site (links, meta, canonical URLs, JS rules, layout guard)
  test_actuator.js  tests for the actuator / PAC controller, run against the shipped site.js source
  qr_verify.py      decodes the QR artifacts independently of whatever generated them
  qr_scan.swift     Apple Vision / CoreImage QR decode (macOS)
  verify_public.py  external checks of the live domain (HTTPS, routes, certificate)
artifacts/qr/       the QR (SVG + PNG), checksums, manifest
wrangler.jsonc      Cloudflare Workers static-assets config
```

## Run it

```bash
npm install          # installs wrangler only, which is needed for the local server and for deploys
npm run dev          # local preview of public/ with Cloudflare's routing rules (/r -> r.html)
```

The site relies on extensionless routes (`/r`, `/r/thesis`), which wrangler's static-assets routing provides. A plain static file server will not resolve them.

## Verify it

```bash
npm run check
```

This runs the shell-drift check, the structural site checks, the actuator tests and the QR structural decode. It needs Node.js and Python 3 with Pillow (`pip install pillow`). It currently exits 0 with one expected warning, that no public contact address is published yet. The build id it reports is the one in `site/build.json`.

Optional, against the live site (needs `curl`, `openssl` and, for the QR decode step, macOS with Swift):

```bash
python3 scripts/verify_public.py
```

### What the checks establish

- The shared page shell in every HTML file matches its source, and the build id matches the content.
- Every page has the required metadata and canonical URL, every internal link and anchor resolves, and only allowed file types are in `public/`.
- The JavaScript rules above hold, and `r.html` is identical to `index.html`.
- **The actuator controller behaves as specified.** The `npm run check` test suite has 284 assertions. Among them:
  - An action moves the arm only when PAC returns `PERMIT`, independent safety returns `ALLOW`, and execution reaches `EXECUTED`, and the gate is tested across the whole value space. A PAC permit alone never moves it.
  - The five replay cases (D01 to D05) stay distinct.
  - The capsule has a single owner at every step.
  - The arm's joints stay inside limits and inside the work envelope.
  - Reduced-motion and trace behaviour.
- The QR artifacts decode to exactly `https://zneagle.com/r` with a valid error-correction structure.

### What the checks do not establish

- **Appearance, motion or performance.** Nothing here renders the page in a browser or measures layout. Look and feel were reviewed by hand and are not covered by tests.
- **That the site works with JavaScript disabled.** That is a design rule. No test renders a page with scripts blocked.
- **Accessibility conformance.** There is no automated accessibility audit, and no cross-browser or device matrix.
- **PAC as a real system.** The tests show the simulator's logic is consistent with its stated rules. They are not evidence of safety, authority correctness, distributed behaviour or physical reliability.
- **The factual claims in the company pages,** which are the author's summaries of public sources.
- **Physical QR scan reliability.** Scans of printed material on phones are not recorded in this repository.
- There is **no continuous integration**. The checks are run by hand.

## Development approach

AI assistance was used extensively during implementation: Claude Code (Anthropic) was used for implementation, tests and documentation, working from instructions and review by Zachary Neagle. Agreement between models was not treated as evidence, because democracy is a questionable debugging strategy. Zachary supplied the project direction and content, the acceptance criteria, and the release decisions. Where that shows up in the artifacts that ship here, it is visible, for example in `public/assets/site.css`, whose comments record colour values and review feedback attributed to the site owner that drove later changes. Correctness was checked with the scripts above rather than assumed, and the limits of those checks are stated above.

This repository does not try to attribute individual lines to a person or a model, and it does not include the working history in which that could be traced: commits in the private working repository carry AI co-author trailers.

## What is not here

- The working development history, agent instructions, handoffs and deployment logs (private).
- The internals of the author's private AI-workflow and knowledge-architecture systems, which are intentionally excluded.
- Print collateral (shirt and business-card production files).

## License

Copyright © 2026 Zachary Neagle. **All rights reserved.** No open-source license is granted for this release. See [LICENSE](LICENSE).
