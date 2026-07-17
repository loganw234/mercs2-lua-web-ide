/* 70_blockhint.js -- after repeated failed connects, surface the "browser may be blocking it" card with an
   easy download. The standalone runs from disk with no cross-origin restriction, so that's the sure fix.
   Counts failed reconnect cycles; resets on a successful open or a fresh Connect click. */
(function () {
  var IDE = window.IDE, $ = IDE.$;
  var THRESHOLD = 10, fails = 0, shown = false, snoozed = false;

  function show() {
    if (shown || snoozed) return; shown = true;
    try { $("blockedUrl").textContent = $("url").value || IDE.cfg.defaultWs; } catch (e) {}
    $("onboard").hidden = true;          // supersede the generic onboarding card
    $("blocked").hidden = false;
  }
  function hide() { shown = false; $("blocked").hidden = true; }

  IDE.bus.on("status", function (s) {
    if (s === "open") { fails = 0; snoozed = false; hide(); }   // a real connect re-arms the hint for next time
    else if (s === "closed") { fails++; if (fails >= THRESHOLD) show(); }
  });

  // "The game's just closed right now" -- not a browser problem, stop offering fixes this session
  $("blockedSnooze").onclick = function () { snoozed = true; hide(); };

  // a fresh Connect click = "try again" -> reset the counter and dismiss the card
  var cbtn = $("connect");
  if (cbtn) cbtn.addEventListener("click", function () { if (IDE.bridge.state() !== "open") { fails = 0; hide(); } });

  $("blockedClose").onclick = function () { fails = 0; hide(); };   // snooze another ~10 tries

  // "Save this page instead": fetch our OWN served source (clean, not the mutated DOM) and download it.
  // Same-origin on the hosted https page; on file:// the user already has the file so it's moot.
  $("dlSelf").onclick = function () {
    fetch(location.href).then(function (r) { return r.text(); }).then(function (t) {
      var b = new Blob([t], { type: "text/html" }), a = document.createElement("a");
      a.href = URL.createObjectURL(b); a.download = "mercs2-lua-ide.html";
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    }).catch(function () { window.open(location.href, "_blank"); });
  };
})();
