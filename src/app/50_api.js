/* 50_api.js -- the Ess API reference sidebar (from window.ESS_API, generated off CAPABILITIES.md) and the
   flat completion list the editor's autocomplete consumes. Click any call to insert it at the caret. */
(function () {
  var IDE = window.IDE, data = window.ESS_API || { namespaces: [], completions: [] };
  var tree = IDE.$("apiTree"), search = IDE.$("apiSearch");

  function build(filter) {
    filter = (filter || "").trim().toLowerCase();
    tree.innerHTML = "";
    data.namespaces.forEach(function (ns) {
      var nsHit = ns.name.toLowerCase().indexOf(filter) >= 0;
      var calls = ns.calls.filter(function (c) { return !filter || nsHit || c.path.toLowerCase().indexOf(filter) >= 0; });
      if (filter && !nsHit && !calls.length) return;

      var open = !!filter;
      var nsEl = document.createElement("div"); nsEl.className = "ns";
      nsEl.innerHTML = ns.name + '<span class="g">' + (ns.group || "") + "</span>";
      var wrap = document.createElement("div");
      function paint() {
        wrap.innerHTML = "";
        if (!open) return;
        if (ns.doc) { var d = document.createElement("div"); d.className = "nsdoc"; d.textContent = ns.doc; wrap.appendChild(d); }
        (filter ? calls : ns.calls).forEach(function (c) {
          var el = document.createElement("div"); el.className = "call";
          el.textContent = c.sig.replace(/^Ess\./, ""); el.title = c.sig;
          el.onclick = function () { IDE.editor.insertSnippet(insertForm(c)); };
          wrap.appendChild(el);
        });
      }
      nsEl.onclick = function () { open = !open; paint(); };
      tree.appendChild(nsEl); tree.appendChild(wrap); paint();
    });
    if (!tree.childElementCount) { var e = document.createElement("div"); e.className = "nsdoc"; e.textContent = "no matches"; tree.appendChild(e); }
  }

  // insert the call with empty parens + caret-friendly form (drop the arg names, keep the parens)
  function insertForm(c) {
    var hasArgs = /\([^)]/.test(c.sig);
    return c.path + (c.sig.indexOf("(") >= 0 ? (hasArgs ? "()" : "()") : "");
  }

  search.addEventListener("input", function () { build(search.value); });
  IDE.api = { completions: function () { return data.completions; }, build: build };
  build("");
})();
