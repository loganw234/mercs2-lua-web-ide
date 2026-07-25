#!/usr/bin/env python3
"""gen_api.py -- turn Ess's generated API manifest into src/data/ess-api.json.

The IDE loads that JSON for the API reference panel, Ess.* autocomplete, hover docs, the linter's
did-you-mean, the Ctrl+K palette and the agent's search_api tool.

WHAT CHANGED IN 0.4.x, AND WHY IT MATTERS
This used to parse CAPABILITIES.md's markdown tables -- pulling call paths out of backticked spans in
table cells, resolving `.method` shorthand against whichever full path appeared earlier in the row. It
worked, but it made a hand-maintained document the source of truth for what exists. Ess 0.4 generates
api/ess.json from src/*.lua instead, where a function exists because it is DEFINED, full stop. So:

    ess.json          decides WHAT EXISTS -- namespace, tier, params, method-vs-dot, docs, returns
    CAPABILITIES.md   only DECORATES -- the thematic section headings the panel groups by, the
                      per-namespace "what it's for" blurb, and richer hand-written signatures for the
                      handful of calls documented with option-table keys
    call_docs.json    fills per-call doc gaps ess.json has not documented yet

A doc naming a call that does not exist is now simply ignored rather than believed. (Upstream's
`build/manifest.py --check` fails on that drift separately, so it should not reach us at all.)

Run: python tools/gen_api.py   (reads src/data/ess.json + CAPABILITIES.md, writes src/data/ess-api.json)

The Ess.VERSION stamp comes straight from ess.json's own `version` field, so it always describes the
data it was generated from. $ESS_VERSION still overrides, and a previous stamp is carried forward if
ess.json is somehow unavailable -- 76_versioncheck.js bails on a falsy value, so writing None there
would silently DISABLE the version-drift warning rather than degrade it.
"""
import json
import os
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
ESS = ROOT / "src" / "data" / "ess.json"              # vendored: Ess's generated manifest
CAPS = ROOT / "src" / "data" / "CAPABILITIES.md"      # vendored: human reference, decoration only
CALL_DOCS = ROOT / "src" / "data" / "call_docs.json"  # {"ess": {path: doc}, "natives": {...}}
OUT = ROOT / "src" / "data" / "ess-api.json"

BACKTICK = re.compile(r"`([^`]+)`")
# a documented signature: a full Ess path followed by an argument list
SIG_RE = re.compile(r"^(Ess(?:\.[A-Za-z_]\w*)+)\s*(\(.*\)|\{.*\})$", re.S)
NS_RE = re.compile(r"^Ess(?:\.Raw|\.Easy)?\.[A-Z][A-Za-z]+$")


def clean(cell):
    """Strip markdown to a short plain-text blurb."""
    cell = BACKTICK.sub(r"\1", cell)
    cell = re.sub(r"\*\*([^*]+)\*\*", r"\1", cell)
    return re.sub(r"\s+", " ", cell).strip()


def decorations():
    """From CAPABILITIES.md: {ns: group}, {ns: blurb}, {call_path: rich_sig}.

    Deliberately tolerant -- every one of these is optional polish on top of ess.json, so a doc that
    reorganises its headings degrades the panel's grouping and nothing else.
    """
    groups, blurbs, sigs = {}, {}, {}
    if not CAPS.exists():
        return groups, blurbs, sigs
    section = ""
    for ln in CAPS.read_text(encoding="utf-8").splitlines():
        s = ln.strip()
        if s.startswith("#"):
            section = s.lstrip("#").strip()
            continue
        if not s.startswith("|"):
            continue
        cells = [c.strip() for c in s.strip("|").split("|")]
        if not cells or set("".join(cells)) <= set("-: "):
            continue

        row_ns = None
        for tok in BACKTICK.findall(cells[0]):
            for piece in tok.split("/"):
                if NS_RE.match(piece.strip()):
                    row_ns = piece.strip()
                    break
            if row_ns:
                break
        if row_ns:
            groups.setdefault(row_ns, section)
            if len(cells) > 1 and cells[1].strip():
                blurbs.setdefault(row_ns, clean(cells[1]))

        # richer hand-written signatures, e.g. Ess.Mark.object(guid, {radar=, pda=, ...}).
        # Recorded against the exact path; only used if ess.json says that path is real.
        for cell in cells:
            for tok in BACKTICK.findall(cell):
                m = SIG_RE.match(tok.strip())
                if m:
                    sigs.setdefault(m.group(1), tok.strip())
    return groups, blurbs, sigs


