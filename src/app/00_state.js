/* 00_state.js -- the shared IDE namespace, config, a $() helper, and a tiny pub/sub bus.
   Every module attaches to window.IDE; they're merged into one <script> at build time. */
window.IDE = window.IDE || {};
IDE.cfg = { wsKey: "m2ide.ws", scriptKey: "m2ide.script", defaultWs: "ws://127.0.0.1:27050" };
IDE.$ = function (id) { return document.getElementById(id); };
IDE.bus = (function () {
  var m = {};
  return {
    on: function (e, f) { (m[e] = m[e] || []).push(f); },
    emit: function (e, d) { (m[e] || []).forEach(function (f) { try { f(d); } catch (x) { console.error(x); } }); }
  };
})();
