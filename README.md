# Mercs2 Lua IDE

A live, in-browser Lua / [Ess](https://github.com/loganw234/mercs2-lua-essentials) editor for **Mercenaries 2**
modding, built for **beginners**. Write a script, hit **Run**, and it executes in your **running game** over the
`lua-bridge` — results and the live game log stream straight back to the page. No install, no build step to *use* it.

It's a single self-contained `dist/index.html` (editor, API reference, examples, and the WebSocket client all
inlined), so it works three ways:

- **Hosted** on GitHub Pages — just open the URL (works in Chrome; loopback is treated as trustworthy).
- **Downloaded** — grab [`mercs2-lua-ide.html`](https://github.com/loganw234/mercs2-lua-web-ide-ai/releases/latest/download/mercs2-lua-ide.html)
  from the latest release and open it off disk (`file://`). CI rebuilds that asset on every push, so it's
  always the current build. (Cloning instead? `python build.py` writes the same file to `dist/index.html`.)
- **Served by the bridge** — the WS-capable `lua-bridge` can serve this file at
  `http://127.0.0.1:27050/`, the bulletproof path that dodges every mixed-content / private-network quirk.

## What you need to actually run scripts

1. The **WebSocket-capable `lua-bridge`** mod, with the game running.
2. It listening on `ws://127.0.0.1:27050` (the default).
3. Hit **Connect**. Green dot = live.

You can still write, save, and browse everything with no game attached — only *running* needs the bridge.

## Features

- **Real editor** — CodeMirror 6 (vendored, still zero external requests): Lua highlighting, undo/redo,
  find & replace (`Ctrl/Cmd+F`), bracket matching + auto-close, auto-indent, code folding.
  `Ctrl/Cmd+Enter` runs (the selection if you have one, else the whole file); `Ctrl/Cmd+S` saves.
- **Beginner guardrails** — every script is parsed *before* it's sent. Syntax errors block the run with a
  plain-English explanation (missing `end`, `=` vs `==`, `!=` vs `~=`, unclosed strings…) and jump you to the
  line. Live squiggles as you type, plus: did-you-mean for typo'd `Ess.*` / native / `Loader.*` calls,
  argument-count checks backed by how the game's own scripts call each native, colon-vs-dot fixes,
  `print()` → `Ess.Log` hints, a hard warning on `while true` loops (they freeze the game), and a
  **missing-`import()` check** — `import("Name")` only affects the importing file's own environment, so
  calling a resident module like `MrxPmc` without importing it first dies with *attempt to index global
  'MrxPmc' (a nil value)*. The linter names the exact import you need before the script is ever sent.
- **Script library** — named scripts with rename / duplicate / delete, autosave as you type, import/export
  `.lua` files, and a one-click **Backup/Restore** of the whole library as one JSON file (the seatbelt
  against "clear browsing data" — restore always merges, never clobbers). **Share** links are LZ-string
  compressed (~3-4× more script per link) and carry the script's name; they open as a *new* script so they
  never clobber anyone's work, and old uncompressed links still open fine.
- **Examples gallery** — 45 categorized, smoke-tested examples generated straight from the Ess repo's
  `samples/recipes/` (the framework's living documentation), from "Am I connected?" to full missions.
  Opens as a searchable modal (activity bar, or File ▸ Examples gallery); one click opens any of them
  as a new script to play with.
- **Command palette** (`Ctrl/Cmd+K`) — one search across every Ess call, engine native, spawnable
  template, example and file command. Enter inserts at the caret (or runs the command) and closes.
  Ess ranks above the engine natives, and `Ess.Easy.*` above the rest, same as autocomplete.
- **Two-layer API reference** — the full Ess API (79 namespaces / 548 calls, generated from Ess's own source, tier-badged Easy / Core / Raw)
  *plus* the engine's own native functions (94 namespaces / 1,310 calls — a live `pairs(_G)` dump of the
  running game for what exists, merged with a scrape of the decompiled base-game scripts for **a real call
  site** and observed argument counts). Most calls carry a
  real, specific description mined from the wiki (not just "here's the namespace") — click any call for
  docs, insert it as a snippet with tab-through argument placeholders, or just **hover** the token in the
  editor for the same doc as a tooltip. The same data powers autocomplete (`Ess.Easy.*` floats to the top).
- **Run & inspect** — a one-line **REPL** under the output (Enter sends, ↑ recalls history; bare
  expressions auto-wrap in `return` so `Ess.VERSION` just works), a hover **↺ re-run** on every past
  result, and returned **tables pretty-print** as `{x=1, y={...}}` (game-side serializer: depth-capped,
  cycle-safe) instead of `table: 0x...`.
- **Watch panel** — pin any expression (`Ess.Player.pose(0)`, `Ess.Loop.isRunning("demo")`) in the Watch
  tab and it re-polls live every couple of seconds while connected — the poor-man's debugger, and a fast
  way to actually see cause and effect instead of guessing at it.
- **🎯 Grab target** — one click while connected runs `Ess.Player.targetUnderReticle` +
  `Ess.Probe.describeSafe` on whatever you're aiming at in-game and drops its guid at the caret — turns
  "how do I even get a guid" from a docs hunt into one click.
- **■ Stop loops** — the "my script went wild" button: stops every `Ess.Loop` and restores the time scale.
- **Results + live log** — ok / runtime error / timeout per run, and the live `Loader.Printf` +
  `Loader.WsSend` telemetry feed with timestamps, a substring filter, smart follow (scroll up to pause
  autoscroll, "↓ latest" to jump back), and highlight rules — built-in tints for `PASS`/`FAIL`/`error`/
  `[recipe]` lines, plus your own pattern → color rules.
- **Comfort** — dark/light/auto theme toggle (bottom right), draggable sidebar + output splits, all persisted.
- **Update check** — the *downloaded* (and bridge-served) copy quietly asks GitHub about once a day whether
  a newer build exists (its git commit is stamped in at build time) and offers the release download in a
  dismissible bar. The hosted Pages copy is always current, so it never checks. Offline? Nothing happens.
- Zero external requests at runtime — one file, fully offline-capable.

## Build

The page is assembled from `src/` by a tiny Python script; every generated input is **committed**, so a plain
`python build.py` (or CI) needs nothing but Python:

```
python build.py           # src/* -> dist/index.html (standalone)
```

Regenerating the data (only when the upstream sources change):

```
python tools/sync_assets.py     # fetch the vendored Ess manifests at their pinned tag (see below)
python tools/gen_api.py         # src/data/ess.json (+CAPABILITIES.md) -> src/data/ess-api.json
python tools/gen_natives.py     # natives-scraped.json + ess-natives.json -> src/data/natives.json
python tools/gen_examples.py    # <ess repo>/samples/recipes + README  -> src/data/examples.json
python tools/gen_templates.py   # <spawn menu scripts + wiki>          -> src/data/templates.json
python tools/scrape_natives.py  # <decompiled game lua>/src            -> src/data/natives-scraped.json
```

Ess 0.4 made its API surface machine-readable, and that changed where the truth lives. `api/ess.json` is
generated from `src/*.lua`, so a function is in the reference because it is **defined**, not because a
document mentions it. `gen_api.py` used to parse CAPABILITIES.md's markdown tables and resolve `.method`
shorthand against whichever full path appeared earlier in the row — which silently attributed `Ess.Squad`'s
`.setFormation`/`.clearFormation`/`.on` to `Ess.Squad.Tactics`, offering three plausible paths that don't
exist. CAPABILITIES.md is still pinned, but only for what `ess.json` doesn't carry: the section headings the
API panel groups by, the per-namespace blurb, and richer hand-written signatures for calls documented with
option-table keys.

One correction the merge has to apply: the live dump is a `pairs(_G)` walk taken **over the lua-bridge**,
so the globals `Lua_Loader.asi` injects are sitting in `_G` beside the real C++ natives and come back
classified as engine. `Loader` is that whole surface — exactly the nine functions the wiki documents under
lua-bridge-api, and no decompiled base-game script references `Loader.*` at all. `gen_natives.py` emits a
`kinds` map so the panel badges them **lua-bridge** rather than describing a mod's API as "the engine's
own functions, as the base game's scripts actually use them". The proper fix belongs upstream in Ess's
`dump_natives.py`, which is the only thing that can know what was resident before the bridge attached.

Those nine also arrived with no signature and no description — nothing in the base game calls the bridge,
so the scrape had nothing to mine, and the live dump records existence only. Their docs are hand-written
into `call_docs.json` (the repo's existing curated artifact) rather than parsed out of `lua_bridge.c`: the
C is authoritative for the function *list*, but its comments describe the implementation — stack offsets
and perf notes — not the contract, and three different argument idioms in there would defeat a parser on
`Printf` and `IsKeyDown` alone. Nine functions that change roughly never are worth writing by hand.
Curated docs are merged **after** the scrape/live merge, which also fixed a real gap: `call_docs` used to
be applied inside `scrape_natives.py`, so none of the 543 live-only functions could receive a doc at all.

The same file also records the 18 **resident Lua modules** (`MrxUtil`, `MrxGuiBase`, …) under a
separate `modules` key rather than folding them in with the natives — they are not engine functions
and they are not unconditionally available, which is exactly what makes the import check possible.
Only canonical top-level modules are listed; a dotted entry like `MrxGui.FlashWidget` is reached
through its parent, so the import it needs is the parent's.

`natives.json` is likewise a **merge** of two partial sources, neither sufficient alone: `scrape_natives.py`
mines the decompiled corpus for how a native is really *called* (call site, observed argument counts), while
Ess's live `pairs(_G)` dump is authoritative for what *exists*. The merge is strictly additive, so a
live-only entry has no argument data and the linter's arg-count check (gated on `entry.n >= 5`) skips it
rather than inventing a warning. It stopped the linter telling you a real engine function "isn't seen
anywhere in the game's own scripts" just because no shipped script happens to call it.

### Vendored files (`vendor.json`)

`src/data/CAPABILITIES.md` is Ess's file, not this repo's. It used to be copy-pasted in, which recorded
nothing about *which* version had been copied — so it silently went seven days and 117 API calls stale,
and the only symptom was this IDE's own Ess-version warning firing against an ancient reference.

It's now pinned in [`vendor.json`](vendor.json) to a release tag plus a sha256, and `tools/sync_assets.py`
is the only thing that writes it. **Don't hand-edit a vendored file — change it upstream, cut a release,
repin.**

```
python tools/sync_assets.py            # fetch at the pinned tag, verify the hash
python tools/sync_assets.py --update   # repin to Ess's newest release, then fetch
python tools/sync_assets.py --check    # what CI runs (writes nothing)
```

`--check` is two checks with deliberately different severities: a file that doesn't match its pin is a
**hard failure** (the repo is inconsistent), while a pin merely *behind* upstream is a **warning** —
another repo cutting a release must never break this one's deploy. `.github/workflows/vendor-check.yml`
runs `--check --strict` weekly, which is where staleness becomes a red run instead of a line in a green
log. Network trouble is reported, never mistaken for staleness.

The pin doubles as the `Ess.VERSION` stamp in `ess-api.json` (`gen_api.py` reads it), so the reference
and the version it claims to be can't drift apart.

`gen_api.py` and `scrape_natives.py` both also merge in `src/data/call_docs.json` — real, wiki-sourced
per-call descriptions (`{"ess": {path: doc}, "natives": {path: doc}}`) that power the hover tooltip and
the API panel's doc pane beyond the bare signature. It's a committed, hand-curated/mined artifact, not
something either generator derives on its own — re-running either script preserves whatever's in it as
long as the paths still match; it just won't gain new entries unless `call_docs.json` itself is updated.

Regenerating the vendored editor bundle (only when bumping CodeMirror/luaparse/lz-string — needs Node):

```
cd tools/vendor && npm install && npm run build    # -> src/lib/vendor.js (committed)
node smoke.js                                      # headless boot + behavior test of dist/index.html
```

- `src/index.html` — page skeleton (with `/*__CSS__*/`, `/*__API__*/`, `/*__NATIVES__*/`, `/*__EXAMPLES__*/`,
  `/*__TEMPLATES__*/`, `/*__BUILD__*/`, `/*__APP__*/` inject markers).
- `src/styles.css` — all styling (dark/light), including the CodeMirror theme.
- `src/lib/vendor.js` — CodeMirror 6 + luaparse + lz-string, bundled to one IIFE (`window.CM`) by `tools/vendor/`.
- `src/lib/ess-bridge.js` — the vendored WebSocket client (kept in sync with the Ess repo's `tools/`;
  the IDE adds a table serializer to the result wrap — an upstream candidate).
- `src/app/*.js` — the app, one concern per file (`00_state` → `99_main`), merged in order.
  The AI layer is `79_render` (pure markdown/Lua rendering) → `80_provider` (transport, context
  autodetection, derived budgets) → `82_assist` (the panel) → `85_ground` / `86_agent`.
- `src/data/` — `CAPABILITIES.md` (**vendored** from the Ess repo at the tag `vendor.json` pins — managed
  by `tools/sync_assets.py`, not edited here), `call_docs.json` (hand-curated per-call docs, see above),
  and the four generated JSONs (`ess-api`/`natives`/`examples`/`templates`).
- `dist/index.html` — the built standalone page. **Not committed** (gitignored): CI rebuilds it from
  `src/` on every push, deploys it to Pages, and attaches it to the `latest` release as
  `mercs2-lua-ide.html`. Run `python build.py` for a local copy.

`.github/workflows/pages.yml` verifies the vendored pins, regenerates the API, rebuilds, and deploys
`dist/` to GitHub Pages on push.

## Keeping the data current

- **Ess API + natives**: `python tools/sync_assets.py --update`, then re-run `tools/gen_api.py`
  and `tools/gen_natives.py`. Both read the vendored Ess manifests, so this needs no local checkout.
- **Examples**: re-run `tools/gen_examples.py` (reads the Ess repo's `samples/` directly).
- **Natives**: re-run `tools/scrape_natives.py` against the decompiled game scripts.

Then `python build.py` and commit.

> **Note:** `gen_examples.py`, `scrape_natives.py` and `gen_templates.py` still resolve their inputs from
> absolute paths to local checkouts, so only this machine can regenerate them and CI silently produces
> different results than a local run does. Moving them onto `vendor.json` the way `CAPABILITIES.md` now
> is would fix that; `gen_api.py` is the worked example.


## License

[MIT](LICENSE) -- matching the rest of the Mercenaries 2 tooling.

## Disclaimer

This is an unofficial, non-commercial community fan project. It is **not affiliated with, associated with,
authorized by, endorsed by, or in any way officially connected to Electronic Arts or Pandemic Studios**.
*Mercenaries 2: World in Flames* and all related marks are the property of their respective owners.

This repository contains original code only -- no game assets are redistributed. It requires your own
legally-obtained copy of the game to be of any use.

If a rights holder objects to anything in this repository, contact me and I will comply with a removal
request.
