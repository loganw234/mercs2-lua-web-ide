# Roadmap — future features

Not started; a menu to pick from. Everything is filtered through the project's one rule: **does this help a
beginner get something happening in the game, faster and with less confusion?** Effort: S (an afternoon),
M (a day or two), L (a week-ish). Nothing here breaks the sacred single-file build.

## Shipped — 2026-07-18

All of former Tier 1, built, smoke-tested, and browser-verified in one session:

- **Template-name autocomplete + browser** — `tools/gen_templates.py` mined `AllInOneSpawnMenu.lua` +
  `CommonSpawnMenu.lua` (plus the wiki's spawn-reference pages for Skins/FX) into `src/data/templates.json`:
  667 confirmed names across Vehicles/Weapons/Skins/FX/Other. Wired into: in-string autocomplete
  (`20_editor.js`), a new sidebar **Templates** tab (`52_templates.js`, click a name to insert it quoted),
  and a linter info-level nudge (`25_lint.js`) on an unrecognized template string passed to
  `Pg.Spawn`/`Ess.Object.spawn`/`Ess.Object.spawnAhead`/`Ess.Easy.Vehicle.summon`.
- **Hover docs** — `hoverTooltip` added to the vendored CodeMirror bundle; reuses the same API-lookup data
  autocomplete already loads (`IDE.api.lookup`, exposed from `50_api.js`).
- **"Grab what I'm aiming at"** — a header button (`60_ui.js`) running the real
  `Ess.Player.targetUnderReticle(0)` + `Ess.Probe.describeSafe` pair, inserting the guid at the caret and
  flashing the description.
- **Watch panel** — a new third output tab (`45_watch.js`): pinned expressions re-poll every 2s while
  connected via the same `IDE.bridge.run` path the REPL uses, each row its own kill switch.
- **Library backup / restore** — `IDE.store.exportAll`/`.importAll` (`15_store.js`) plus two Scripts-panel
  buttons; restore is always additive, never overwrites.
- **Log highlight rules** — built-in tints for `PASS`/`FAIL`/`error`/`[recipe]` plus a small popover
  (`40_console.js`) for user pattern → color rules, persisted in localStorage.
- **Share-link compression** — real `lz-string` (not hand-rolled) now vendored into `src/lib/vendor.js`;
  `#z=` links carry `{name, code}` LZ-string-compressed, `#s=` (the old, name-less, uncompressed form)
  still parses forever as the fallback.

Also fixed the same day, found while using the above: a pre-existing bug where `Ess.*`/native calls never
got their special editor coloring (CodeMirror lexes a dotted chain as one token; the check only ever
compared the whole token, never matching past the first dot), a stale-data bug in the Ess repo's
`CAPABILITIES.md` that silently invented non-existent Core-tier methods while omitting their real
`Ess.Easy.*` equivalents, and real per-call documentation (`src/data/call_docs.json`, 346 Ess + 487 native
calls) mined from the wiki to replace the generic namespace-level blurb every hover/API-panel doc used to
show.

Rest of Tier 2 (all but the tutorial), same session:

- **Object inspector** — its own sidebar tab (`46_inspector.js`), not a Watch-tab row: a 🎯 Grab target
  button, a type-a-guid box, or 🔍 on a Results value all feed it a guid, and it takes over the sidebar
  with a live view (name/position/health/maxHealth/faction/alive/`Ess.Probe.describeSafe`, one compound
  round-trip, 2s poll). Also where a real bug got caught and fixed: a guid is Lua userdata, not a number —
  `tostring()` on one gives an opaque, non-reusable string, and `Ess.Name`/`Sys.StringToGuid` (the real,
  portable "0x..." round trip) turned out to be necessary, confirmed live against a running game.
- **Deploy as OnKey** — a Scripts-panel button wraps the open script in the real guard/state/action shape
  every Ess OnKey mod uses (`samples/OnKey/StarterMod.lua`'s own pattern), named after the script, and
  downloads it ready to drop in `scripts/OnKey/` with a `lua_loader.ini` binding comment baked in.
- **Runtime-error explainer** — 11 common Lua runtime error patterns ("attempt to index/call a nil value",
  "bad argument #N", arithmetic/concat/compare on nil) mapped to a plain-English cause, shown as a second
  line under the red result. Persists with the row in run history.
- **Persistent run history** — the Results feed survives reload (last 100, localStorage); the existing log
  filter box now doubles as a Results filter, shown for whichever tab is active.
- **Ess-version drift warning** — `tools/gen_api.py` stamps in the `Ess.VERSION` the data was generated
  against; on every connect the IDE asks the game its real version and shows one dismissible line on a
  mismatch. Dismissing remembers that exact (reference, game) pair, not "forever".

- **Interactive first-script tutorial** — a floating, non-blocking guided panel (`78_tutorial.js`): connect
  → TYPE `return Ess.VERSION` yourself → read your own position (`pose`) → **teleport to a live-captured
  street outside the PMC HQ** (fresh players stand in the HQ lobby — summoning a car indoors is the first
  thing that would've gone wrong) → summon a taxi and meet the **teardown pattern** (`Ess.State` +
  remove-last-run's-taxi-unless-you're-in-it; the teardown block visibly grows mark-clearing lines when
  marks arrive — hot-reload hygiene taught by example) → find a fare (nearest LIVING civilian with real
  distance feedback — the first-match version could pick a corpse or someone 150 units off; civilians also
  wander, so the copy treats an empty scan as normal) → **your turn: widen the search radius** → hold them
  → mark the pickup + drop a "go here" ring (handles kept in `S` so the teardown can clear them) → **your
  turn: place the drop-off** → deploy as OnKey. One script, additively built in place, living in its own dedicated
  "Tutorial: Taxi Fare" library entry (with a guard that switches back to it before writing, so wandering
  to another script mid-tutorial can never get that script clobbered). Every step advances off a real
  signal from the game (`"ran"` carries the code AND the bridge result; `"status"`/`"deployed"` for the
  ends) — never a bare "Next" click — and a per-step `need` marker means unrelated REPL runs can't
  advance or fail a step. The two "your turn" steps verify the learner's own edit by inspecting the code
  that actually ran, and the accumulated script is templated on their values (radius, drop-off distance),
  so nothing they change is ever silently reverted. Polish: each step diff-selects its newly added lines
  in the editor, explains its new calls line by line, pulses the exact button it needs (`.tutglow`),
  coaches failures with step-specific hints, supports ‹ › step revisiting, and survives a reload (the 🎓
  button becomes "Resume tutorial"). The finish panel hands out graduation challenges (giveCash the fare,
  toast the pickup) instead of just closing. All Lua live-verified against a running game (incl. the
  "Civ" faction string); the whole flow is also walked end-to-end in `smoke.js` on simulated signals.

## Tier 2 — ambitious / speculative

- **Live parameter playground** (L) — port the in-game `Playground.lua` idea into the IDE: pick an
  `Ess.Easy.*` call, get sliders/dropdowns for its parameters, hit run repeatedly. The API data plus
  template data make the UI generatable.
- **Webmap handoff** (M, cross-repo) — "pick a point on the map" opens the webmap in pick-mode; the chosen
  `x,y,z` lands back in the script at the caret. Two local files talking via URL hash + `postMessage` /
  clipboard fallback. Also the reverse: "show this position on the map" from a result row.
- **Script formatter** (M) — a small Lua pretty-printer (indent, spacing) behind a "Tidy up" button.
  Beginners' code drifts into chaos; one button restores readability. No external deps — the luaparse AST
  is already in the bundle.
- **User snippets** (S) — "save selection as snippet", listed alongside the built-in `function`/`loop`
  completions. Cheap once there's UI for naming.
- **Multi-tab editing** (M) — a tab strip above the editor for switching between open scripts without the
  sidebar round-trip, each keeping its own undo history (the per-script `EditorState` already exists —
  this is mostly chrome).
- **Storage upgrade** (M) — move the library to IndexedDB with a localStorage fallback + cross-tab sync via
  `storage` events, lifting the ~5 MB ceiling before anyone hits it. Do it when someone actually ships a
  big library; not before.

## Deliberately not planned

- **Cloud accounts / server-side anything** — the no-server, one-file property is the product.
- **A debugger with breakpoints** — the game's Lua runs on the engine thread; pausing it means freezing the
  game. The watch panel + inspector + explainer cover the need without the trap.
- **Bundling the lua-bridge installer into the page** — distribution of the native mod belongs to its own
  repo/release, not a web page download.
