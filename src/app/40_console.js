/* 40_console.js -- the two output panels: Results (your runs) and Log & telemetry (the live {type:log}/{ws}
   feed). Result shapes come from ess-bridge.run(): {ok, value, timedOut, error}. */
(function () {
  var IDE = window.IDE, results = IDE.$("results"), log = IDE.$("log"), pendingRow = null;
  function auto(el) { el.scrollTop = el.scrollHeight; }

  function pending(codeText) {
    var row = document.createElement("div"); row.className = "row";
    var c = document.createElement("span"); c.className = "code";
    c.textContent = codeText.length > 220 ? codeText.slice(0, 220) + "…" : codeText;
    var r = document.createElement("span"); r.className = "res dim"; r.textContent = "running…";
    row.appendChild(c); row.appendChild(r); results.appendChild(row); pendingRow = r; auto(results);
  }
  function result(o) {
    var r = pendingRow; pendingRow = null; if (!r) return;
    if (o.error) { r.className = "res err"; r.textContent = o.error; }
    else if (o.timedOut) { r.className = "res warn"; r.textContent = "no result within timeout (chunk likely still ran)"; }
    else if (o.ok === false) { r.className = "res err"; r.textContent = "runtime error: " + o.value; }
    else { r.className = "res ok"; r.textContent = (o.value === "" || o.value == null) ? "(no return value)" : o.value; }
    auto(results);
  }
  IDE.bus.on("log", function (d) {
    var el = document.createElement("div"); el.className = "logline" + (d.kind === "ws" ? " ws" : "");
    el.textContent = d.line; log.appendChild(el);
    while (log.childElementCount > 600) log.removeChild(log.firstChild);
    auto(log);
  });

  IDE.console = { pending: pending, result: result, clear: function (which) { (which === "log" ? log : results).innerHTML = ""; } };
})();
