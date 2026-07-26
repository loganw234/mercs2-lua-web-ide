/* 52_templates.js -- the spawnable-template names (window.MERCS_TEMPLATES, scraped by
   tools/gen_templates.py from community-built spawn menus -- see the credit line below).

   This used to be a sidebar panel with a category tree. It is now DATA ONLY, surfaced through the
   command palette (66_palette.js, or the ⬢ button in the activity bar) instead, because looking up a
   template is pure string search: you nearly always know a fragment of the name already, and expanding
   a category tree to find it is overhead. A modal would have been worse than either -- it closes on
   every insert, so writing three spawn lines means opening it three times.

   The same data still backs the editor's in-string autocomplete (20_editor.js) and the linter's
   unknown-template warning (25_lint.js); neither went through the panel. */
(function () {
  var IDE = window.IDE;
  var data = window.MERCS_TEMPLATES || { categories: [] };

  /* Flat list: {name, sub, cat}. Built once at load -- it is a few thousand short strings, and both
     the palette and the linter want it. The category TREE is no longer built at all, which is the
     point: it was ~2,000 DOM nodes rendered into a container nothing displayed. */
  var FLAT = [];
  (data.categories || []).forEach(function (cat) {
    (cat.items || []).forEach(function (it) {
      FLAT.push({ name: it.name, sub: it.sub || "", cat: cat.name || "" });
    });
  });

  IDE.templates = {
    list: function () { return FLAT; },
    credit: function () { return data._credit || ""; },
    insert: function (name) { IDE.editor.insertSnippet('"' + name + '"'); }
  };
})();
