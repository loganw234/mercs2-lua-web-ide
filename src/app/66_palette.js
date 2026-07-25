/* 66_palette.js -- the Ctrl/Cmd+K command palette.
 *
 * Covers the two panels that are really "search, then insert one thing":
 *
 *   - SPAWN TEMPLATES. Pure string lookup -- you almost always know a fragment
 *     of the name already, and expanding a category tree to find it is pure
 *     overhead. A modal would be worse still: it would close on every insert,
 *     so writing three spawn lines means opening it three times.
 *   - API CALLS. The panel stays dockable, because reading the doc pane beside
 *     your code is most of its value. This covers the other half -- "I know
 *     which call I want, put it in" -- without giving up the editor view.
 *
 * Plus examples (open as a new script) and the File commands, so there is one
 * keyboard route to everything rather than four.
 *
 * Insertion deliberately reuses the panels' own functions (IDE.api.templateFor,
 * IDE.templates.insert, IDE.examples.openAsScript, IDE.scriptsPanel.commands),
 * so a snippet inserted from here is byte-identical to one inserted from the
 * panel and cannot drift from it.
 */
(function () {
  var IDE = window.IDE, $ = IDE.$;
  var MAX_ROWS = 40;

  var back = $("paletteBack"), input = $("paletteInput"), listEl = $("paletteList");
  var rows = [], sel = 0, lastFocus = null, kindFilter = null;

  /* ---- the searchable universe ------------------------------------------
     Built lazily on first open: 50_api / 52_templates / 65_examples all load
     before this file, but the data is only needed once the user asks for it,
     and building ~1,300 API entries + templates up front would be work done
     for a feature many sessions never touch. */
  var UNIVERSE = null;

  function build() {
    if (UNIVERSE) return UNIVERSE;
    var u = [];

    (IDE.scriptsPanel && IDE.scriptsPanel.commands || []).forEach(function (c) {
      if (c.sep) return;
      u.push({ kind: "cmd", label: c.label, hint: "command",
               run: function () { c.run(); } });
    });
    u.push({ kind: "cmd", label: "Assistant settings", hint: "command",
             run: function () { if (IDE.settings) IDE.settings.open(); } });
    u.push({ kind: "cmd", label: "Examples gallery", hint: "command",
             run: function () { if (IDE.examples) IDE.examples.open(); } });
    u.push({ kind: "cmd", label: "Reset the panel layout", hint: "command",
             run: function () { if (IDE.dock) IDE.dock.reset(); } });

    (IDE.api && IDE.api.model ? IDE.api.model() : []).forEach(function (ns) {
      (ns.calls || []).forEach(function (c) {
        u.push({ kind: ns.native ? "native" : "ess", label: c.path,
                 detail: c.sig || "", hint: ns.native ? "native" : "Ess",
                 run: function () { IDE.editor.insertSnippet(IDE.api.templateFor(c)); } });
      });
    });

    (IDE.templates && IDE.templates.list ? IDE.templates.list() : []).forEach(function (t) {
      u.push({ kind: "tpl", label: t.name, detail: t.cat + (t.sub ? " · " + t.sub : ""),
               hint: "template",
               run: function () { IDE.templates.insert(t.name); } });
    });

    (IDE.examples && IDE.examples.list ? IDE.examples.list() : []).forEach(function (x) {
      u.push({ kind: "ex", label: x.name, detail: x.desc, hint: "example",
               run: function () { IDE.examples.openAsScript(x); } });
    });

    UNIVERSE = u;
    return u;
  }

  /* Subsequence match with a light score: a prefix hit beats a word-boundary
     hit beats a scattered one, so typing "eplpose" still finds Ess.Player.pose
     but exact prefixes stay on top. Deliberately not fuzzy-with-typos --
     inserting the WRONG API call silently is worse than finding nothing. */
  /* Ess outranks the engine natives at equal match quality, and Ess.Easy above
     the rest of Ess -- the same ordering the editor's autocomplete already
     uses. Without it, searching "player" returned nothing but Player.* natives
     (a prefix match) and buried Ess.Player.* (a word-boundary match) below the
     fold, which is backwards for a framework-first IDE. Commands rank high
     because an empty-ish query is nearly always someone after a command. */
  var BIAS = { cmd: 260, ess: 120, tpl: 40, ex: 30, native: 0 };

  function score(item, q) {
    var hay = item.label.toLowerCase();
    var bias = BIAS[item.kind] || 0;
    if (item.kind === "ess" && hay.indexOf("ess.easy.") === 0) bias += 60;
    /* A match at a SEGMENT boundary counts almost as much as one at position 0.
       Scoring the raw string put `Player.Unbind` (prefix) above
       `Ess.Player.pose` (offset 4) for the query "player" -- i.e. the `Ess.`
       namespace was charged as a penalty for being namespaced. Segment-aware
       scoring puts them in the same tier and lets the kind bias decide. */
    if (hay.indexOf(q) === 0) return 1000 + bias - hay.length;
    var segs = hay.split(".");
    for (var s = 0; s < segs.length; s++) {
      if (segs[s].indexOf(q) === 0) return 950 + bias - hay.length;
    }
    var i = hay.indexOf(q);
    if (i > 0) return (/[\s_]/.test(hay[i - 1]) ? 700 : 500) + bias - hay.length;
    /* subsequence */
    var hi = 0, qi = 0, gaps = 0;
    while (hi < hay.length && qi < q.length) {
      if (hay[hi] === q[qi]) qi++;
      else if (qi > 0) gaps++;
      hi++;
    }
    if (qi < q.length) {
      var d = (item.detail || "").toLowerCase();
      return d.indexOf(q) >= 0 ? 100 + bias - item.label.length : -1;
    }
    return 300 + bias - gaps - item.label.length;
  }

  var KIND_CLASS = { ess: "k-ess", native: "k-native", tpl: "k-tpl", ex: "k-ex", cmd: "k-cmd" };

  function render(q) {
    q = (q || "").trim().toLowerCase();
    var pool = build();
    /* Scoped mode: opened from a specific entry point (e.g. "Spawn templates"),
       so only that kind is in play and an empty query lists it rather than
       falling back to commands. */
    if (kindFilter) {
      pool = pool.filter(function (r) { return r.kind === kindFilter; });
      if (!q) {
        rows = pool.slice(0, MAX_ROWS);
        sel = 0; paint(); return;
      }
    }
    if (!q) {
      /* Empty query: commands only. Dumping 1,300 API calls at someone who has
         just opened the palette is noise, not help. */
      rows = pool.filter(function (r) { return r.kind === "cmd"; });
    } else {
      var scored = [];
      for (var i = 0; i < pool.length; i++) {
        var s = score(pool[i], q);
        if (s >= 0) scored.push({ s: s, r: pool[i] });
      }
      scored.sort(function (a, b) { return b.s - a.s; });
      rows = scored.slice(0, MAX_ROWS).map(function (x) { return x.r; });
    }
    sel = 0;
    paint();
  }

  function paint() {
    listEl.innerHTML = "";
    if (!rows.length) {
      var e = document.createElement("div");
      e.className = "palette-empty";
      e.textContent = "No match. Nothing in the bundled reference is called that.";
      listEl.appendChild(e);
      return;
    }
    rows.forEach(function (r, i) {
      var el = document.createElement("div");
      el.className = "palette-row" + (i === sel ? " on" : "");
      el.setAttribute("role", "option");
      el.setAttribute("aria-selected", i === sel ? "true" : "false");
      el.id = "pal-row-" + i;
      var k = document.createElement("span");
      k.className = "palette-kind " + (KIND_CLASS[r.kind] || "");
      k.textContent = r.hint;
      var l = document.createElement("span");
      l.className = "palette-label";
      l.textContent = r.label;
      el.appendChild(k); el.appendChild(l);
      if (r.detail) {
        var d = document.createElement("span");
        d.className = "palette-detail";
        d.textContent = r.detail;
        el.appendChild(d);
      }
      el.onmousedown = function (ev) { ev.preventDefault(); sel = i; choose(); };
      listEl.appendChild(el);
    });
    var on = listEl.children[sel];
    if (on && on.scrollIntoView) on.scrollIntoView({ block: "nearest" });
    input.setAttribute("aria-activedescendant", on ? on.id : "");
  }

  function move(d) {
    if (!rows.length) return;
    sel = (sel + d + rows.length) % rows.length;
    paint();
  }

  function choose() {
    var r = rows[sel];
    if (!r) return;
    close();
    try { r.run(); } catch (e) { /* a bad row must not wedge the palette */ }
  }

  /* opts: {kind, placeholder} -- omit for the full palette. */
  function open(opts) {
    opts = opts || {};
    kindFilter = opts.kind || null;
    lastFocus = document.activeElement;
    back.classList.remove("hidden");
    input.value = "";
    input.placeholder = opts.placeholder ||
      (kindFilter === "tpl" ? "Search spawnable template names…"
                            : "Search calls, templates, examples and commands…");
    render("");
    input.focus();
  }

  function close() {
    kindFilter = null;
    back.classList.add("hidden");
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }
    lastFocus = null;
  }

  function isOpen() { return !back.classList.contains("hidden"); }

  input.addEventListener("input", function () { render(this.value); });
  input.addEventListener("keydown", function (e) {
    if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
    else if (e.key === "Enter") { e.preventDefault(); choose(); }
    else if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "Home" && !this.value) { e.preventDefault(); sel = 0; paint(); }
  });
  back.addEventListener("mousedown", function (e) { if (e.target === back) close(); });

  /* Ctrl/Cmd+K from anywhere, including inside CodeMirror. Registered in the
     capture phase so the editor's own keymap does not eat it first. */
  document.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === "k" || e.key === "K")) {
      e.preventDefault();
      e.stopPropagation();
      isOpen() ? close() : open();
    }
  }, true);

  IDE.palette = { open: open, close: close, isOpen: isOpen };
})();
