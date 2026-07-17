#!/usr/bin/env python3
"""gen_examples.py -- build the Examples gallery from the Ess repo's samples/recipes/.

The recipes are the framework's living documentation: one task each, self-describing (`-- RECIPE: title --
what it does`), smoke-tested every release. The samples/README.md "## Recipes" section is the curated index
(categories + a one-line "achieves" per recipe) -- we mirror that structure exactly, prepend a tiny
hand-written "First steps" category for absolute beginners, and strip each file's boilerplate (the _G.Ess
guard and the [SMOKE] self-test lines) so what a learner sees is just the idiom.

Usage:  python tools/gen_examples.py [path-to-ess-samples-dir]
Writes: src/data/examples.json
"""
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "src" / "data" / "examples.json"
DEFAULT_SAMPLES = r"C:\Users\logan\source\repos\mercs2-lua-essentials\samples"

FIRST_STEPS = {
    "name": "First steps",
    "items": [
        {"name": "Am I connected?",
         "desc": "The smallest possible script — returns the framework version. See a number in Results? Everything works.",
         "code": "return Ess.VERSION\n"},
        {"name": "Say hello on screen",
         "desc": "Put a toast message up in the game. Change the text and run it again.",
         "code": 'Ess.Easy.Toast("Hello from the web IDE!")\n'},
        {"name": "Write to the log",
         "desc": "Ess.Log prints to the Log & telemetry tab down below — your best friend for figuring out what a script is doing.",
         "code": 'Ess.Log("checkpoint reached, cash is working")\n'},
        {"name": "Give yourself cash",
         "desc": "Your first taste of changing the game: a hundred grand, one line.",
         "code": "Ess.Player.giveCash(100000)\n"},
    ],
}

BOILER = [
    re.compile(r"^local Ess = _G\.Ess\s*$"),
    re.compile(r"^if not Ess then .*return end\s*$"),
    re.compile(r"^local ok = .*$"),
    re.compile(r".*\[SMOKE\].*"),
]


def clean_code(text):
    lines = [ln for ln in text.splitlines() if not any(rx.match(ln) for rx in BOILER)]
    while lines and not lines[0].strip():
        lines.pop(0)
    while lines and not lines[-1].strip():
        lines.pop()
    return "\n".join(lines) + "\n"


def title_of(text, fallback):
    m = re.search(r"^--\s*RECIPE:\s*(.+)$", text, re.M)
    if not m:
        return fallback
    t = m.group(1).split(" -- ")[0].strip().rstrip(".")
    return t[0].upper() + t[1:] if t else fallback


def main():
    samples = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SAMPLES)
    readme = samples / "README.md"
    recipes = samples / "recipes"
    if not readme.exists() or not recipes.is_dir():
        print("[gen_examples] missing %s or %s" % (readme, recipes))
        return 1

    categories = [FIRST_STEPS]
    cat = None
    in_recipes = False
    for ln in readme.read_text(encoding="utf-8").splitlines():
        if ln.startswith("## "):
            in_recipes = ln.startswith("## Recipes")
            continue
        if not in_recipes:
            continue
        m = re.match(r"^\*\*(.+?)\*\*", ln.strip())
        if m:
            cat = {"name": m.group(1).strip(), "items": []}
            categories.append(cat)
            continue
        m = re.match(r"^\|\s*`([\w-]+)`\s*\|([^|]+)\|", ln.strip())
        if m and cat is not None:
            fname, achieves = m.group(1).strip(), m.group(2).strip()
            p = recipes / (fname + ".lua")
            if not p.exists():
                print("[gen_examples] WARNING: README lists %s but %s is missing" % (fname, p.name))
                continue
            text = p.read_text(encoding="utf-8")
            cat["items"].append({
                "name": title_of(text, fname.replace("_", " ")),
                "desc": achieves[0].upper() + achieves[1:],
                "code": clean_code(text),
            })

    listed = {i["name"] for c in categories for i in c["items"]}
    n_files = len(list(recipes.glob("*.lua")))
    data = {"categories": categories}
    OUT.write_text(json.dumps(data, indent=1), encoding="utf-8")
    n = sum(len(c["items"]) for c in categories)
    print("[gen_examples] wrote %s -- %d examples in %d categories (%d recipe files on disk)"
          % (OUT.name, n, len(categories), n_files))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
