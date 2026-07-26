/* 61_dock.js -- a small hand-built docking layout.
 *
 * Why hand-built and not a library: the app is a deliberately offline, zero-dep
 * single-file bundle with its own theme. A docking library (dockview,
 * golden-layout) brings 30-70KB and its own CSS to fight. What this app needs is
 * bounded -- splittable regions, drag a tab to a new region, persist -- so it is
 * a few hundred lines here instead.
 *
 * MODEL. The layout is a tree:
 *   split = { t:'split', dir:'row'|'col', kids:[node,...], sizes:[pct,...] }
 *   leaf  = { t:'leaf', panels:[id,...], active:id }
 * Leaves hold registered panels, shown as a tab strip over one visible body.
 * Splits arrange their children left-right (row) or top-bottom (col) with a
 * draggable gutter between each pair. The whole tree serialises to localStorage.
 *
 * PANELS are registered once with their real content element; the dock only ever
 * moves that element between leaf bodies, so panel internal state is never lost.
 *
 * IDE.dock API:
 *   register(id, {title, closable})   -- content el is #panel<Id>, taken from the pool
 *   mount(rootEl)                     -- build DOM from the saved or default tree
 *   show(id)                          -- reveal + focus a panel (re-adds if closed)
 *   isOpen(id) / on(evt, fn)          -- 'change' fires after any layout mutation
 *   reset()                           -- back to the default layout
 */
