#!/usr/bin/env python3
"""Bound Shape image retention under the existing deployment lock; never prune volumes."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import subprocess
import sys

SHA = re.compile(r"sha256:[0-9a-f]{64}\Z")
RELEASE = re.compile(r"[0-9a-f]{40}\Z")
SERVICES = ("API", "IDENTITY", "EDGE", "CERTBOT")
FORMAT = '{"id":{{json .Id}},"created":{{json .Created}},"digests":{{json .RepoDigests}},"tags":{{json .RepoTags}}}'


def docker(*args):
    """Run bounded metadata or exact-image operations without printing daemon payloads."""
    return subprocess.check_output(["docker", *args], text=True, timeout=120)


def coordinates(path, namespace):
    """Read only strict image coordinates from trusted release metadata, without evaluation."""
    values = {}
    for line in path.read_text().splitlines():
        key, separator, value = line.partition("=")
        if separator and key in {s + suffix for s in SERVICES for suffix in ("_IMAGE", "_DIGEST")}:
            if key in values:
                raise ValueError("Duplicate release image coordinate")
            values[key] = value
    result = []
    for service in SERVICES:
        image, digest = values.get(service + "_IMAGE"), values.get(service + "_DIGEST")
        if service == "IDENTITY" and not image and not digest:
            continue  # Releases predating Identity remain valid rollback metadata.
        if image != f"ghcr.io/{namespace}/shape-of-you-{service.lower()}" or not digest or not SHA.fullmatch(digest):
            raise ValueError("Missing or unsafe release image coordinate")
        result.append(image + "@" + digest)
    return result


def release_paths(root):
    """Validate current/previous links without reading runtime credentials."""
    paths = []
    for name in ("current", "previous"):
        link = root / name
        if not link.exists() and not link.is_symlink():
            if name == "current" and (root / "previous").exists():
                raise ValueError("Previous exists without current")
            continue  # Initial installation or no prior rollback release.
        if not link.is_symlink():
            raise ValueError("Release pointer is not a symlink")
        target = link.resolve(strict=True)
        if target.parent != (root / "releases").resolve() or not RELEASE.fullmatch(target.name):
            raise ValueError("Release pointer is outside the release directory")
        metadata = target / "release.env"
        if metadata.is_symlink() or not metadata.is_file():
            raise ValueError("Release metadata is missing or unsafe")
        paths.append(metadata)
    return paths


def inventory():
    """Fetch only image identities/references and container image IDs; never inspect env."""
    ids = sorted(set(docker("image", "ls", "-aq", "--no-trunc").split()))
    if any(not SHA.fullmatch(i) for i in ids):
        raise ValueError("Invalid Docker image identity")
    images = []
    for start in range(0, len(ids), 100):
        images.extend(json.loads(line) for line in docker("image", "inspect", "--format", FORMAT, *ids[start:start + 100]).splitlines())
    containers = docker("ps", "-aq").split()
    used = set(docker("inspect", "--format", "{{.Image}}", *containers).split()) if containers else set()
    return images, used


def created_key(image):
    """Order Docker RFC3339 timestamps by instant and nanoseconds, failing closed on ambiguity."""
    match = re.fullmatch(r"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})", image["created"])
    if not match:
        raise ValueError("Invalid Docker image creation timestamp")
    instant = datetime.fromisoformat(match[1] + ("+00:00" if match[3] == "Z" else match[3])).astimezone(timezone.utc)
    delta = instant - datetime(1970, 1, 1, tzinfo=timezone.utc)
    return delta.days * 86400 + delta.seconds, int((match[2] or "").ljust(9, "0")), image["id"]


def select(images, used, required, candidate, namespace):
    """Return exact deletable IDs, preserving release references, containers and three newest per repo."""
    allowed = {f"ghcr.io/{namespace}/shape-of-you-{s.lower()}" for s in SERVICES}
    protected = set(used)
    groups = {repo: [] for repo in allowed}
    found = set()
    for image in images:
        if not SHA.fullmatch(image["id"]):
            raise ValueError("Invalid inspected image identity")
        created_key(image)
        digests, tags = image["digests"] or [], image["tags"] or []
        names = {s.split("@")[0] for s in digests} | {s.rsplit(":", 1)[0] for s in tags}
        found.update(set(digests) & set(required))
        if not names or not names.issubset(allowed) or set(digests) & (set(required) | set(candidate)):
            protected.add(image["id"])
        for name in names & allowed:
            groups[name].append(image)
    if set(required) - found:
        raise ValueError("Protected release image is missing locally")
    for group in groups.values():
        protected.update(i["id"] for i in sorted(group, key=created_key, reverse=True)[:3])
    return sorted(i["id"] for i in images if i["id"] not in protected)


def main():
    """Default to dry-run; apply only with the root-managed deployment lock held."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--namespace", required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if not re.fullmatch(r"[a-z0-9][a-z0-9_.-]*", args.namespace):
        raise ValueError("Invalid registry namespace")
    if args.apply and os.environ.get("SHAPE_OF_YOU_STAGING_LOCK_HELD") != "true":
        raise ValueError("Root-managed deployment lock is required")
    paths = release_paths(args.root)
    required = [c for path in paths for c in coordinates(path, args.namespace)]
    candidate = coordinates(args.candidate, args.namespace)
    images, used = inventory()
    chosen = select(images, used, required, candidate, args.namespace)
    print(json.dumps({"mode": "apply" if args.apply else "dry-run", "candidateImageIds": chosen}), flush=True)
    if args.apply:
        # Revalidate the entire planned deletion set immediately before the first mutation.
        fresh_paths = release_paths(args.root)
        fresh_required = [c for path in fresh_paths for c in coordinates(path, args.namespace)]
        fresh_candidate = coordinates(args.candidate, args.namespace)
        fresh_images, fresh_used = inventory()
        if paths != fresh_paths or required != fresh_required or candidate != fresh_candidate or chosen != select(fresh_images, fresh_used, fresh_required, fresh_candidate, args.namespace):
            raise ValueError("Retention inventory changed; deletion refused")
        for image_id in chosen:
            docker("image", "rm", image_id)  # No force: Docker also protects container references.
        print(json.dumps({"removedImages": len(chosen)}), flush=True)
    root_dir = docker("info", "--format", "{{.DockerRootDir}}").strip()
    stat = os.statvfs(root_dir)
    print(json.dumps({"availableBytes": stat.f_bavail * stat.f_frsize, "availableInodes": stat.f_favail}), flush=True)
    if stat.f_bavail == 0 or stat.f_favail == 0:
        raise ValueError("Docker filesystem has no free bytes or inodes")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, subprocess.SubprocessError):
        print("Image retention failed; inspect metadata, Docker references and disk availability before retry.", file=sys.stderr)
        sys.exit(1)
