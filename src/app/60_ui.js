/* 60_ui.js -- toolbar + chrome wiring: connect/disconnect, run/save/share, the sidebar's Scripts/Examples/API
   tabs, output tabs, onboarding, status dot, and the debounced autosave into the script library. */
(function () {
  var IDE = window.IDE, $ = IDE.$;

  function flash(btn, msg) { var o = btn.textContent; btn.textContent = msg; setTimeout(function () { btn.textContent = o; }, 1100); }
  function save() { IDE.store.saveActive(IDE.editor.get()); }

  IDE.bus.on("status", function (s) {
    $("dot").className = "dot " + s; $("state").textContent = s;
    $("connect").textContent = (s === "open" || s === "connecting") ? "Disconnect" : "Connect";
    if (s === "open") $("onboard").hidden = true;
  });

  $("connect").onclick = function () {
    var st = IDE.bridge.state();
    if (st === "open" || st === "connecting") { IDE.bridge.disconnect(); }
    else { try { localStorage.setItem(IDE.cfg.wsKey, $("url").value); } catch (e) {} IDE.bridge.connect($("url").value); }
  };
  $("run").onclick = function () { IDE.run(); };
  $("save").onclick = function () { save(); flash($("save"), "Saved"); };
  IDE.bus.on("save", function () { save(); flash($("save"), "Saved"); });
  $("share").onclick = function () {
    var url = location.origin + location.pathname + "#s=" + encodeURIComponent(IDE.editor.get());
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { flash($("share"), "Link copied"); }, function () { prompt("Copy this link:", url); });
    else prompt("Copy this link:", url);
  };

  /* sidebar panels: Scripts / Examples / API */
  Array.prototype.forEach.call(document.querySelectorAll(".stab"), function (t) {
    t.onclick = function () {
      Array.prototype.forEach.call(document.querySelectorAll(".stab"), function (x) { x.classList.remove("on"); });
      t.classList.add("on");
      var which = t.getAttribute("data-p");
      $("panelScripts").classList.toggle("hidden", which !== "scripts");
      $("panelExamples").classList.toggle("hidden", which !== "examples");
      $("panelApi").classList.toggle("hidden", which !== "api");
    };
  });

  /* output tabs */
  Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (t) {
    t.onclick = function () {
      Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (x) { x.classList.remove("on"); });
      t.classList.add("on");
      var which = t.getAttribute("data-t");
      $("results").classList.toggle("hidden", which !== "results");
      $("log").classList.toggle("hidden", which !== "log");
    };
  });
  $("clr").onclick = function () { var on = document.querySelector(".tab.on").getAttribute("data-t"); IDE.console.clear(on); };
  $("onboardClose").onclick = function () { $("onboard").hidden = true; };

  var t = null;
  IDE.bus.on("editorchange", function () { clearTimeout(t); t = setTimeout(save, 700); });

  IDE.ui = { flash: flash, save: save };
})();
