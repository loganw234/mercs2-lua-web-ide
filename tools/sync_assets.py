#!/usr/bin/env python3
"""sync_assets.py -- fetch the files this repo VENDORS from other repos, at a pinned version.

Some of what this IDE ships is owned by another repo (Ess's CAPABILITIES.md is the reference the whole
API panel, autocomplete and linter are generated from). Those used to be copied in by hand, which meant
nothing recorded WHICH version had been copied and nothing noticed when it went stale. On 2026-07-25 the
three live copies of CAPABILITIES.md were 25,604 / 23,423 / 19,393 bytes -- source, this fork, and the
base IDE, spanning seven days of drift -- and the only visible symptom was the IDE's own Ess-version
warning firing against a reference three minor versions old.

So: vendor.json pins each borrowed file to a tag and a sha256, and this script is the only thing that
writes them.

    python tools/sync_assets.py              # fetch every asset at its pinned tag, verify the hash
    python tools/sync_assets.py --check      # CI gate, writes nothing (see below)
    python tools/sync_assets.py --update     # repin to each source's newest release tag, then fetch
    python tools/sync_assets.py --offline    # skip all network; local hash check only

--check is deliberately TWO checks with different severities:

  * local integrity (hard fail) -- the file on disk doesn't match the sha256 vendor.json pinned. Means
    someone hand-edited a vendored copy or bumped the pin without syncing. That is a broken repo state
    and blocking on it is correct.
  * upstream freshness (warning) -- the pin is behind the source repo's newest tag. Emitted as a GitHub
    ::warning:: and NOT a failure, because an unrelated repo cutting a release must never break this
    repo's deploy. `--strict` promotes it to a failure; that is what the scheduled vendor-check job uses.

A network failure while checking freshness is reported and ignored, never treated as staleness -- a gate
that fails closed on a flaky network gets disabled by whoever it wakes up at 2am.

Tag discovery goes through `git ls-remote`, not the GitHub API: no token, no 60/hr unauthenticated rate
limit, and it works anywhere git can already reach the remote.
"""
import argparse
import hashlib
import io
import json
import pathlib
import re
import subprocess
import sys
import urllib.error
import urllib.request
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
VENDOR = ROOT / "vendor.json"
RAW = "https://raw.githubusercontent.com/{repo}/{pin}/{remote_path}"
REL = "https://github.com/{repo}/releases/download/{pin}/{asset}"
TIMEOUT = 60

# One release zip can carry several vendored files. Cache the download per run so
# pinning two members of the same zip costs one fetch, not two.
_ZIP_CACHE = {}

# vN.N.N -- the tag shape mercs2-lua-essentials' release workflow creates from Ess.VERSION.
SEMVER_TAG = re.compile(r"^v(\d+)\.(\d+)\.(\d+)$")


def load():
    if not VENDOR.exists():
        die("no vendor.json at %s" % VENDOR)
    try:
        return json.loads(VENDOR.read_text(encoding="utf-8"))
    except ValueError as e:
        die("vendor.json is not valid JSON: %s" % e)


def save(doc):
    """Deterministic, LF-only, trailing newline -- so a Windows and a Linux run produce identical bytes."""
    text = json.dumps(doc, indent=2, ensure_ascii=False) + "\n"
    VENDOR.write_text(text, encoding="utf-8", newline="\n")


def die(msg):
    print("[sync] FATAL: %s" % msg)
    raise SystemExit(2)


def sha256_bytes(b):
    return hashlib.sha256(b).hexdigest()


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "mercs2-sync-assets"})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return r.read()


