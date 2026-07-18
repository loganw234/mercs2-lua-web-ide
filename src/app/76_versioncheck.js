/* 76_versioncheck.js -- "Ess-version drift" warning. The bundled ess-api.json/natives.json data was
   generated against a specific Ess.VERSION (tools/gen_api.py stamps it in as window.ESS_API.essVersion).
   On each real connect, ask the game what Ess.VERSION it's actually running and compare -- a mismatch
   means the API reference/autocomplete/lint may be describing calls slightly differently than what's
   really loaded. One dismissible line, not a blocker. Dismissing remembers that EXACT (reference, game)
   pair -- if either side changes, the warning comes back fresh. */
(function () {
  var IDE = window.IDE, $ = IDE.$, KEY = "m2ide.verskip.v1";
  var refVersion = (window.ESS_API && window.ESS_API.essVersion) || null;
  if (!refVersion) return;   // data built without a resolvable Ess.VERSION -- nothing to compare against

  var skip = null;
  try { skip = localStorage.getItem(KEY); } catch (e) {}

  IDE.bus.on("status", function (s) {
    if (s !== "open") return;
    IDE.bridge.run("return Ess.VERSION").then(function (r) {
      if (!r.ok || r.value == null) return;
      var gameVersion = String(r.value).replace(/^"|"$/g, "").trim();
      if (!gameVersion || gameVersion === refVersion) { $("verbar").classList.add("hidden"); return; }
      var pairKey = refVersion + ">" + gameVersion;
      if (skip === pairKey) return;
      $("verText").textContent = "The API reference/autocomplete is from Ess " + refVersion +
        ", but the game's running " + gameVersion + " — some calls may differ.";
      $("verbar").classList.remove("hidden");
      $("verClose").onclick = function () {
        skip = pairKey;
        try { localStorage.setItem(KEY, pairKey); } catch (e) {}
        $("verbar").classList.add("hidden");
      };
    });
  });
})();
