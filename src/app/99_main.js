/* 99_main.js -- bootstrap. Restore the saved WS url, open the active script from the library (a #s= share
   link becomes a NEW script so it never overwrites anyone's work), connect, and pop the onboarding card if
   we're not live shortly after load. */
(function () {
  var IDE = window.IDE, $ = IDE.$;

  var savedWs = null; try { savedWs = localStorage.getItem(IDE.cfg.wsKey); } catch (e) {}
  if (savedWs) $("url").value = savedWs;

  var h = /[#&]s=([^&]+)/.exec(location.hash || "");
  if (h) {
    var shared = null;
    try { shared = decodeURIComponent(h[1]); } catch (e) {}
    if (shared != null) {
      IDE.store.create("Shared script", shared);   // emits "script" -> 55 loads it into the editor
      try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
    }
  }
  if (!IDE.editor.get()) IDE.editor.reset(IDE.store.active().code);
  IDE.scriptsPanel.render();

  IDE.bridge.connect($("url").value);
  setTimeout(function () { if (IDE.bridge.state() !== "open") $("onboard").hidden = false; }, 2500);
  IDE.editor.focus();
})();
