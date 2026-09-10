#!/usr/bin/env python3
"""Render deterministic Codex and Hermes distributions for repository skills."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


SKILLS_DIR = Path(__file__).resolve().parent.parent


def scalar(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def sequence(values: list[str]) -> str:
    return "[" + ", ".join(scalar(value) for value in values) + "]"


def validate(skill_dir: Path, metadata: dict, body: str) -> None:
    required = {"name", "description", "version", "author", "license", "platforms", "hermes"}
    missing = required - metadata.keys()
    if missing:
        raise ValueError(f"{skill_dir.name}: missing metadata keys: {sorted(missing)}")
    if metadata["name"] != skill_dir.name:
        raise ValueError(f"{skill_dir.name}: metadata name does not match directory")
    if not isinstance(metadata["platforms"], list) or not metadata["platforms"]:
        raise ValueError(f"{skill_dir.name}: platforms must be a non-empty list")
    hermes = metadata["hermes"]
    if not isinstance(hermes, dict) or not isinstance(hermes.get("tags"), list):
        raise ValueError(f"{skill_dir.name}: hermes.tags must be a list")
    if not body.startswith("# "):
        raise ValueError(f"{skill_dir.name}: canonical body must start with a title")
    if "---\n" in body:
        raise ValueError(f"{skill_dir.name}: canonical body must not contain frontmatter")


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


def discover(selected: list[str]) -> list[Path]:
    if selected:
        skill_dirs = [SKILLS_DIR / name for name in selected]
    else:
        skill_dirs = sorted(path.parent.parent for path in SKILLS_DIR.glob("*/source/metadata.json"))
    for skill_dir in skill_dirs:
        if not (skill_dir / "source" / "metadata.json").is_file():
            raise ValueError(f"unknown generated skill: {skill_dir.name}")
    return skill_dirs


def expected_outputs(skill_dir: Path) -> dict[Path, str]:
    metadata = json.loads((skill_dir / "source" / "metadata.json").read_text(encoding="utf-8"))
    body = (skill_dir / "source" / "body.md").read_text(encoding="utf-8")
    validate(skill_dir, metadata, body)
    name = metadata["name"]
    return {
        skill_dir / "SKILL.md": render_codex(metadata, body),
        skill_dir / "distributions" / "hermes" / name / "SKILL.md": render_hermes(metadata, body),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="fail if generated files have drifted")
    parser.add_argument("--skill", action="append", default=[], help="render only this skill")
    args = parser.parse_args()
    drifted: list[str] = []
    skill_dirs = discover(args.skill)
    for skill_dir in skill_dirs:
        for path, expected in expected_outputs(skill_dir).items():
            if args.check:
                if not path.exists() or path.read_text(encoding="utf-8") != expected:
                    drifted.append(str(path.relative_to(SKILLS_DIR)))
            else:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(expected, encoding="utf-8")
    if drifted:
        print("generated skill distributions are stale: " + ", ".join(drifted))
        return 1
    if args.check:
        print(f"generated skill distributions are current ({len(skill_dirs)} skills)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
