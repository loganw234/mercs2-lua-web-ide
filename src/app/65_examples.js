/* 65_examples.js -- the Examples gallery (window.ESS_EXAMPLES, generated off the Ess repo's smoke-tested
   samples/recipes by tools/gen_examples.py). Click a card to expand a code preview; "Open as a new script"
   copies it into the library so the original stays pristine and experiments are free. */
(function () {
  var IDE = window.IDE, data = window.ESS_EXAMPLES || { categories: [] };
  var list = IDE.$("exList");

  data.categories.forEach(function (cat) {
    var h = document.createElement("div"); h.className = "excat"; h.textContent = cat.name;
    list.appendChild(h);
    cat.items.forEach(function (it) {
      var card = document.createElement("div"); card.className = "excard";
      var nm = document.createElement("div"); nm.className = "exname"; nm.textContent = it.name;
      var ds = document.createElement("div"); ds.className = "exdesc"; ds.textContent = it.desc;
      var code = document.createElement("div"); code.className = "excode"; code.textContent = it.code;
      var load = document.createElement("button"); load.className = "btn small go exload"; load.textContent = "Open as a new script";
      load.onclick = function (e) {
        e.stopPropagation();
        IDE.store.create(it.name, it.code);
        document.querySelector('.stab[data-p="scripts"]').click();
      };
      card.onclick = function () {
        var was = card.classList.contains("open");
        Array.prototype.forEach.call(list.querySelectorAll(".excard.open"), function (c) { c.classList.remove("open"); });
        card.classList.toggle("open", !was);
      };
      card.appendChild(nm); card.appendChild(ds); card.appendChild(code); card.appendChild(load);
      list.appendChild(card);
    });
  });
})();
