# Mercs2 Lua IDE

A live, in-browser Lua / [Ess](https://github.com/loganw234/mercs2-lua-essentials) editor for **Mercenaries 2**
modding. Write a script, hit **Run**, and it executes in your **running game** over the `lua-bridge` — results
and the live game log stream straight back to the page. No install, no build step to *use* it.

It's a single self-contained `dist/index.html` (editor, Ess API reference, and the WebSocket client all
inlined), so it works three ways:

- **Hosted** on GitHub Pages — just open the URL (works in Chrome; loopback is treated as trustworthy).
- **Downloaded** — grab `dist/index.html` and open it off disk (`file://`).
- **Served by the bridge** — the WS-capable `lua-bridge` can serve this file at
  `http://127.0.0.1:27050/`, the bulletproof path that dodges every mixed-content / private-network quirk.

## What you need to actually run scripts

1. The **WebSocket-capable `lua-bridge`** mod, with the game running.
2. It listening on `ws://127.0.0.1:27050` (the default).
3. Hit **Connect**. Green dot = live.

You can still write, save, and browse the API with no game attached — only *running* needs the bridge.

## Features

- **Editor** with Lua syntax highlighting, line numbers, block indent, `Ctrl/Cmd+Enter` to run (the selection
  if you have one, else the whole file), `Ctrl/Cmd+S` to save.
- **`Ess.` autocomplete** and a **browsable API reference** sidebar — generated from Ess's `CAPABILITIES.md`
  (~69 namespaces / 400+ calls). Click any call to insert it.
- **Results** panel (ok / runtime error / timeout) + a live **Log & telemetry** feed (`Loader.Printf` and the
  hidden `Loader.WsSend` channel).
- **Save** to your browser (autosaves as you type) and **Share** a link with the script encoded in the URL.
- Zero external dependencies — one file, fully offline-capable.

## Build

The page is assembled from `src/` by a tiny Python script (mirrors the Ess framework's own merge build):

```
python tools/gen_api.py   # src/data/CAPABILITIES.md -> src/data/ess-api.json
python build.py           # src/* -> dist/index.html (standalone)
```

- `src/index.html` — page skeleton (with `/*__CSS__*/`, `/*__API__*/`, `/*__APP__*/` inject markers).
- `src/styles.css` — all styling (dark/light).
- `src/lib/ess-bridge.js` — the vendored WebSocket client (kept in sync with the Ess repo's `tools/`).
- `src/app/*.js` — the app, one concern per file (`00_state` → `99_main`), merged in order.
- `src/data/` — `CAPABILITIES.md` (the API source) + generated `ess-api.json`.
- `dist/index.html` — the built standalone page (committed, so Pages + downloads need no build).

`.github/workflows/pages.yml` regenerates the API, rebuilds, and deploys `dist/` to GitHub Pages on push.

## Keeping the API current

`src/data/CAPABILITIES.md` is a copy from the Ess framework. When Ess grows, refresh it and re-run
`tools/gen_api.py` + `build.py`.
