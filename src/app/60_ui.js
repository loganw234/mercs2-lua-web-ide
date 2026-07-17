/* 60_ui.js -- toolbar wiring: connect/disconnect, run/save/share, examples, output tabs, onboarding,
   status dot, and autosave to localStorage. */
(function () {
  var IDE = window.IDE, $ = IDE.$;

  var EXAMPLES = {
    "Hello - engine version": "-- confirm you're connected\nreturn Ess.VERSION",
    "Spawn a car and hop in": 'Ess.Easy.Vehicle.summon("Veyron")',
    "Airstrike on your reticle": "Ess.Easy.Airstrike.onTarget(0)",
    "Give cash + a weapon": 'Ess.Player.giveCash(100000)\nEss.Easy.Human.giveWeapon(Ess.Player.character(0), "RPG")',
    "Toast + HUD banner": 'Ess.UI.Toast("hello from the web IDE")\nEss.Hud.banner("WEB IDE")',
    "A repeating tick (F-free)": 'Ess.Loop.start("demo", 1, function()\n  Ess.UI.Toast("tick "..tostring(os and os.time and os.time() or "?"))\n  return true\nend)\n-- stop with:  Ess.Loop.stop("demo")'
  };
  var sel = $("examples");
  Object.keys(EXAMPLES).forEach(function (k) { var o = document.createElement("option"); o.value = k; o.textContent = k; sel.appendChild(o); });
  sel.onchange = function () { if (EXAMPLES[sel.value]) { IDE.editor.set(EXAMPLES[sel.value]); save(); } sel.value = ""; IDE.editor.focus(); };

  function flash(btn, msg) { var o = btn.textContent; btn.textContent = msg; setTimeout(function () { btn.textContent = o; }, 1100); }
  function save() { try { localStorage.setItem(IDE.cfg.scriptKey, IDE.editor.get()); } catch (e) {} }

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
