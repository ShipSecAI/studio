#!/usr/bin/env python3
"""
Replay a curated public-safe history from a commit-ledger produced by
curate_public_history.py.

The replay strategy is intentionally linear and conservative:
- Base branch starts from `base_ref`
- For each curated commit, apply only the allowed file changes relative to the
  commit's first parent
- Drop commits classified as `drop`
- Use sanitized single-line commit messages for `rewrite-msg` and `split`
- Preserve author and authored-at timestamps

This avoids path leaks from mixed private/infra commits while still keeping a
long, auditable commit trace.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
from pathlib import Path
from typing import Iterable


REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_LEDGER = REPO_ROOT / ".omx" / "history-curation" / "commit-ledger.json"

SANITIZE_REPLACEMENTS = [
    (re.compile(r"\binfra\b", re.I), "runtime"),
    (re.compile(r"\bterraform\b", re.I), "config"),
    (re.compile(r"\bhelm\b", re.I), "release"),
    (re.compile(r"\bk8s\b", re.I), "runtime"),
    (re.compile(r"\bkubernetes\b", re.I), "runtime"),
    (re.compile(r"\bgke\b", re.I), "runtime"),
    (re.compile(r"\bdeploy\b", re.I), "release"),
    (re.compile(r"\bstaging\b", re.I), "environment"),
    (re.compile(r"\bprod\b", re.I), "environment"),
    (re.compile(r"\bproduction\b", re.I), "environment"),
    (re.compile(r"\barc runners?\b", re.I), "ci runners"),
    (re.compile(r"\bbilling\b", re.I), "usage"),
    (re.compile(r"\bbifrost\b", re.I), "ai gateway"),
    (re.compile(r"\bforge\b", re.I), "jira"),
    (re.compile(r"\bhotplug\b", re.I), "tool runtime"),
]


def run_git(*args: str, check: bool = True, capture: bool = True, env: dict[str, str] | None = None):
    return subprocess.run(
        ["git", *args],
        cwd=REPO_ROOT,
        check=check,
        capture_output=capture,
        text=True,
        env=env,
    )


def read_ledger(path: Path) -> dict:
    return json.loads(path.read_text())


def sanitize_subject(subject: str) -> str:
    result = subject
    for pattern, replacement in SANITIZE_REPLACEMENTS:
        result = pattern.sub(replacement, result)
    result = re.sub(r"\s+", " ", result).strip()
    if len(result) > 72:
        result = result[:69].rstrip() + "..."
    return result


def commit_parents(commit: str) -> list[str]:
    out = run_git("rev-list", "--parents", "-n", "1", commit).stdout.strip().split()
    return out[1:]


def diff_name_status(parent: str, commit: str) -> list[list[str]]:
    out = run_git("diff", "--name-status", "-M", parent, commit).stdout
    rows = []
    for line in out.splitlines():
      parts = line.split("\t")
      if parts:
        rows.append(parts)
    return rows


def classify_allowed_entries(record: dict, diff_rows: list[list[str]]) -> list[list[str]]:
    blocked = set(record["infra_paths"]) | set(record["private_paths"])
    allowed = []
    for row in diff_rows:
        status = row[0]
        paths = row[1:]
        if status.startswith("R") or status.startswith("C"):
            old_path, new_path = paths
            if old_path not in blocked or new_path not in blocked:
                allowed.append(row)
        else:
            path = paths[0]
            if path not in blocked:
                allowed.append(row)
    return allowed


def apply_entry(commit: str, row: list[str]) -> None:
    status = row[0]
    paths = row[1:]

    if status.startswith("R") or status.startswith("C"):
        old_path, new_path = paths
        run_git("rm", "-f", "--ignore-unmatch", old_path, check=False)
        checkout = run_git("checkout", commit, "--", new_path, check=False)
        if checkout.returncode != 0:
            raise RuntimeError(checkout.stderr.strip() or f"failed to checkout {new_path} from {commit}")
        run_git("add", new_path)
        return

    path = paths[0]
    if status == "D":
        run_git("rm", "-f", "--ignore-unmatch", path, check=False)
        return

    checkout = run_git("checkout", commit, "--", path, check=False)
    if checkout.returncode != 0:
        raise RuntimeError(checkout.stderr.strip() or f"failed to checkout {path} from {commit}")
    run_git("add", path)


def has_staged_changes() -> bool:
    result = run_git("diff", "--cached", "--quiet", check=False, capture=False)
    return result.returncode != 0


def commit_metadata(commit: str) -> tuple[str, str, str]:
    fmt = "%an%n%ae%n%aI"
    out = run_git("show", "-s", f"--format={fmt}", commit).stdout.splitlines()
    return out[0], out[1], out[2]


def make_commit(commit: str, action: str, subject: str) -> None:
    author_name, author_email, author_date = commit_metadata(commit)
    env = os.environ.copy()
    env["GIT_AUTHOR_NAME"] = author_name
    env["GIT_AUTHOR_EMAIL"] = author_email
    env["GIT_AUTHOR_DATE"] = author_date
    env["GIT_COMMITTER_DATE"] = author_date

    final_subject = subject if action == "pass" else sanitize_subject(subject)
    run_git("commit", "-m", final_subject, env=env, capture=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ledger", default=str(DEFAULT_LEDGER))
    parser.add_argument("--branch", required=True)
    parser.add_argument("--limit", type=int, default=0, help="Optional max commits to replay")
    parser.add_argument("--from-action", nargs="*", default=["pass", "rewrite-msg", "split"])
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    ledger = read_ledger(Path(args.ledger))
    base_ref = ledger["base_ref"]
    records = ledger["records"]
    allowed_actions = set(args.from_action)

    run_git("checkout", "-B", args.branch, base_ref, capture=True)

    applied = 0
    skipped = 0
    for idx, record in enumerate(records, start=1):
        action = record["action"]
        if action not in allowed_actions:
            skipped += 1
            continue
        if args.limit and applied >= args.limit:
            break

        parents = commit_parents(record["sha"])
        if not parents:
            skipped += 1
            continue
        parent = parents[0]
        allowed_rows = classify_allowed_entries(record, diff_name_status(parent, record["sha"]))
        if not allowed_rows:
            skipped += 1
            continue

        for row in allowed_rows:
            apply_entry(record["sha"], row)

        if not has_staged_changes():
            skipped += 1
            continue

        make_commit(record["sha"], action, record["subject"])
        applied += 1
        if applied % 25 == 0:
            print(f"applied={applied} skipped={skipped} last={record['sha'][:8]} {record['subject']}")

    print(f"done applied={applied} skipped={skipped}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
