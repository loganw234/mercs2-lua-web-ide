#!/usr/bin/env python3
"""gen_natives.py -- merge the two things we know about the engine's own functions.

TWO SOURCES, DIFFERENT KNOWLEDGE, NEITHER SUFFICIENT

  src/data/natives-scraped.json   what scrape_natives.py mined from the DECOMPILED base-game scripts:
                                  how each native is actually CALLED -- a real call site, observed
                                  argument counts, how often. 40 namespaces. Cannot know about a
                                  function no shipped script happens to call.

  src/data/ess-natives.json       Ess's api/natives.json, a pairs(_G) walk of a LIVE game (vendored,
                                  see vendor.json). Authoritative for what EXISTS -- 81 engine
                                  namespaces, 1,146 functions. Carries no call sites and no argument
                                  counts, because nothing was observed calling anything.

So this merge is strictly ADDITIVE: it fills in functions the scrape never saw, and never touches an
existing entry's n/min/max/example. That matters because 25_lint.js gates its argument-count warning on
`entry.n >= 5 && entry.min != null` -- a live-only entry simply has no `n`, so it silently opts out of
arg checking rather than producing warnings from data we do not have.

What it fixes: the linter used to tell you a real engine function "isn't seen anywhere in the game's own
scripts -- double-check the name" whenever no shipped script called it. With the live dump merged in, the
function is known to exist and that warning stops firing on correct code.

Only `kind: "engine"` namespaces are merged. The dump also carries 197 `game_script` namespaces (3,048
functions) -- resident Lua modules rather than C++ natives. Those are real and callable, but this file
feeds a panel that says "the engine's own functions", and folding a resident module's globals in there
would quietly change what that panel means. Left for a deliberate decision.

Run: python tools/gen_natives.py     (writes src/data/natives.json, which build.py inlines)
"""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SCRAPED = ROOT / "src" / "data" / "natives-scraped.json"   # from tools/scrape_natives.py
LIVE = ROOT / "src" / "data" / "ess-natives.json"          # vendored from Ess's release
OUT = ROOT / "src" / "data" / "natives.json"


def main():
    if not SCRAPED.exists():
        print("[gen_natives] missing %s -- run tools/scrape_natives.py (needs the decompiled corpus)"
              % SCRAPED.name)
        return 1
    scraped = json.loads(SCRAPED.read_text(encoding="utf-8"))
    natives = scraped.get("natives") or {}

    added_ns = added_fn = confirmed = 0
    live_meta = {}
    if LIVE.exists():
        live = json.loads(LIVE.read_text(encoding="utf-8"))
        for ns, info in (live.get("namespaces") or {}).items():
            if info.get("kind") != "engine":
                continue
            members = natives.setdefault(ns, {})
            if not members:
                added_ns += 1
            called = set(info.get("called_by_ess") or [])
            for fn in info.get("functions") or []:
                e = members.get(fn)
                if e is None:
                    # Exists in the running game; nothing observed calling it. No n/min/max, so the
                    # linter's argument check skips it and only its EXISTENCE is asserted.
                    members[fn] = {"live": 1, "ess": 1} if fn in called else {"live": 1}
                    added_fn += 1
                else:
                    e["live"] = 1                 # scraped AND confirmed present at runtime
                    if fn in called:
                        e["ess"] = 1
                    confirmed += 1
        live_meta = {
            "generated": live.get("generated", ""),
            "source": live.get("source", ""),
            "engine_namespaces": sum(1 for i in (live.get("namespaces") or {}).values()
                                     if i.get("kind") == "engine"),
        }
    else:
        print("[gen_natives] no %s -- writing the scrape alone. Run tools/sync_assets.py to vendor "
              "the live dump." % LIVE.name)

    out = {
        "source": scraped.get("source", ""),
        "files": scraped.get("files", 0),
        "live": live_meta,
        "natives": {ns: natives[ns] for ns in sorted(natives)},
    }
    OUT.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")

    total_fn = sum(len(v) for v in natives.values())
    print("[gen_natives] wrote %s -- %d namespaces, %d functions" % (OUT.name, len(natives), total_fn))
    print("[gen_natives] live dump added %d namespaces and %d functions the scrape never saw; "
          "confirmed %d it had" % (added_ns, added_fn, confirmed))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