def fetch(asset):
    """One asset's bytes at its pinned tag. Two shapes:

    * default -- a file committed in the repo, read straight from raw.githubusercontent.
    * source:"release-zip" -- a member of a release artifact. Ess's api/ess.json is
      GENERATED from src/ and deliberately gitignored ("derived, so it must never be
      stale"), so it does not exist at any tag and raw returns 404. It ships inside
      Ess-<version>.zip instead. Pinning the zip is also the more honest target: the
      zip is the artifact their release actually publishes and package.py guarantees
      the manifests are in it -- a separate loose asset can silently go missing, which
      is exactly what happened to v0.4.0.
    """
    if asset.get("source") == "release-zip":
        name = asset["release_asset"].replace("{version}", asset["pin"].lstrip("v"))
        url = REL.format(repo=asset["repo"], pin=asset["pin"], asset=name)
        blob = _ZIP_CACHE.get(url)
        if blob is None:
            blob = get(url)
            _ZIP_CACHE[url] = blob
        try:
            with zipfile.ZipFile(io.BytesIO(blob)) as z:
                return z.read(asset["member"])
        except KeyError:
            die("%s: %s has no member %s. Members: %s"
                % (asset["path"], name, asset["member"],
                   ", ".join(zipfile.ZipFile(io.BytesIO(blob)).namelist()[:12])))
        except zipfile.BadZipFile:
            die("%s: %s did not download as a zip (%d bytes) -- does that release exist?"
                % (asset["path"], name, len(blob)))
    url = RAW.format(repo=asset["repo"], pin=asset["pin"], remote_path=asset["remote_path"])
    return get(url)


def latest_tag(repo):
    """Newest vN.N.N tag on a repo, via git ls-remote. Returns None if there are none.

    Sorted numerically, not lexically -- a plain string sort puts v0.3.10 before v0.3.9.
    """
    out = subprocess.check_output(
        ["git", "ls-remote", "--tags", "https://github.com/%s.git" % repo],
        text=True, stderr=subprocess.DEVNULL, timeout=TIMEOUT)
    versions = []
    for line in out.splitlines():
        ref = line.rsplit("\t", 1)[-1].strip()
        if ref.endswith("^{}"):        # annotated-tag dereference line; the plain ref is already listed
            continue
        m = SEMVER_TAG.match(ref.rsplit("/", 1)[-1])
        if m:
            versions.append((tuple(int(g) for g in m.groups()), ref.rsplit("/", 1)[-1]))
    if not versions:
        return None
    return max(versions)[1]


def local_bytes(asset):
    p = ROOT / asset["path"]
    return p.read_bytes() if p.is_file() else None


def cmd_sync(doc, update=False, offline=False):
    changed = False
    for asset in doc["assets"]:
        label = asset["path"]

        if update and not offline:
            try:
                newest = latest_tag(asset["repo"])
            except Exception as e:
                print("[sync] %s: could not reach %s to repin (%s) -- keeping %s"
                      % (label, asset["repo"], type(e).__name__, asset["pin"]))
                newest = None
            if newest and newest != asset["pin"]:
                print("[sync] %s: repinning %s -> %s" % (label, asset["pin"], newest))
                asset["pin"] = newest
                asset.pop("sha256", None)          # force a re-record against the new tag
                changed = True

        if offline:
            print("[sync] %s: --offline, not fetching" % label)
            continue

        try:
            blob = fetch(asset)
        except urllib.error.HTTPError as e:
            die("%s: HTTP %s fetching %s at %s -- does that tag exist, and is the path right?"
                % (label, e.code, asset.get("remote_path") or asset.get("member"), asset["pin"]))
        except Exception as e:
            die("%s: could not fetch (%s: %s)" % (label, type(e).__name__, e))

        got = sha256_bytes(blob)
        pinned = asset.get("sha256")
        if pinned and pinned != got:
            die("%s: content at %s no longer hashes to the pinned sha256.\n"
                "        pinned %s\n        got    %s\n"
                "        A tag should be immutable -- if it really was re-pointed, re-record with --update."
                % (label, asset["pin"], pinned, got))
        if not pinned:
            asset["sha256"] = got
            changed = True
            print("[sync] %s: recorded sha256 %s" % (label, got[:12]))

        dest = ROOT / asset["path"]
        dest.parent.mkdir(parents=True, exist_ok=True)
        if local_bytes(asset) == blob:
            print("[sync] %s: already current at %s" % (label, asset["pin"]))
        else:
            dest.write_bytes(blob)
            print("[sync] %s: wrote %d bytes from %s@%s" % (label, len(blob), asset["repo"], asset["pin"]))

    if changed:
        save(doc)
        print("[sync] vendor.json updated")
    return 0


