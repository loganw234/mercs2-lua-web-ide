#!/usr/bin/env python3
"""gen_api.py -- turn Ess's CAPABILITIES.md into src/data/ess-api.json.

The IDE loads that JSON for two things: Ess.* autocomplete, and a browsable API reference sidebar.
CAPABILITIES.md is a set of markdown tables grouped under `## Section` headers; each row's cells carry
the namespace (`Ess.Xxx`) and its calls in backticks. We pull those out -- imperfect signatures are fine,
the point is a useful, current list of real call paths that stays in sync when Ess grows.

Run: python tools/gen_api.py   (reads src/data/CAPABILITIES.md, writes src/data/ess-api.json)
"""
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "src" / "data" / "CAPABILITIES.md"
OUT = ROOT / "src" / "data" / "ess-api.json"

BACKTICK = re.compile(r"`([^`]+)`")
NS_RE = re.compile(r"^Ess(?:\.Raw|\.Easy)?\.[A-Z][A-Za-z]+$")          # Ess.Player, Ess.Easy.Airstrike
CALL_RE = re.compile(r"^(Ess(?:\.[A-Za-z_]\w*)+)(\([^)]*\))?$")         # Ess.X.y(args)
METHOD_RE = re.compile(r"^(\.[A-Za-z_]\w*)(\([^)]*\))?$")               # .method(args)


def clean_doc(cell):
    """Strip markdown/backticks/bold from a table cell to a short plain-text blurb."""
    cell = BACKTICK.sub(r"\1", cell)
    cell = re.sub(r"\*\*([^*]+)\*\*", r"\1", cell)
    cell = re.sub(r"\s+", " ", cell).strip()
    return cell


def main():
    if not SRC.exists():
        print("[gen_api] missing %s -- copy Ess's CAPABILITIES.md there first" % SRC)
        return 1

    lines = SRC.read_text(encoding="utf-8").splitlines()
    section = ""
    namespaces = {}   # name -> {group, doc, calls: {path: sig}}

    def ns_entry(name, group="", doc=""):
        e = namespaces.get(name)
        if not e:
            e = {"name": name, "group": group, "doc": doc, "calls": {}}
            namespaces[name] = e
        if doc and not e["doc"]:
            e["doc"] = doc
        if group and not e["group"]:
            e["group"] = group
        return e

    for ln in lines:
        s = ln.strip()
        if s.startswith("#"):
            section = s.lstrip("#").strip()
            continue
        if not s.startswith("|"):
            continue
        cells = [c.strip() for c in s.strip("|").split("|")]
        if not cells or set("".join(cells)) <= set("-: "):   # header separator row
            continue
        if all(h.lower() in ("namespace", "what it's for", "key calls", "verb", "does", "tier") for h in cells if h):
            continue

        # the row's namespace = first `Ess.Xxx` token in cell 0 (or anywhere if cell 0 has none)
        row_ns = None
        for tok in BACKTICK.findall(cells[0]):
            for piece in tok.split("/"):
                piece = piece.strip()
                if NS_RE.match(piece):
                    row_ns = piece
                    break
            if row_ns:
                break

        doc = clean_doc(cells[1]) if len(cells) > 1 else ""
        if row_ns:
            ns_entry(row_ns, section, doc)

        # every backtick span across the row -> individual calls. `.method` shorthand attaches to the
        # namespace of the MOST RECENT full path in the row (e.g. `Ess.Easy.Airstrike.at(x,y,z)` /
        # `.onTarget(i)` inside an `Ess.Support` row), falling back to the row's own namespace.
        last_ns = row_ns
        for cell in cells:
            for tok in BACKTICK.findall(cell):
                for piece in tok.split("/"):
                    piece = piece.strip().strip("`")
                    if not piece:
                        continue
                    if NS_RE.match(piece):          # a bare namespace reference, not a call
                        ns_entry(piece, section)
                        continue
                    m = CALL_RE.match(piece)
                    if m:
                        path = m.group(1)
                        ns = path.rsplit(".", 1)[0]
                        ns_entry(ns, section)
                        namespaces[ns]["calls"][path] = piece
                        last_ns = ns
                        continue
                    m = METHOD_RE.match(piece)
                    if m and last_ns:
                        ns_entry(last_ns, section)
                        path = last_ns + m.group(1)
                        namespaces[last_ns]["calls"][path] = last_ns + piece

    # finalize
    out_ns = []
    completions = set()
    for name in sorted(namespaces):
        e = namespaces[name]
        calls = [{"path": p, "sig": e["calls"][p]} for p in sorted(e["calls"])]
        out_ns.append({"name": name, "group": e["group"], "doc": e["doc"], "calls": calls})
        completions.add(name)
        for c in calls:
            completions.add(c["path"])

    data = {"namespaces": out_ns, "completions": sorted(completions)}
    OUT.write_text(json.dumps(data, indent=1), encoding="utf-8")
    print("[gen_api] wrote %s -- %d namespaces, %d completions"
          % (OUT.name, len(out_ns), len(completions)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
