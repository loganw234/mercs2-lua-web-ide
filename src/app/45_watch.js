/* 45_watch.js -- the Watch tab: pin expressions (Ess.Player.pose(0), Ess.Loop.isRunning("demo")) that
   re-poll every couple of seconds while connected, values updating live in a small table. The poor-man's
   debugger -- piggybacks on IDE.bridge.run, the same path the REPL uses, each row wrapping its expression
   the same way (`return (expr)`) so a bare expression just works. Each row is its own independent poll
   loop with a kill switch (the "×" button); polling silently no-ops while disconnected rather than
   erroring, and picks back up on its own once reconnected. Pinned expressions (not their last values)
   persist across reloads.

   Object-mode rows (kind:"object", added by clicking 🔍 on a Results row -- 40_console.js) are the same
   poll loop over a different, compound query: one round-trip pcall-reads name/pos/health/faction/alive +
   Ess.Probe.describeSafe for whatever guid the expression evaluates to, rendered as a small collapsible
   field list instead of one text value. */
(function () {
  var IDE = window.IDE, $ = IDE.$, KEY = "m2ide.watch.v1", INTERVAL = 2000;
  var list = $("watchList");
  var rows = [];

  function uid() { return "w" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }
  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(rows.map(function (r) { return { expr: r.expr, kind: r.kind }; })));
    } catch (e) {}
  }
  function setStatus(row, text, cls) {
    row.valEl.className = "watchval " + cls;
    row.valEl.textContent = text;
  }

  /* ---- object-mode: one compound query, tab-separated so a single round-trip carries every field ---- */
  var OBJECT_FIELDS = ["guid", "name", "pos", "health", "maxHealth", "faction", "alive", "describe"];
  function objectQuery(expr) {
    return "local uGuid = (" + expr + "\n)\n" +
      "if uGuid == nil then return \"\" end\n" +
      "local function safe1(fn, ...) local ok, a = pcall(fn, ...); if ok then return a end return nil end\n" +
      "local name = safe1(Ess.Object.displayName, uGuid)\n" +
      "local hp = safe1(Ess.Object.health, uGuid)\n" +
      "local maxhp = safe1(Ess.Object.maxHealth, uGuid)\n" +
      "local fac = safe1(Ess.Probe.getFaction, uGuid)\n" +
      "local alive = safe1(Ess.Object.alive, uGuid)\n" +
      "local okpos, x, y, z = pcall(Ess.Object.pos, uGuid)\n" +
      "local posStr = (okpos and x) and string.format(\"%.1f, %.1f, %.1f\", x, y, z) or \"?\"\n" +
      "local descOk, desc = pcall(Ess.Probe.describeSafe, uGuid)\n" +
      "return table.concat({ tostring(uGuid), name and tostring(name) or \"?\", posStr,\n" +
      "  hp and tostring(hp) or \"?\", maxhp and tostring(maxhp) or \"?\", fac and tostring(fac) or \"?\",\n" +
      "  (alive == true) and \"yes\" or (alive == false and \"no\" or \"?\"), descOk and tostring(desc) or \"?\" }, \"\\t\")";
  }
  function renderObjectVal(row, parts) {
    row.valEl.innerHTML = "";
    row.valEl.className = "watchval ok";
    var summary = document.createElement("span"); summary.className = "watchobjsum";
    summary.textContent = (parts[1] !== "?" ? parts[1] : parts[0]);
    row.valEl.appendChild(summary);
    var grid = row.fieldsEl;
    grid.innerHTML = "";
    OBJECT_FIELDS.forEach(function (label, i) {
      var d = document.createElement("div"); d.className = "watchfield";
      d.innerHTML = "<span class=\"wfk\">" + label + "</span><span class=\"wfv\">" + esc(parts[i] || "?") + "</span>";
      grid.appendChild(d);
    });
  }
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  function poll(row) {
    if (!IDE.bridge.connected()) { setStatus(row, "· not connected", "dim"); return; }
    var query = row.kind === "object" ? objectQuery(row.expr) : "return (" + row.expr + "\n)";
    IDE.bridge.run(query).then(function (r) {
      if (rows.indexOf(row) < 0) return;   // removed while the request was in flight
      if (r.error) { setStatus(row, r.error, "err"); return; }
      if (r.timedOut) { setStatus(row, "timed out", "err"); return; }
      if (r.ok === false) { setStatus(row, "error: " + r.value, "err"); return; }
      if (row.kind === "object") {
        if (r.value === "" || r.value == null) { setStatus(row, "nil (not a live object)", "dim"); if (row.fieldsEl) row.fieldsEl.innerHTML = ""; return; }
        renderObjectVal(row, String(r.value).split("\t"));
      } else {
        setStatus(row, (r.value === "" || r.value == null) ? "nil" : r.value, "ok");
      }
    });
  }
  function removeRow(row) {
    clearInterval(row.timer);
    row.el.remove();
    rows = rows.filter(function (r) { return r !== row; });
    persist();
  }
  function addRow(expr, kind) {
    var row = { id: uid(), expr: expr, kind: kind || "expr" };
    var el = document.createElement("div"); el.className = "watchrow" + (row.kind === "object" ? " watchobj" : "");
    var ex = document.createElement("span"); ex.className = "watchexpr"; ex.textContent = expr; ex.title = expr;
    var val = document.createElement("span"); val.className = "watchval dim"; val.textContent = "…";
    var rm = document.createElement("button"); rm.className = "watchrm"; rm.title = "Stop watching"; rm.textContent = "×";
    rm.onclick = function () { removeRow(row); };
    el.appendChild(ex); el.appendChild(val); el.appendChild(rm);
    row.valEl = val; row.el = el;
    if (row.kind === "object") {
      var open = true;
      val.style.cursor = "pointer";
      var fields = document.createElement("div"); fields.className = "watchfields";
      row.fieldsEl = fields;
      val.onclick = function () { open = !open; fields.classList.toggle("hidden", !open); };
      list.appendChild(el);
      list.appendChild(fields);
    } else {
      list.appendChild(el);
    }
    rows.push(row);
    poll(row);
    row.timer = setInterval(function () { poll(row); }, INTERVAL);
    return row;
  }

  $("watchAdd").onclick = function () {
    var expr = $("watchExpr").value.trim();
    if (!expr) return;
    addRow(expr, "expr");
    persist();
    $("watchExpr").value = "";
    $("watchExpr").focus();
  };
  $("watchExpr").addEventListener("keydown", function (e) { if (e.key === "Enter") $("watchAdd").click(); });

  var saved = [];
  try { saved = JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) {}
  saved.forEach(function (s) { if (s && s.expr) addRow(s.expr, s.kind); });

  /* a reconnect should re-poll everything right away rather than waiting out the interval */
  IDE.bus.on("status", function (s) { if (s === "open") rows.forEach(poll); });

  IDE.watch = {
    add: function (expr) { addRow(expr, "expr"); persist(); },
    /* the object inspector entry point -- 40_console.js's 🔍 button on a Results row calls this with the
       row's raw result text as the expression to re-evaluate. */
    addObject: function (expr) {
      addRow(expr, "object"); persist();
      document.querySelector('.tab[data-t="watch"]').click();
    }
  };
})();
