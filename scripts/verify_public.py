#!/usr/bin/env python3
"""External verification of the live site. Run after the zneagle.com custom domain is attached.

  python3 scripts/verify_public.py                 # production: the URL decoded from the QR
  python3 scripts/verify_public.py --base https://zneagle-com.zneagle-com.workers.dev
  python3 scripts/verify_public.py --resolver 1.1.1.1   # bypass a stale local DNS cache

Checks, all over the public internet with the system trust store (curl):
  1. The QR artifact decodes (Apple Vision) to the URL under test.
  2. / and /r answer 200 over HTTPS on the same host, with bodies byte-identical to public/index.html.
  3. The TLS certificate covers the host; http:// either upgrades to https or is reported.
  4. Repository and private paths return 404.
Exit 0 only if every required check passes.
"""
import argparse
import hashlib
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent.parent
QR_PNG = ROOT / "artifacts" / "qr" / "zneagle-r-qr-H.png"
INDEX = ROOT / "public" / "index.html"
NOT_FOUND = ROOT / "public" / "404.html"
PRIVATE = ["/README.md", "/LICENSE", "/wrangler.jsonc", "/package.json", "/.git/config", "/scripts/check.py",
           "/artifacts/qr/QR_MANIFEST.txt", "/public/index.html", "/.assetsignore"]

results = []
pinned = []  # curl --resolve entries when --resolver is used


def record(ok, label, detail=""):
    results.append(ok)
    print(f"{'PASS' if ok else 'FAIL'}  {label}{'  ' + detail if detail else ''}")


def fetch(url, follow=True):
    args = ["curl", "-sS", "--max-time", "20", "-o", "-", "-w", "\n%{http_code} %{url_effective}", *pinned]
    if follow:
        args.append("-L")
    out = subprocess.run(args + [url], capture_output=True)
    body, _, meta = out.stdout.rpartition(b"\n")
    code, _, final = meta.decode().partition(" ")
    return int(code or 0), final, body


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", help="test this origin instead of the URL decoded from the QR")
    ap.add_argument("--resolver", help="resolve the host through this DNS server instead of the system resolver")
    args = ap.parse_args()

    scan = subprocess.run(["swift", str(ROOT / "scripts" / "qr_scan.swift"), str(QR_PNG)],
                          capture_output=True, text=True).stdout
    decoded = re.findall(r'vision=\["([^"]+)"\]', scan)
    record(bool(decoded), "QR artifact decodes", decoded[0] if decoded else scan.strip())
    qr_url = decoded[0] if decoded else "https://zneagle.com/r"
    r_url = (args.base.rstrip("/") + "/r") if args.base else qr_url
    parts = urlsplit(r_url)
    origin = f"{parts.scheme}://{parts.netloc}"
    host = parts.hostname
    connect = host
    if args.resolver:
        ips = subprocess.run(["dig", "+short", f"@{args.resolver}", host, "A"],
                             capture_output=True, text=True).stdout.split()
        record(bool(ips), f"{host} resolves via {args.resolver}", " ".join(ips))
        if ips:
            connect = ips[0]
            pinned.extend(["--resolve", f"{host}:443:{connect}", "--resolve", f"{host}:80:{connect}"])

    index_sha = sha(INDEX.read_bytes())
    for url in (origin + "/", r_url):
        code, final, body = fetch(url)
        same_host = urlsplit(final).hostname == host and final.startswith("https://")
        record(code == 200 and same_host and sha(body) == index_sha, f"GET {url}",
               f"-> {code} {final} body sha {sha(body)[:12]} (expected {index_sha[:12]})")

    cert = subprocess.run(
        f"echo | openssl s_client -connect {connect}:443 -servername {host} 2>/dev/null"
        " | openssl x509 -noout -subject -issuer -enddate -ext subjectAltName",
        shell=True, capture_output=True, text=True).stdout
    names = re.findall(r"DNS:([^,\s]+)", cert)
    covered = any(n == host or (n.startswith("*.") and host.endswith(n[1:]) and host.count(".") == n.count("."))
                  for n in names)
    record(covered, f"TLS certificate covers {host}", " | ".join(line.strip() for line in cert.splitlines() if line.strip()))

    code, final, _ = fetch(f"http://{host}/r")
    print(f"INFO  http://{host}/r -> {code} {final}"
          + ("" if final.startswith("https://") else "  (no HTTPS upgrade: enable Always Use HTTPS on the zone)"))

    nf_sha = sha(NOT_FOUND.read_bytes())
    for path in PRIVATE:
        code, _, body = fetch(origin + path, follow=False)
        record(code == 404 and sha(body) == nf_sha, f"private path hidden {path}", f"-> {code}")

    print(f"\n{'ALL PASS' if all(results) else 'FAILURES'}: {sum(results)}/{len(results)} checks")
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main())
