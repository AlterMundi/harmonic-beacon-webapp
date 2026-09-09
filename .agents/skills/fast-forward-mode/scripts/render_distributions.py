#!/usr/bin/env python3
"""Render deterministic Codex and Hermes SKILL.md distributions."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


SKILL_DIR = Path(__file__).resolve().parent.parent
METADATA_PATH = SKILL_DIR / "source" / "metadata.json"
BODY_PATH = SKILL_DIR / "source" / "body.md"
CODEX_PATH = SKILL_DIR / "SKILL.md"
HERMES_PATH = SKILL_DIR / "distributions" / "hermes" / "fast-forward-mode" / "SKILL.md"


def scalar(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def sequence(values: list[str]) -> str:
    return "[" + ", ".join(scalar(value) for value in values) + "]"


def validate(metadata: dict, body: str) -> None:
    required = {"name", "description", "version", "author", "license", "platforms", "hermes"}
    missing = required - metadata.keys()
    if missing:
        raise ValueError(f"missing metadata keys: {sorted(missing)}")
    if metadata["name"] != "fast-forward-mode":
        raise ValueError("unexpected skill name")
    if not isinstance(metadata["platforms"], list) or not metadata["platforms"]:
        raise ValueError("platforms must be a non-empty list")
    hermes = metadata["hermes"]
    if not isinstance(hermes, dict) or not isinstance(hermes.get("tags"), list):
        raise ValueError("hermes.tags must be a list")
    if not body.startswith("# Fast Forward Mode Skill\n"):
        raise ValueError("canonical body has an unexpected title")
    if "---\n" in body:
        raise ValueError("canonical body must not contain frontmatter")


def shared_metadata(metadata: dict, *, indent: str = "") -> list[str]:
    hermes = metadata["hermes"]
    return [
        f"{indent}hermes:",
        f"{indent}  tags: {sequence(hermes['tags'])}",
        f"{indent}  category: {scalar(hermes['category'])}",
        f"{indent}  related_skills: {sequence(hermes['related_skills'])}",
    ]


def render_codex(metadata: dict, body: str) -> str:
    lines = [
        "---",
        f"name: {metadata['name']}",
        f"description: {scalar(metadata['description'])}",
        f"license: {metadata['license']}",
        "metadata:",
        f"  version: {scalar(metadata['version'])}",
        f"  author: {scalar(metadata['author'])}",
        f"  platforms: {sequence(metadata['platforms'])}",
        *shared_metadata(metadata, indent="  "),
        "---",
        "",
    ]
    return "\n".join(lines) + "\n" + body.rstrip() + "\n"


def render_hermes(metadata: dict, body: str) -> str:
    lines = [
        "---",
        f"name: {metadata['name']}",
        f"description: {scalar(metadata['description'])}",
        f"version: {metadata['version']}",
        f"author: {scalar(metadata['author'])}",
        f"license: {metadata['license']}",
        f"platforms: {sequence(metadata['platforms'])}",
        "metadata:",
        *shared_metadata(metadata, indent="  "),
        "---",
        "",
    ]
    return "\n".join(lines) + "\n" + body.rstrip() + "\n"


def expected_outputs() -> dict[Path, str]:
    metadata = json.loads(METADATA_PATH.read_text(encoding="utf-8"))
    body = BODY_PATH.read_text(encoding="utf-8")
    validate(metadata, body)
    return {
        CODEX_PATH: render_codex(metadata, body),
        HERMES_PATH: render_hermes(metadata, body),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="fail if generated files have drifted")
    args = parser.parse_args()
    drifted: list[str] = []
    for path, expected in expected_outputs().items():
        if args.check:
            if not path.exists() or path.read_text(encoding="utf-8") != expected:
                drifted.append(str(path.relative_to(SKILL_DIR)))
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(expected, encoding="utf-8")
    if drifted:
        print("generated skill distributions are stale: " + ", ".join(drifted))
        return 1
    if args.check:
        print("generated skill distributions are current")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