def parents(ns):
    """Namespaces to inherit decoration from, nearest first.

    CAPABILITIES.md documents the Core tier as the table's subject, so Ess.Easy.Camera and
    Ess.Raw.Impulse have no row of their own -- but they are the SAME thematic area as Ess.Camera and
    Ess.Impulse, just a different tier (which the panel already badges separately). Without this,
    every Easy and Raw namespace landed ungrouped and the API tree lost a third of its structure.
    Sub-namespaces (Ess.Squad.Tactics) inherit from their parent for the same reason.
    """
    out = []
    stripped = ns.replace(".Easy.", ".").replace(".Raw.", ".")
    if stripped != ns:
        out.append(stripped)
    parts = ns.split(".")
    while len(parts) > 2:
        parts = parts[:-1]
        cand = ".".join(parts)
        if cand not in out:
            out.append(cand)
    return out


def inherited(ns, table):
    if ns in table:
        return table[ns]
    for p in parents(ns):
        if p in table:
            return table[p]
    return ""


def resolve_version(manifest):
    """(version, where_from). $ESS_VERSION -> ess.json -> carry forward the previous stamp."""
    stated = os.environ.get("ESS_VERSION", "").strip()
    if stated:
        return stated, "$ESS_VERSION"
    v = (manifest or {}).get("version")
    if v:
        return v, "ess.json"
    if OUT.exists():
        try:
            carried = json.loads(OUT.read_text(encoding="utf-8")).get("essVersion")
        except (OSError, ValueError):
            carried = None
        if carried:
            return carried, "carried forward from %s (ess.json had no version)" % OUT.name
    return None, "UNRESOLVED"


def main():
    if not ESS.exists():
        print("[gen_api] missing %s -- run: python tools/sync_assets.py" % ESS)
        return 1
    manifest = json.loads(ESS.read_text(encoding="utf-8"))
    functions = manifest.get("functions", {})
    if not functions:
        print("[gen_api] %s lists no functions -- refusing to write an empty reference" % ESS.name)
        return 1

    groups, blurbs, rich_sigs = decorations()

    call_docs = {}
    if CALL_DOCS.exists():
        try:
            call_docs = json.loads(CALL_DOCS.read_text(encoding="utf-8")).get("ess", {})
        except (OSError, ValueError):
            call_docs = {}

    by_ns = {}
    doc_hits = 0
    for path in sorted(functions):
        e = functions[path]
        ns = e.get("namespace") or path.rsplit(".", 1)[0]
        params = e.get("params") or []
        # `method: true` means it was defined with a colon (Ess.X:y), so show it that way --
        # calling it with a dot would silently drop self.
        shown = path
        if e.get("method") and "." in path:
            head, tail = path.rsplit(".", 1)
            shown = head + ":" + tail
        sig = rich_sigs.get(path) or (shown + "(" + ", ".join(params) + ")")

        doc = (e.get("description") or "").strip() or call_docs.get(path, "")
        if doc:
            doc_hits += 1
        call = {"path": path, "sig": sig}
        if doc:
            call["doc"] = doc
        # extra fields the current consumers ignore; the doc pane can surface them later
        if e.get("tier"):
            call["tier"] = e["tier"]
        if (e.get("returns") or "").strip():
            call["ret"] = e["returns"].strip()
        by_ns.setdefault(ns, []).append(call)

    out_ns, completions = [], set()
    for name in sorted(by_ns):
        out_ns.append({
            "name": name,
            "group": inherited(name, groups),
            "doc": inherited(name, blurbs),
            "calls": by_ns[name],
        })
        completions.add(name)
        for c in by_ns[name]:
            completions.add(c["path"])

    version, vsrc = resolve_version(manifest)
    data = {"namespaces": out_ns, "completions": sorted(completions), "essVersion": version}
    OUT.write_text(json.dumps(data, indent=1), encoding="utf-8")

    undocumented = len(functions) - doc_hits
    print("[gen_api] wrote %s -- %d namespaces, %d calls, %d completions, Ess %s"
          % (OUT.name, len(out_ns), len(functions), len(completions), version or "?"))
    print("[gen_api] docs: %d with a description, %d without; grouping %d/%d namespaces from %s"
          % (doc_hits, undocumented, sum(1 for n in out_ns if n["group"]), len(out_ns), CAPS.name))
    print("[gen_api] Ess.VERSION stamp: %s (from %s)" % (version or "NONE", vsrc))
    if not version:
        print("[gen_api] WARNING: no Ess.VERSION resolved -- 76_versioncheck.js will stay silent in "
              "this build. Set ESS_VERSION, or re-sync so ess.json carries its version.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
