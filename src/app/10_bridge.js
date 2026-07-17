/* 10_bridge.js -- wraps the vendored EssBridge WS client and re-broadcasts its events on IDE.bus.
   status -> "connecting"|"open"|"closed"|"error"; log -> {kind:"log"|"ws", line}. */
(function () {
  var IDE = window.IDE, B = null, state = "closed";
  IDE.bridge = {
    state: function () { return state; },
    connected: function () { return state === "open"; },
    connect: function (url) {
      if (B) { try { B.close(); } catch (e) {} B = null; }
      if (typeof EssBridge === "undefined") { state = "error"; IDE.bus.emit("status", "error"); return; }
      B = new EssBridge(url || IDE.cfg.defaultWs, {
        onStatus: function (s) { state = s; IDE.bus.emit("status", s); },
        onLog: function (l) { IDE.bus.emit("log", { kind: "log", line: l }); },
        onData: function (l) { IDE.bus.emit("log", { kind: "ws", line: l }); }
      });
      B.connect().catch(function () {});
    },
    disconnect: function () { if (B) { B.close(); B = null; } state = "closed"; IDE.bus.emit("status", "closed"); },
    run: function (code) { return (B && state === "open") ? B.run(code) : Promise.resolve({ ok: false, error: "not connected" }); }
  };
})();
