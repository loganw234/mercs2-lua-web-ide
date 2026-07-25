/* 63_shell.js -- wires the docking layout to the app.
 *
 * Registers every panel with the dock, mounts it into #dockRoot, and builds the
 * left activity bar. The activity bar is the way back to a panel you closed or
 * lost: click an icon and the dock reveals that panel (re-adding it if it had
 * been closed), VS Code style. Panel *arrangement* is the dock's job; this file
 * only decides what exists and how to summon it.
 */
(function () {
  var IDE = window.IDE, $ = IDE.$;

  /* id -> {title, icon, activity}. Order here is the activity-bar order.
     `activity:false` = registered and dockable, but not a summon button
     (the editor and output are effectively always present). */
  var PANELS = [
    ["editor",    "Editor",    "‹›", false],
    ["output",    "Output",    "▤",  false],
    ["scripts",   "Scripts",   "❑",  true],
    ["api",       "API",       "ƒ",  true],
    ["inspect",   "Inspect",   "🔍", true],
    ["watch",     "Watch",     "◎",  true],
    ["assist",    "Assistant", "✦",  true],
    ["map",       "Map",       "🗺", true]
  ];

  PANELS.forEach(function (p) {
    IDE.dock.register(p[0], { title: p[1], closable: p[3] });
  });

  IDE.dock.mount($("dockRoot"));

  /* ---- activity bar ------------------------------------------------------ */
  var bar = $("activity");
  var buttons = {};
  PANELS.filter(function (p) { return p[3]; }).forEach(function (p) {
    var b = document.createElement("button");
    b.className = "actbtn";
    /* Icon-only: the glyph is decorative, the title is the only name, and a
       title is a tooltip rather than an accessible name. Say it properly. */
    b.setAttribute("aria-label", p[1]);
    b.type = "button";
    b.title = p[1];
    b.textContent = p[2];
    b.setAttribute("aria-label", p[1]);
    b.onclick = function () {
      /* If it's already the active tab of a visible leaf, a second click hides
         it (toggle); otherwise reveal + focus it. */
      if (IDE.dock.isOpen(p[0]) && b.classList.contains("active")) {
        IDE.dock.close ? IDE.dock.close(p[0]) : IDE.dock.show(p[0]);
      } else {
        IDE.dock.show(p[0]);
      }
    };
    buttons[p[0]] = b;
    bar.appendChild(b);
  });

  /* Keep the activity bar in sync: an icon is "active" when its panel is the
     visible tab of some leaf. */
  function sync() {
    PANELS.forEach(function (p) {
      var b = buttons[p[0]]; if (!b) return;
      b.classList.toggle("active", IDE.dock.activeSomewhere(p[0]));
      b.classList.toggle("present", IDE.dock.isOpen(p[0]));
    });
  }
  IDE.dock.on("change", sync);
  sync();

  /* Non-dock entries. Examples is a modal, not a panel, but it still belongs in
     the activity bar: that bar is "how do I get to X", and a user should not
     have to know which things happen to be docked. Sits after the panels with a
     hairline above it so the difference is visible without being explained. */
  var overlays = [
    ["Examples", "◫", function () { if (IDE.examples) IDE.examples.open(); }],
    /* Templates is a name lookup, which the palette does better than a tree --
       this opens the palette pre-filtered to templates rather than restoring a
       panel nobody needs open while they type. */
    ["Spawn templates  (Ctrl+K)", "⬢", function () {
      if (IDE.palette) IDE.palette.open({ kind: "tpl" });
    }],
    ["Search everything  (Ctrl+K)", "⌘", function () { if (IDE.palette) IDE.palette.open(); }]
  ];
  var rule = document.createElement("div");
  rule.className = "actrule";
  bar.appendChild(rule);
  overlays.forEach(function (o) {
    var b = document.createElement("button");
    b.className = "actbtn";
    b.type = "button";
    b.title = o[0];
    b.setAttribute("aria-label", o[0]);
    b.textContent = o[1];
    b.onclick = o[2];
    bar.appendChild(b);
  });

  /* A reset-layout affordance, tucked at the bottom of the activity bar. */
  var spacer = document.createElement("div");
  spacer.className = "actspace";
  bar.appendChild(spacer);
  var gear = document.createElement("button");
  gear.className = "actbtn dim";
  gear.type = "button";
  gear.title = "Settings";
  gear.setAttribute("aria-label", "Settings");
  gear.textContent = "⚙";
  gear.onclick = function () { if (IDE.settings) IDE.settings.open(); };
  bar.appendChild(gear);

  var reset = document.createElement("button");
  reset.className = "actbtn dim";
  reset.type = "button";
  reset.title = "Reset the panel layout";
  reset.setAttribute("aria-label", "Reset the panel layout");
  reset.textContent = "⟲";
  reset.onclick = function () { IDE.dock.reset(); };
  bar.appendChild(reset);

  /* ---- the File menu ------------------------------------------------------
     The library commands (new / import / export / backup / restore / deploy)
     used to live in a <select> inside the Scripts panel, which meant they were
     unreachable whenever that panel was closed -- and a <select> is the wrong
     control for running commands regardless. They are app-level, so they live
     in the top bar, built from the same IDE.scriptsPanel.commands list the
     palette uses. */
  var fileBtn = $("fileMenu");
  if (fileBtn) {
    fileBtn.onclick = function (e) {
      e.stopPropagation();
      var items = (IDE.scriptsPanel && IDE.scriptsPanel.commands || []).map(function (c) {
        return c.sep ? { sep: true } : { label: c.label, run: c.run };
      });
      items.push({ sep: true });
      items.push({ label: "Search everything…", hint: "Ctrl+K",
                   run: function () { if (IDE.palette) IDE.palette.open(); } });
      items.push({ label: "Examples gallery…", run: function () { if (IDE.examples) IDE.examples.open(); } });
      IDE.ui.menu(fileBtn, items);
    };
  }
})();
