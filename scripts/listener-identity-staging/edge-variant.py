#!/usr/bin/env python3
"""Recognize the reviewed staging vhost and the exact selected brand variant."""
import hashlib
from pathlib import Path
import sys

ASSET_SET = Path("/var/lib/harmonic-beacon/brand-assets/78a7acf841691f6dd17a19dd1fb67b595bb124d735079addd959ef2f807ced5b")
ASSETS = {
    "hb-global-nav.js": "3d3916d26d97b5e8591887bebcb349e83bccd6b5fb0c24efd18d1d63fd5cccb1",
    "favicon.ico": "5d60c0a0a028831977d81097fee603a38452a26862f942e125eb8dfe532fe2d7",
}
NAV_START = "    location = /assets/hb-global-nav.js {\n"
PROXY_START = "        proxy_pass http://127.0.0.1:13001;\n"
HEADERS_START = '        add_header Cache-Control "public, max-age=300" always;\n'
BLOCK_END = "    }\n"


def branded_template(template):
    start = template.index(NAV_START) + len(NAV_START)
    end = template.index(BLOCK_END, start)
    nav = template[start:end]
    proxy = nav.index(PROXY_START)
    headers = nav.index(HEADERS_START, proxy)
    access = nav[:proxy]
    security = nav[headers:] + "            add_header X-Frame-Options SAMEORIGIN always;\n"

    def static_location(filename, mime):
        return access + f"        alias {ASSET_SET / filename};\n        default_type {mime};\n" + security

    return (
        template[:start] + static_location("hb-global-nav.js", "application/javascript") + BLOCK_END
        + "\n    location = /favicon.ico {\n" + static_location("favicon.ico", "image/x-icon")
        + template[end:]
    )


def main():
    template = Path(sys.argv[1]).read_bytes().decode()
    active = Path(sys.argv[2]).read_bytes().decode()
    if active == template:
        print("template")
        return
    if active != branded_template(template):
        raise SystemExit("unrecognized staging Nginx configuration")
    for filename, digest in ASSETS.items():
        asset = ASSET_SET / filename
        if asset.resolve() != asset or hashlib.sha256(asset.read_bytes()).hexdigest() != digest:
            raise SystemExit("staging brand asset differs from the approved digest")
    print(ASSETS["hb-global-nav.js"], ASSETS["favicon.ico"])


if __name__ == "__main__":
    main()