(function () {
  var IDE = window.IDE, $ = IDE.$;
  var KEY = "m2ide.dock.v1";

  var panels = {};          /* id -> {id, title, el, closable} */
  var order = [];           /* registration order, for the activity bar */
  var tree = null;          /* the live layout tree */
  var root = null;          /* the mount element */
  var listeners = [];

  function emit() { for (var i = 0; i < listeners.length; i++) listeners[i](); persist(); }

  /* ---- tree helpers ------------------------------------------------------ */

  function leaf(ids, active) {
    return { t: "leaf", panels: ids.slice(), active: active || ids[0] };
  }
  function split(dir, kids, sizes) {
    return { t: "split", dir: dir, kids: kids, sizes: sizes || evenSizes(kids.length) };
  }
  function evenSizes(n) {
    var s = [], each = 100 / n;
    for (var i = 0; i < n; i++) s.push(each);
    return s;
  }

  /* Depth-first walk, giving (node, parent, indexInParent). */
  function walk(node, fn, parent, idx) {
    fn(node, parent, idx);
    if (node.t === "split") {
      for (var i = 0; i < node.kids.length; i++) walk(node.kids[i], fn, node, i);
    }
  }

  function findPanelLeaf(id) {
    var hit = null;
    walk(tree, function (n) {
      if (n.t === "leaf" && n.panels.indexOf(id) !== -1) hit = n;
    });
    return hit;
  }

  /* Drop a leaf that has become empty, collapsing single-child splits so the
     tree never accumulates useless wrappers. */
  function prune() {
    var changed = true;
    while (changed) {
      changed = false;
      walk(tree, function (n) {
        if (n.t !== "split") return;
        for (var i = n.kids.length - 1; i >= 0; i--) {
          var k = n.kids[i];
          if (k.t === "leaf" && k.panels.length === 0) {
            n.kids.splice(i, 1); n.sizes.splice(i, 1); changed = true;
          }
        }
      });
      /* unwrap a 1-child split into its child */
      if (tree.t === "split" && tree.kids.length === 1) { tree = tree.kids[0]; changed = true; }
      walk(tree, function (n, parent, idx) {
        if (n.t === "split" && n.kids.length === 1 && parent) {
          parent.kids[idx] = n.kids[0]; changed = true;
        }
        /* Only re-even the sizes when the count actually drifted -- doing it
           unconditionally wiped the intended default proportions on every
           mount. When a child was removed, rescale the survivors to fill. */
        if (n.t === "split" && n.sizes.length !== n.kids.length) {
          n.sizes = evenSizes(n.kids.length);
        }
      });
    }
  }

  /* ---- default layout ---------------------------------------------------- */
  /* Matches the requested shape: narrow tool sidebar | editor-over-console |
     right column split vertically into map over assistant. */
  function defaultTree() {
    var have = function (id) { return !!panels[id]; };
    /* Examples is a modal and Templates is palette-served, so neither is here.
       Two tabs fit comfortably where four were clipped at 1366 with nothing to
       indicate the missing ones existed. */
    var sideIds = ["scripts", "api", "inspect"].filter(have);
    /* Output and Watch share the bottom leaf as tabs by default; the user can
       drag Watch out to see watches alongside results. */
    var consoleIds = ["output", "watch"].filter(have);
    var editorCol = split("col",
      [leaf(["editor"]), leaf(consoleIds.length ? consoleIds : ["editor"])],
      [68, 32]);
    var rightKids = [];
    if (have("map")) rightKids.push(leaf(["map"]));
    if (have("assist")) rightKids.push(leaf(["assist"]));
    var kids = [leaf(sideIds), editorCol];
    var sizes = [17, 55];
    if (rightKids.length) {
      kids.push(rightKids.length > 1 ? split("col", rightKids, [42, 58]) : rightKids[0]);
      sizes.push(28);
    } else { sizes = [22, 78]; }
    return split("row", kids, sizes);
  }

  /* ---- rendering --------------------------------------------------------- */

  function render() {
    /* Detach every panel to the hidden pool first, so only the panels that are
       the active tab of some leaf end up back in a visible body. Otherwise an
       inactive tab's element lingers in whatever body it was last rendered
       into. Moving a node preserves its state (CodeMirror included). */
    for (var id in panels) pool().appendChild(panels[id].el);
    root.textContent = "";
    root.appendChild(renderNode(tree));
    /* CodeMirror and the map canvas re-measure on resize; nudge them now that
       they are back in a sized container. */
    try { window.dispatchEvent(new Event("resize")); } catch (e) {}
  }

  function pool() {
    var p = $("dockPool");
    if (!p) { p = document.createElement("div"); p.id = "dockPool"; p.style.display = "none"; document.body.appendChild(p); }
    return p;
  }

  function renderNode(node) {
    return node.t === "leaf" ? renderLeaf(node) : renderSplit(node);
  }

  function renderSplit(node) {
    var box = document.createElement("div");
    /* `d-` prefix: the modifier used to be a bare "row"/"col", which collided with
       the results list's generic `.row` rule (40_console.js) -- so every horizontal
       split silently inherited `padding: 5px 48px 5px 0` and every vertical gutter
       inherited it too, rendering 48px wide with a stray border. That is what the
       "oddly wide grab bar" was: result-row styling leaking into the layout engine. */
    box.className = "dsplit d-" + node.dir;
    node.collapsed = node.collapsed || [];
    /* Share the freed space among whoever is left. The stored `sizes` are
       percentages of the WHOLE split, so using them as-is after a collapse
       leaves the collapsed cell's share as dead space -- the panel hid and
       nothing grew, which is the opposite of the point. Re-normalise the
       visible cells so their percentages sum to 100 while keeping their
       proportions to each other; `sizes` itself is untouched, so restoring
       puts everything back exactly where it was. */
    var visibleTotal = 0;
    node.kids.forEach(function (_, i) { if (!node.collapsed[i]) visibleTotal += node.sizes[i]; });
    if (visibleTotal <= 0) visibleTotal = 100;

    node.kids.forEach(function (kid, i) {
      var cell = document.createElement("div");
      cell.className = "dcell";
      if (node.collapsed[i]) {
        /* Collapsed: the panel slides away to a thin strip and its space goes to
           the neighbours. The strip IS the restore control -- a panel that
           vanished with no way back would just be `close` with extra steps. */
        cell.classList.add("collapsed");
        cell.appendChild(collapsedStrip(node, i, kid));
      } else {
        cell.style.flexBasis = (node.sizes[i] / visibleTotal * 100) + "%";
        cell.appendChild(renderNode(kid));
      }
      box.appendChild(cell);
      if (i < node.kids.length - 1) box.appendChild(gutter(node, i, box));
    });
    return box;
  }

  /* The names of the panels inside a node, for labelling a collapsed strip. */
  function titlesIn(node) {
    var out = [];
    walk(node, function (n) {
      if (n.t !== "leaf") return;
      n.panels.forEach(function (id) { if (panels[id]) out.push(panels[id].title); });
    });
    return out;
  }

  function collapsedStrip(node, i, kid) {
    var names = titlesIn(kid);
    var label = names.length ? names.join(" · ") : "Panel";
    var b = document.createElement("button");
    b.type = "button";
    b.className = "dstrip d-" + node.dir;
    b.title = "Show " + label;
    b.setAttribute("aria-label", "Show " + label);
    b.setAttribute("aria-expanded", "false");
    var t = document.createElement("span");
    t.className = "dstrip-label";
    t.textContent = label;
    b.appendChild(t);
    b.onclick = function () { setCollapsed(node, i, false); };
    return b;
  }

  function setCollapsed(node, i, val) {
    node.collapsed = node.collapsed || [];
    if (val) {
      /* Never collapse the last visible child -- that would leave an empty
         split with no way to get anything back. */
      var visible = 0;
      for (var k = 0; k < node.kids.length; k++) if (!node.collapsed[k]) visible++;
      if (visible <= 1) return false;
    }
    node.collapsed[i] = !!val;
    render();
    emit();
    return true;
  }

  function gutter(node, i, box) {
    var g = document.createElement("div");
    g.className = "dgutter d-" + node.dir;
    node.collapsed = node.collapsed || [];

    /* Two chevrons, each collapsing the neighbour it points at. One button would
       be ambiguous about WHICH side it hides; picking "the smaller one"
       automatically is worse still, because the target changes as you resize.
       Hover-only, so the gutter stays a hairline until you go looking. */
    function chev(side, glyph) {
      var idx = side === "before" ? i : i + 1;
      if (node.collapsed[idx]) return null;             /* already hidden */
      var b = document.createElement("button");
      b.type = "button";
      b.className = "dchev " + side;
      b.textContent = glyph;
      var what = titlesIn(node.kids[idx]).join(" · ") || "panel";
      b.title = "Hide " + what;
      b.setAttribute("aria-label", "Hide " + what);
      b.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
      b.onclick = function (e) { e.stopPropagation(); setCollapsed(node, idx, true); };
      return b;
    }
    var horiz = node.dir === "row";
    var c1 = chev("before", horiz ? "‹" : "⌃");
    var c2 = chev("after", horiz ? "›" : "⌄");
    if (c1) g.appendChild(c1);
    if (c2) g.appendChild(c2);

    g.addEventListener("pointerdown", function (e) {
      /* Dragging against a collapsed neighbour is meaningless -- it has no
         percentage to trade. Restore it first (one click on its strip). */
      if (node.collapsed[i] || node.collapsed[i + 1]) return;
      e.preventDefault();
      g.setPointerCapture(e.pointerId);
      var cells = Array.prototype.filter.call(box.children, function (c) { return c.classList.contains("dcell"); });
      var a = cells[i], b = cells[i + 1];
      var horiz = node.dir === "row";
      var start = horiz ? e.clientX : e.clientY;
      var aSize = horiz ? a.offsetWidth : a.offsetHeight;
      var bSize = horiz ? b.offsetWidth : b.offsetHeight;
      var total = aSize + bSize, pctTotal = node.sizes[i] + node.sizes[i + 1];
      function mv(ev) {
        var d = (horiz ? ev.clientX : ev.clientY) - start;
        var an = Math.max(60, Math.min(total - 60, aSize + d));
        var ap = pctTotal * (an / total);
        node.sizes[i] = ap; node.sizes[i + 1] = pctTotal - ap;
        a.style.flexBasis = node.sizes[i] + "%";
        b.style.flexBasis = node.sizes[i + 1] + "%";
      }
      function up() {
        g.removeEventListener("pointermove", mv);
        g.removeEventListener("pointerup", up);
        persist();
      }
      g.addEventListener("pointermove", mv);
      g.addEventListener("pointerup", up);
    });
    return g;
  }

  /* Flag which edges of a tab strip have content scrolled out of view, so CSS
     can fade them. Cheap enough to call on scroll and on resize. */
  function markOverflow(strip) {
    if (!strip || !strip.isConnected) return;
    var max = strip.scrollWidth - strip.clientWidth;
    strip.classList.toggle("cut-l", strip.scrollLeft > 1);
    strip.classList.toggle("cut-r", max > 1 && strip.scrollLeft < max - 1);
  }

  /* Re-evaluate every strip when the window changes size -- the whole point is
     that this app is used at widths its author does not control. */
  var roTimer = null;
  window.addEventListener("resize", function () {
    clearTimeout(roTimer);
    roTimer = setTimeout(function () {
      Array.prototype.forEach.call(document.querySelectorAll(".dtabs"), markOverflow);
    }, 100);
  });

  function renderLeaf(node) {
    var box = document.createElement("div");
    box.className = "dleaf";
    box._node = node;

    var strip = document.createElement("div");
    strip.className = "dtabs";
    strip.setAttribute("role", "tablist");
    /* The strip scrolls but its scrollbar is hidden for looks, so when it
       overflows the extra tabs are simply invisible with nothing to suggest
       they exist -- at 1366x768 "API" was clipped mid-word and "Templates"
       vanished entirely. A fade on the overflowing edge says "there is more",
       wheel-to-scroll makes it reachable without a visible bar, and the active
       tab is scrolled into view so summoning a panel from the activity bar
       always shows its tab. */
    var activeTab = null;
    node.panels.forEach(function (id) {
      var p = panels[id]; if (!p) return;
      var on = id === node.active;
      var tab = document.createElement("div");
      tab.className = "dtab" + (on ? " on" : "");
      tab.draggable = true;
      tab.dataset.panel = id;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", on ? "true" : "false");
      tab.tabIndex = on ? 0 : -1;
      var lbl = document.createElement("span");
      lbl.className = "dtab-label"; lbl.textContent = p.title;
      tab.appendChild(lbl);
      if (p.closable) {
        var x = document.createElement("button");
        x.type = "button";
        x.className = "dtab-x"; x.textContent = "✕";
        x.title = "Close " + p.title;
        x.setAttribute("aria-label", "Close " + p.title);
        x.onclick = function (e) { e.stopPropagation(); closePanel(id); };
        tab.appendChild(x);
      }
      function activate() { node.active = id; render(); emit(); }
      tab.onclick = activate;
      tab.onkeydown = function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate(); }
      };
      wireTabDrag(tab, id);
      strip.appendChild(tab);
      if (on) activeTab = tab;
    });
    /* Horizontal wheel scrolling: a vertical wheel over the strip scrolls it,
       which is the only pointer route to a clipped tab without a scrollbar. */
    strip.addEventListener("wheel", function (e) {
      if (strip.scrollWidth <= strip.clientWidth) return;
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault();
      strip.scrollLeft += e.deltaY;
      markOverflow(strip);
    }, { passive: false });
    strip.addEventListener("scroll", function () { markOverflow(strip); });
    box.appendChild(strip);
    /* After layout: reveal the active tab and work out which edges are cut. */
    setTimeout(function () {
      if (activeTab && activeTab.scrollIntoView) {
        try { activeTab.scrollIntoView({ block: "nearest", inline: "nearest" }); } catch (e) {}
      }
      markOverflow(strip);
    }, 0);

    var body = document.createElement("div");
    body.className = "dbody";
    var active = panels[node.active];
    if (active) { active.el.classList.remove("hidden"); body.appendChild(active.el); }
    box.appendChild(body);

    wireDropZones(box, node);
    return box;
  }

  /* ---- drag to re-dock --------------------------------------------------- */

  var dragging = null;

  function wireTabDrag(tab, id) {
    tab.addEventListener("dragstart", function (e) {
      dragging = id;
      try { e.dataTransfer.setData("text/plain", id); e.dataTransfer.effectAllowed = "move"; } catch (x) {}
      tab.classList.add("dragging");
    });
    tab.addEventListener("dragend", function () {
      tab.classList.remove("dragging"); dragging = null;
      var o = root.querySelector(".dropzone.show"); if (o) o.classList.remove("show");
    });
  }

  function wireDropZones(box, node) {
    var zone = null;
    box.addEventListener("dragover", function (e) {
      if (!dragging) return;
      e.preventDefault();
      var r = box.getBoundingClientRect();
      var px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
      var edge = 0.28, where;
      if (px < edge) where = "left"; else if (px > 1 - edge) where = "right";
      else if (py < edge) where = "top"; else if (py > 1 - edge) where = "bottom";
      else where = "center";
      if (where !== zone) { zone = where; paintZone(box, where); }
    });
    box.addEventListener("dragleave", function (e) {
      if (!box.contains(e.relatedTarget)) { zone = null; clearZone(box); }
    });
    box.addEventListener("drop", function (e) {
      if (!dragging) return;
      e.preventDefault(); e.stopPropagation();
      var id = dragging; dragging = null; clearZone(box);
      dropPanel(id, node, zone || "center");
      zone = null;
    });
  }

  function ensureOverlay(box) {
    var ov = box.querySelector(":scope > .dropzone");
    if (!ov) { ov = document.createElement("div"); ov.className = "dropzone"; box.appendChild(ov); }
    return ov;
  }
  function paintZone(box, where) {
    var ov = ensureOverlay(box);
    ov.className = "dropzone show z-" + where;
  }
  function clearZone(box) {
    var ov = box.querySelector(":scope > .dropzone"); if (ov) ov.className = "dropzone";
  }

  function dropPanel(id, targetLeaf, where) {
    var srcLeaf = findPanelLeaf(id);
    if (!srcLeaf) return;
    if (srcLeaf === targetLeaf && (where === "center" || targetLeaf.panels.length === 1)) return;
    /* remove from source */
    srcLeaf.panels.splice(srcLeaf.panels.indexOf(id), 1);
    if (srcLeaf.active === id) srcLeaf.active = srcLeaf.panels[0];

    if (where === "center") {
      targetLeaf.panels.push(id); targetLeaf.active = id;
    } else {
      /* split the target leaf: wrap it in a split, add a new leaf for id */
      var dir = (where === "left" || where === "right") ? "row" : "col";
      var newLeaf = leaf([id], id);
      var pair = (where === "left" || where === "top") ? [newLeaf, cloneLeaf(targetLeaf)] : [cloneLeaf(targetLeaf), newLeaf];
      /* turn targetLeaf into a split in place */
      var replacement = split(dir, pair, [50, 50]);
      replaceNode(targetLeaf, replacement);
    }
    prune();
    render(); emit();
  }

  function cloneLeaf(l) { return { t: "leaf", panels: l.panels.slice(), active: l.active }; }

  function replaceNode(oldNode, newNode) {
    if (tree === oldNode) { tree = newNode; return; }
    walk(tree, function (n) {
      if (n.t === "split") {
        var i = n.kids.indexOf(oldNode);
        if (i !== -1) n.kids[i] = newNode;
      }
    });
  }

  function closePanel(id) {
    var l = findPanelLeaf(id); if (!l) return;
    l.panels.splice(l.panels.indexOf(id), 1);
    if (l.active === id) l.active = l.panels[0];
    if (panels[id].el.parentNode) pool().appendChild(panels[id].el);
    prune(); render(); emit();
  }

  /* ---- persistence ------------------------------------------------------- */

  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(tree)); } catch (e) {}
  }
  function load() {
    try {
      var t = JSON.parse(localStorage.getItem(KEY));
      if (t && validate(t)) return t;
    } catch (e) {}
    return null;
  }
  /* A saved tree can reference a panel that no longer exists (renamed/removed);
     drop those ids rather than render a blank tab. */
  function validate(node) {
    if (node.t === "leaf") {
      node.panels = node.panels.filter(function (id) { return panels[id]; });
      if (node.active && !panels[node.active]) node.active = node.panels[0];
      return true;
    }
    if (node.t === "split") { node.kids.forEach(validate); return node.kids.length > 0; }
    return false;
  }

  /* ---- public ------------------------------------------------------------ */

  IDE.dock = {
    register: function (id, opts) {
      opts = opts || {};
      var el = $("panel" + id.charAt(0).toUpperCase() + id.slice(1)) || $(id);
      if (!el) { return; }
      panels[id] = { id: id, title: opts.title || id, el: el, closable: opts.closable !== false };
      order.push(id);
    },
    mount: function (rootEl) {
      root = rootEl;
      tree = load() || defaultTree();
      validate(tree); prune();
      render();
    },
    show: function (id) {
      if (!panels[id]) return;
      var l = findPanelLeaf(id);
      if (!l) {
        /* re-add a closed panel to the first leaf */
        var first = null;
        walk(tree, function (n) { if (!first && n.t === "leaf") first = n; });
        if (!first) { tree = leaf([id], id); } else { first.panels.push(id); l = first; }
      }
      (l || findPanelLeaf(id)).active = id;
      render(); emit();
      var el = panels[id].el;
      var f = el.querySelector("input,textarea,button");
      if (f && id === "assist") f.focus();
    },
    isOpen: function (id) { return !!findPanelLeaf(id); },
    activeSomewhere: function (id) {
      var l = findPanelLeaf(id);
      return !!l && l.active === id;
    },
    close: function (id) { closePanel(id); },
    panels: function () { return order.slice(); },
    title: function (id) { return panels[id] && panels[id].title; },
    on: function (evt, fn) { if (evt === "change") listeners.push(fn); },
    reset: function () { tree = defaultTree(); render(); emit(); }
  };
})();
