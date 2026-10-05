"""Pin image retention boundaries without touching the workstation Docker daemon."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1] / "image-retention.py"
spec = importlib.util.spec_from_file_location("retention", SOURCE)
retention = importlib.util.module_from_spec(spec)
spec.loader.exec_module(retention)
REPO = "ghcr.io/example/shape-of-you-api"


def image(number, repo=REPO):
    return {"id": "sha256:" + f"{number:064x}", "created": f"2026-09-{number:02d}T00:00:00Z",
            "digests": [repo + "@sha256:" + f"{number + 100:064x}"], "tags": []}


def metadata(path):
    path.write_text("\n".join(f"{service}_IMAGE=ghcr.io/example/shape-of-you-{service.lower()}\n{service}_DIGEST=sha256:{'a' * 64}" for service in retention.SERVICES))


class RetentionTests(unittest.TestCase):
    def test_current_previous_candidate_and_containers_survive_with_newest_three(self):
        images = [image(i) for i in range(1, 9)]
        required = [images[0]["digests"][0], images[1]["digests"][0]]
        candidate = [images[2]["digests"][0]]
        # Docker ps -a supplies stopped containers as well as running ones.
        selected = retention.select(images, {images[3]["id"]}, required, candidate, "example")
        self.assertEqual(selected, [images[4]["id"]])

    def test_shared_host_unknown_refs_and_dangling_images_are_excluded(self):
        images = [image(i) for i in range(1, 6)]
        images[0]["digests"].append("other/project@sha256:" + "b" * 64)
        images[1]["tags"].append("other/project:latest")
        images.extend([image(6, "neighbor/backend"), {**image(7), "digests": [], "tags": []}])
        self.assertEqual(retention.select(images, set(), [], [], "example"), [])

    def test_keep_three_per_repository_independently(self):
        images = [image(i) for i in range(1, 6)] + [image(i + 5, "ghcr.io/example/shape-of-you-edge") for i in range(1, 6)]
        self.assertEqual(len(retention.select(images, set(), [], [], "example")), 4)

    def test_missing_protected_image_fails_closed_but_unpulled_candidate_is_allowed(self):
        missing = REPO + "@sha256:" + "f" * 64
        with self.assertRaisesRegex(ValueError, "missing locally"):
            retention.select([image(1)], set(), [missing], [], "example")
        self.assertEqual(retention.select([image(1)], set(), [], [missing], "example"), [])

    def test_metadata_is_not_evaluated_and_duplicates_are_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "release.env"
            metadata(path)
            with path.open("a") as file:
                file.write("\nUNRELATED=$(echo do-not-execute)\n")
            self.assertEqual(len(retention.coordinates(path, "example")), 4)
            with path.open("a") as file:
                file.write("API_DIGEST=sha256:" + "b" * 64 + "\n")
            with self.assertRaisesRegex(ValueError, "Duplicate"):
                retention.coordinates(path, "example")

    def test_release_links_are_strict_and_allow_initial_install(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.assertEqual(retention.release_paths(root), [])
            target = root / "releases" / ("a" * 40)
            target.mkdir(parents=True)
            metadata(target / "release.env")
            (root / "current").symlink_to(target)
            self.assertEqual(retention.release_paths(root), [(target / "release.env").resolve()])
            (root / "previous").symlink_to(root / "missing")
            with self.assertRaises(OSError):
                retention.release_paths(root)

    def test_fractional_timestamp_precision_and_offsets_protect_actual_newest(self):
        images = [image(i) for i in range(1, 6)]
        for item, timestamp in zip(images, ["2026-10-06T00:00:00Z", "2026-10-06T00:00:00.1Z", "2026-10-06T00:00:00.11Z", "2026-10-06T00:00:00.9Z", "2026-10-06T02:00:00.900000001+02:00"]):
            item["created"] = timestamp
        self.assertEqual(retention.select(images, set(), [], [], "example"), [images[0]["id"], images[1]["id"]])
        for invalid in ["2026-10-06", "2026-02-30T00:00:00Z", "2026-10-06T00:00:00.1234567890Z"]:
            with self.assertRaises(ValueError):
                retention.select([{**image(1), "created": invalid}], set(), [], [], "example")

    def test_legacy_pre_identity_metadata_is_allowed(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "release.env"
            metadata(path)
            path.write_text("\n".join(line for line in path.read_text().splitlines() if not line.startswith("IDENTITY_")))
            self.assertEqual(len(retention.coordinates(path, "example")), 3)
            path.write_text(path.read_text() + "\nIDENTITY_IMAGE=\nIDENTITY_DIGEST=\n")
            self.assertEqual(len(retention.coordinates(path, "example")), 3)

    def test_zero_bytes_or_inodes_are_reported_as_failure(self):
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as tmp:
            for available, inodes in [(0, 20), (20, 0)]:
                with patch.object(retention.os, "statvfs", return_value=SimpleNamespace(f_bavail=available, f_frsize=4096, f_favail=inodes)), self.assertRaisesRegex(ValueError, "no free bytes or inodes"):
                    self.run_main(tmp)

    def test_apply_requires_lock_before_docker_or_deletion(self):
        with patch("sys.argv", [str(SOURCE), "--root", "/unused", "--candidate", "/unused", "--namespace", "example", "--apply"]), patch.dict(os.environ, {}, clear=True), patch.object(retention, "docker") as docker:
            with self.assertRaisesRegex(ValueError, "lock"):
                retention.main()
            docker.assert_not_called()

    def run_main(self, tmp, apply=False, changing=False, failing=False, calls=None):
        root = Path(tmp)
        candidate = root / "candidate.env"
        metadata(candidate)
        images = [image(i) for i in range(1, 6)]
        calls = [] if calls is None else calls
        def fake_docker(*args):
            calls.append(args)
            if args[0:2] == ("image", "rm") and failing and len([c for c in calls if c[:2] == ("image", "rm")]) == 2:
                raise subprocess.CalledProcessError(1, ["docker", *args])
            return str(root)
        argv = [str(SOURCE), "--root", str(root), "--candidate", str(candidate), "--namespace", "example"] + (["--apply"] if apply else [])
        snapshots = [(images, set()), ([image(6), *images], set()) if changing else (images, set())]
        with patch("sys.argv", argv), patch.dict(os.environ, {"SHAPE_OF_YOU_STAGING_LOCK_HELD": "true"}), patch.object(retention, "inventory", side_effect=snapshots), patch.object(retention, "docker", side_effect=fake_docker), contextlib.redirect_stdout(io.StringIO()):
            retention.main()
        return calls

    def test_default_dry_run_never_mutates_and_apply_uses_exact_ids_without_force(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertFalse(any(c[:2] == ("image", "rm") for c in self.run_main(tmp)))
            calls = self.run_main(tmp, apply=True)
            self.assertEqual([c for c in calls if c[:2] == ("image", "rm")], [("image", "rm", image(1)["id"]), ("image", "rm", image(2)["id"])])

    def test_changed_inventory_and_partial_failure_stop_cleanup(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(ValueError, "changed"):
                self.run_main(tmp, apply=True, changing=True)
            calls = []
            with self.assertRaises(subprocess.CalledProcessError):
                self.run_main(tmp, apply=True, failing=True, calls=calls)
            self.assertEqual([c for c in calls if c[:2] == ("image", "rm")], [("image", "rm", image(1)["id"]), ("image", "rm", image(2)["id"])])

    def test_real_cli_with_fake_docker_dry_run_and_apply(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            metadata(root / "candidate.env")
            data = [image(i) for i in range(1, 6)]
            (root / "images.json").write_text(json.dumps(data))
            fake = root / "docker"
            fake.write_text("#!/usr/bin/env python3\n" + "import json, os, sys\nfrom pathlib import Path\np=Path(os.environ['FAKE_DOCKER_ROOT'])\na=sys.argv[1:]\nwith (p/'calls.jsonl').open('a') as f: f.write(json.dumps(a)+'\\n')\nimages=json.loads((p/'images.json').read_text())\nif a[:2]==['image','ls']: print('\\n'.join(i['id'] for i in images))\nelif a[:2]==['image','inspect']: print('\\n'.join(json.dumps(i) for i in images))\nelif a==['ps','-aq']: pass\nelif a==['info','--format','{{.DockerRootDir}}']: print(p)\nelif len(a)==3 and a[:2]==['image','rm']: pass\nelse: raise SystemExit('Unexpected operation')\n")
            fake.chmod(0o755)
            env = {**os.environ, "PATH": str(root) + os.pathsep + os.environ["PATH"], "FAKE_DOCKER_ROOT": str(root), "SHAPE_OF_YOU_STAGING_LOCK_HELD": "true"}
            command = [sys.executable, str(SOURCE), "--root", str(root), "--candidate", str(root / "candidate.env"), "--namespace", "example"]
            dry = subprocess.run(command, env=env, text=True, capture_output=True, check=True)
            self.assertEqual(json.loads(dry.stdout.splitlines()[0])["mode"], "dry-run")
            dry_calls = [json.loads(line) for line in (root / "calls.jsonl").read_text().splitlines()]
            self.assertFalse(any(a[:2] == ["image", "rm"] for a in dry_calls))
            applied = subprocess.run([*command, "--apply"], env=env, text=True, capture_output=True, check=True)
            self.assertEqual(json.loads(applied.stdout.splitlines()[1])["removedImages"], 2)
            calls = [json.loads(line) for line in (root / "calls.jsonl").read_text().splitlines()]
            self.assertEqual([a for a in calls if a[:2] == ["image", "rm"]], [["image", "rm", image(1)["id"]], ["image", "rm", image(2)["id"]]])

    def test_deploy_runs_locked_retention_before_pull_and_requires_python(self):
        deploy = (SOURCE.parent / "deployment-controller.sh").read_text()
        self.assertLess(deploy.index('python3 "$CONTROL_STAGING/scripts/image-retention.py"'), deploy.index('sh "$CONTROL_STAGING/scripts/deploy.sh"'))
        self.assertIn("--apply", deploy)
        self.assertIn("command -v python3", (SOURCE.parent / "vm-preflight.sh").read_text())


if __name__ == "__main__":
    unittest.main()
