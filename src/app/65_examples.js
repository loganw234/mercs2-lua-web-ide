/* 65_examples.js -- the Examples gallery (window.ESS_EXAMPLES, generated off the Ess repo's smoke-tested
   samples/recipes by tools/gen_examples.py). Click a card to expand a code preview; "Open as a new script"
   copies it into the library so the original stays pristine and experiments are free.

   This is a MODAL rather than a dock panel, because picking an example is a terminal action: it creates a
   new script and switches to it, so there is nothing left in the gallery to look at. A panel would hold
   permanent space for something you visit occasionally. (Contrast the API panel, which you read WHILE
   writing code -- that one stays dockable.)

   The old "open as a new script" handler clicked `.stab[data-p="scripts"]`, a tab the dock refactor
   deleted, so it threw a TypeError on a null querySelector and the button did nothing at all. */
(function () {
  var IDE = window.IDE, $ = IDE.$;
  var data = window.ESS_EXAMPLES || { categories: [] };
  var list = $("exList");

  /* Flat model, so both the gallery and the command palette read one source. */
  var FLAT = [];
  data.categories.forEach(function (cat) {
    (cat.items || []).forEach(function (it) {
      FLAT.push({ name: it.name || "", desc: it.desc || "", code: it.code || "", cat: cat.name || "" });
    });
  });

  function openAsScript(it) {
    IDE.store.create(it.name, it.code);
    close();
    if (IDE.dock && IDE.dock.show) IDE.dock.show("scripts");
  }

  function build(filter) {
    filter = (filter || "").trim().toLowerCase();
    list.innerHTML = "";
    var shown = 0;
    data.categories.forEach(function (cat) {
      var items = (cat.items || []).filter(function (it) {
        if (!filter) return true;
        return (it.name + " " + it.desc + " " + cat.name).toLowerCase().indexOf(filter) >= 0;
      });
      if (!items.length) return;
      var h = document.createElement("div"); h.className = "excat"; h.textContent = cat.name;
      list.appendChild(h);
      items.forEach(function (it) {
        shown++;
        var card = document.createElement("div"); card.className = "excard";
        card.tabIndex = 0;
        card.setAttribute("role", "button");
        card.setAttribute("aria-label", it.name + " — " + it.desc);
        var nm = document.createElement("div"); nm.className = "exname"; nm.textContent = it.name;
        var ds = document.createElement("div"); ds.className = "exdesc"; ds.textContent = it.desc;
        var code = document.createElement("div"); code.className = "excode"; code.textContent = it.code;
        var load = document.createElement("button");
        load.type = "button";
        load.className = "btn small go exload";
        load.textContent = "Open as a new script";
        load.onclick = function (e) { e.stopPropagation(); openAsScript(it); };
        function toggle() {
          var was = card.classList.contains("open");
          Array.prototype.forEach.call(list.querySelectorAll(".excard.open"), function (c) {
            c.classList.remove("open");
          });
          card.classList.toggle("open", !was);
        }
        card.onclick = toggle;
        card.onkeydown = function (e) {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
        };
        card.appendChild(nm); card.appendChild(ds); card.appendChild(code); card.appendChild(load);
        list.appendChild(card);
      });
    });
    if (!shown) {
      var e = document.createElement("div");
      e.className = "nsdoc";
      e.textContent = "no examples match that";
      list.appendChild(e);
    }
  }

  function open() {
    $("examplesModal").classList.remove("hidden");
    var s = $("exSearch");
    if (s) { s.value = ""; build(""); }
    IDE.ui.trapFocus($("examplesModal"), { onEscape: close });
  }
  function close() {
    $("examplesModal").classList.add("hidden");
    IDE.ui.releaseFocus();
  }

  $("exClose").onclick = close;
  $("examplesModal").addEventListener("mousedown", function (e) {
    if (e.target === $("examplesModal")) close();     /* backdrop click */
  });
  $("exSearch").addEventListener("input", function () { build(this.value); });

  build("");

  IDE.examples = { open: open, close: close, list: function () { return FLAT; },
                   openAsScript: openAsScript };
})();