def cmd_check(doc, strict=False, offline=False):
    hard, soft = [], []

    for asset in doc["assets"]:
        label = asset["path"]

        # --- local integrity: hard ---
        blob = local_bytes(asset)
        if blob is None:
            hard.append("%s: vendored file is missing -- run: python tools/sync_assets.py" % label)
            continue
        pinned = asset.get("sha256")
        if not pinned:
            hard.append("%s: no sha256 in vendor.json -- run: python tools/sync_assets.py" % label)
            continue
        got = sha256_bytes(blob)
        if got != pinned:
            hard.append("%s: on-disk copy does not match its recorded sha256\n"
                        "          recorded %s\n          on disk  %s\n"
                        "          Either it was hand-edited, or the pin moved without a sync. Fix with:\n"
                        "          python tools/sync_assets.py" % (label, pinned, got))
            continue

        if offline:
            print("[check] %s: [ok] on-disk copy matches its recorded sha256 (--offline: pin not verified "
                  "against %s)" % (label, asset["repo"]))
            continue

        # --- does the recorded sha256 actually BELONG to the pinned tag? hard ---
        # Without this, editing "pin" alone passes every other check: the disk/sha256 pair still agree
        # with each other, they just no longer describe the tag vendor.json claims. Caught exactly that
        # while testing this script -- it cheerfully reported "matches @v0.3.3" over v0.3.4's bytes.
        try:
            upstream = sha256_bytes(fetch(asset))
        except Exception as e:
            print("[check] %s: could not fetch %s@%s to verify the pin (%s: %s) -- on-disk integrity "
                  "checked, pin NOT verified" % (label, asset["repo"], asset["pin"], type(e).__name__, e))
            continue
        if upstream != pinned:
            hard.append("%s: vendor.json pins %s, but the content at that tag hashes differently\n"
                        "          recorded  %s\n          at %-8s %s\n"
                        "          The pin and the sha256 disagree -- they were not recorded together.\n"
                        "          Re-sync to make them agree: python tools/sync_assets.py"
                        % (label, asset["pin"], pinned, asset["pin"], upstream))
            continue
        print("[check] %s: [ok] matches %s@%s" % (label, asset["repo"], asset["pin"]))

        # --- upstream freshness: soft (unless --strict) ---
        try:
            newest = latest_tag(asset["repo"])
        except Exception as e:
            print("[check] %s: could not reach %s to check for a newer tag (%s) -- not treating that as "
                  "stale" % (label, asset["repo"], type(e).__name__))
            continue
        if newest and newest != asset["pin"]:
            soft.append("%s: pinned at %s but %s has released %s -- repin with: "
                        "python tools/sync_assets.py --update" % (label, asset["pin"], asset["repo"], newest))

    for m in soft:
        print("::warning::[vendor] %s" % m)
    for m in hard:
        print("::error::[vendor] %s" % m)

    if hard:
        print("\n[check] FAILED -- %d vendored file(s) do not match vendor.json." % len(hard))
        return 1
    if soft and strict:
        print("\n[check] FAILED (--strict) -- %d pin(s) are behind upstream." % len(soft))
        return 1
    if soft:
        print("\n[check] passed, with %d stale pin(s) reported as warnings." % len(soft))
    elif offline:
        print("\n[check] passed -- every vendored file matches its recorded sha256. Pins were NOT checked "
              "against upstream (--offline).")
    else:
        print("\n[check] passed -- every vendored file matches its pin, and every pin is current.")
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--check", action="store_true", help="verify only, write nothing (CI gate)")
    ap.add_argument("--strict", action="store_true", help="with --check: a stale pin fails too")
    ap.add_argument("--update", action="store_true", help="repin each asset to its source's newest tag")
    ap.add_argument("--offline", action="store_true", help="no network; local hash check only")
    args = ap.parse_args()

    doc = load()
    if not doc.get("assets"):
        print("[sync] vendor.json lists no assets -- nothing to do")
        return 0
    if args.check:
        return cmd_check(doc, strict=args.strict, offline=args.offline)
    return cmd_sync(doc, update=args.update, offline=args.offline)


if __name__ == "__main__":
    sys.exit(main())
