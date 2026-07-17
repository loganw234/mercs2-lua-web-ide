/* 99_main.js -- bootstrap. Restore the saved WS url + script (or a #s= share link, or a starter), connect,
   and pop the onboarding card if we're not live shortly after load. */
(function () {
  var IDE = window.IDE, $ = IDE.$;

  var savedWs = null; try { savedWs = localStorage.getItem(IDE.cfg.wsKey); } catch (e) {}
  if (savedWs) $("url").value = savedWs;

  var script = null, h = /[#&]s=([^&]+)/.exec(location.hash || "");
  if (h) { try { script = decodeURIComponent(h[1]); } catch (e) {} }
  if (script == null) { try { script = localStorage.getItem(IDE.cfg.scriptKey); } catch (e) {} }
  if (script == null) {
    script = "-- Mercs2 Lua IDE - write Lua, hit Run (Ctrl/Cmd+Enter).\n" +
             "-- Type \"Ess.\" for autocomplete; browse the full API on the left.\n\n" +
             "return Ess.VERSION\n";
  }
  IDE.editor.set(script);

  IDE.bridge.connect($("url").value);
  setTimeout(function () { if (IDE.bridge.state() !== "open") $("onboard").hidden = false; }, 2500);
  IDE.editor.focus();
})();
