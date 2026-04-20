#!/usr/bin/env python3
"""
Build a commit-by-commit curation ledger for reconstructing a public-safe branch
from a mixed private history.

Default action meanings:
- pass: safe to replay as-is
- rewrite-msg: safe paths, but commit message/body contains sensitive metadata
- split: mixed commit touching both public-safe and sensitive paths
- drop: commit only touches forbidden paths

This script is intentionally conservative. It should over-classify into review
buckets rather than let private/infra details leak into the public ledger.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from collections import Counter
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable


REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT_DIR = REPO_ROOT / ".omx" / "history-curation"


INFRA_PATH_PATTERNS = [
    r"^infra/",
    r"^deploy/",
    r"^\.github/scripts/",
    r"^\.github/workflows/deploy-.*\.yml$",
    r"^\.github/workflows/rollback\.yml$",
    r"^docker/PRODUCTION\.md$",
    r"^docker-compose\.prod\.yml$",
    r"^docker/docker-compose\.prod\.yml$",
    r"^docs/cloudformation/",
]

PRIVATE_PATH_PATTERNS = [
    r"^backend/src/billing/",
    r"^backend/src/integrations/forge-discovery\.service\.ts$",
    r"^packages/jira-forge-app/",
    r"^backend/src/providers/",
    r"^worker/src/providers/",
    r"^frontend/src/app/cloud",
    r"^backend/src/composition/.*cloud",
    r"^worker/src/temporal/workers/.*cloud",
    r"^\.instances/",
    r"^\.omx/",
    r"^\.omc/",
    r"^scratch/",
    r"^\.playground/",
    r"^docker/certs/",
]

INFRA_MESSAGE_PATTERNS = [
    r"\binfra\b",
    r"\bterraform\b",
    r"\bhelm\b",
    r"\bk8s\b",
    r"\bkubernetes\b",
    r"\bgke\b",
    r"\bdeploy\b",
    r"\bstaging\b",
    r"\bprod\b",
    r"\bproduction\b",
    r"\bworkload identity\b",
    r"\barc runners?\b",
    r"\bshipsec-system\b",
    r"\bshipsec-prod\b",
]

PRIVATE_MESSAGE_PATTERNS = [
    r"\bbilling\b",
    r"\bbifrost\b",
    r"\blitellm\b",
    r"\bforge\b",
    r"\bjira\b",
    r"\bhotplug\b",
    r"\bvirtual key\b",
    r"\binternal/billing\b",
    r"\bhosted-only\b",
    r"\bcloud-only\b",
    r"\bplatform service token\b",
    r"\bgh_packages_token\b",
]


@dataclass
class CommitRecord:
    sha: str
    subject: str
    body: str
    files: list[str]
    infra_paths: list[str]
    private_paths: list[str]
    has_infra_message: bool
    has_private_message: bool
    action: str
    reason: str


def run_git(*args: str) -> str:
    return subprocess.check_output(["git", *args], cwd=REPO_ROOT, text=True).strip()


def compile_many(patterns: Iterable[str]) -> list[re.Pattern[str]]:
    return [re.compile(pattern, re.IGNORECASE) for pattern in patterns]


INFRA_PATH_RES = compile_many(INFRA_PATH_PATTERNS)
PRIVATE_PATH_RES = compile_many(PRIVATE_PATH_PATTERNS)
INFRA_MSG_RES = compile_many(INFRA_MESSAGE_PATTERNS)
PRIVATE_MSG_RES = compile_many(PRIVATE_MESSAGE_PATTERNS)


def matches_any(path: str, patterns: list[re.Pattern[str]]) -> bool:
    return any(pattern.search(path) for pattern in patterns)


def message_matches(text: str, patterns: list[re.Pattern[str]]) -> bool:
    return any(pattern.search(text) for pattern in patterns)


def classify_commit(
    files: list[str],
    has_infra_message: bool,
    has_private_message: bool,
) -> tuple[str, str, list[str], list[str]]:
    infra_paths = [path for path in files if matches_any(path, INFRA_PATH_RES)]
    private_paths = [path for path in files if matches_any(path, PRIVATE_PATH_RES)]
    sensitive_paths = set(infra_paths + private_paths)
    public_paths = [path for path in files if path not in sensitive_paths]

    if sensitive_paths and not public_paths:
        return "drop", "only-sensitive-paths", infra_paths, private_paths
    if sensitive_paths and public_paths:
        return "split", "mixed-public-and-sensitive-paths", infra_paths, private_paths
    if has_infra_message or has_private_message:
        return "rewrite-msg", "message-sanitization", infra_paths, private_paths
    return "pass", "safe", infra_paths, private_paths


def get_commit_files(commit: str) -> list[str]:
    output = subprocess.check_output(
        ["git", "show", "--name-only", "--pretty=format:", commit],
        cwd=REPO_ROOT,
        text=True,
    )
    return [line.strip() for line in output.splitlines() if line.strip()]


def get_commit_subject(commit: str) -> str:
    return run_git("show", "-s", "--format=%s", commit)


def get_commit_body(commit: str) -> str:
    return run_git("show", "-s", "--format=%b", commit)


def build_records(base_ref: str, source_ref: str) -> list[CommitRecord]:
    merge_base = run_git("merge-base", base_ref, source_ref)
    commit_list = run_git("rev-list", "--reverse", f"{merge_base}..{source_ref}").splitlines()
    records: list[CommitRecord] = []

    for commit in commit_list:
        subject = get_commit_subject(commit)
        body = get_commit_body(commit)
        files = get_commit_files(commit)
        message_text = f"{subject}\n{body}"
        has_infra_message = message_matches(message_text, INFRA_MSG_RES)
        has_private_message = message_matches(message_text, PRIVATE_MSG_RES)
        action, reason, infra_paths, private_paths = classify_commit(
            files, has_infra_message, has_private_message
        )
        records.append(
            CommitRecord(
                sha=commit,
                subject=subject,
                body=body,
                files=files,
                infra_paths=infra_paths,
                private_paths=private_paths,
                has_infra_message=has_infra_message,
                has_private_message=has_private_message,
                action=action,
                reason=reason,
            )
        )

    return records


def write_outputs(output_dir: Path, base_ref: str, source_ref: str, records: list[CommitRecord]) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    summary = Counter(record.action for record in records)

    (output_dir / "commit-ledger.json").write_text(
        json.dumps(
            {
                "base_ref": base_ref,
                "source_ref": source_ref,
                "total": len(records),
                "summary": dict(summary),
                "records": [asdict(record) for record in records],
            },
            indent=2,
        )
        + "\n"
    )

    md_lines = [
        "# Public History Curation Ledger",
        "",
        f"- Base ref: `{base_ref}`",
        f"- Source ref: `{source_ref}`",
        f"- Total commits evaluated: `{len(records)}`",
        f"- `pass`: `{summary['pass']}`",
        f"- `rewrite-msg`: `{summary['rewrite-msg']}`",
        f"- `split`: `{summary['split']}`",
        f"- `drop`: `{summary['drop']}`",
        "",
        "## First 120 decisions",
        "",
        "| Action | SHA | Subject | Reason |",
        "|---|---|---|---|",
    ]

    for record in records[:120]:
        subject = record.subject.replace("|", "\\|")
        md_lines.append(
            f"| `{record.action}` | `{record.sha[:8]}` | {subject} | `{record.reason}` |"
        )

    (output_dir / "commit-ledger.md").write_text("\n".join(md_lines) + "\n")

    for action in ("pass", "rewrite-msg", "split", "drop"):
        action_lines = [
            record.sha for record in records if record.action == action
        ]
        (output_dir / f"{action}.txt").write_text("\n".join(action_lines) + ("\n" if action_lines else ""))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-ref", default="public/main")
    parser.add_argument("--source-ref", default="private/main")
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR))
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    output_dir = Path(args.output_dir)
    records = build_records(args.base_ref, args.source_ref)
    write_outputs(output_dir, args.base_ref, args.source_ref, records)

    summary = Counter(record.action for record in records)
    print(f"Evaluated {len(records)} commits from {args.source_ref} over {args.base_ref}")
    for action in ("pass", "rewrite-msg", "split", "drop"):
        print(f"{action}: {summary[action]}")
    print(f"Outputs: {output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
