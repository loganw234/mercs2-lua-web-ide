/* 46_inspector.js -- the Inspect sidebar tab: click 🔍 on a Results row (40_console.js), hit "Grab target"
   in this panel, or type a guid -- it takes over the sidebar with a live view of that object:
   name/position/health/faction/alive + Ess.Probe.describeSafe, one compound round-trip per poll, re-polling
   every couple seconds while connected (same pattern as the Watch tab). Single-slot: inspecting a new value
   replaces whatever was there before, since this is "look at the thing I just got", not a pinned list. Not
   persisted across reload -- a stale guid from a past session is never a live object anyway.

   Live-confirmed (Sys.GuidToString/Sys.StringToGuid round trip against a real target, matching health
   values before/after): a guid is Lua userdata, tostring()-ing it directly gives an opaque, non-reusable
   "userdata: 0012B69E". Ess.Name(uGuid) (pcall-wrapped Sys.GuidToString) gives the real portable form,
   "0x0012B69E" -- and Sys.StringToGuid("0x0012B69E") reconstructs the identical handle. So "grab target"
   and the custom-guid box both deal in that hex string, wrapped as Sys.StringToGuid(...) at the point it's
   fed back into a query -- see guidExpr(). A bare Lua literal can never round-trip a userdata value; there
   is no syntax for one. */
(function () {
  var IDE = window.IDE, $ = IDE.$, INTERVAL = 2000;
  var head = $("inspectHead"), exprEl = $("inspectExpr"), empty = $("inspectEmpty"), fields = $("inspectFields");
  var input = $("inspectInput");
  var expr = null, timer = null;
  var HEX_RE = /^0x[0-9A-Fa-f]+$/;

  var FIELDS = [
    { key: "guid", label: "Guid" },
    { key: "name", label: "Name" },
    { key: "pos", label: "Position" },
    { key: "health", label: "Health" },
    { key: "maxHealth", label: "Max HP" },
    { key: "faction", label: "Faction" },
    { key: "alive", label: "Alive" },
    { key: "describe", label: "Description" }
  ];
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  /* a Lua expression -- built from grab/typed hex, or passed straight through from 🔍 -- that evaluates to
     the live guid this query polls. */
  function guidExpr(hex) { return "Sys.StringToGuid(" + IDE.lua.quote(hex) + ")"; }
  function query(e) {
    return "local uGuid = (" + e + "\n)\n" +
      "if uGuid == nil then return nil end\n" +
      "local function safe1(fn, ...) local ok, a = pcall(fn, ...); if ok then return a end return nil end\n" +
      "local name = safe1(Ess.Object.displayName, uGuid)\n" +
      "local hp = safe1(Ess.Object.health, uGuid)\n" +
      "local maxhp = safe1(Ess.Object.maxHealth, uGuid)\n" +
      "local fac = safe1(Ess.Probe.getFaction, uGuid)\n" +
      "local alive = safe1(Ess.Object.alive, uGuid)\n" +
      "local okpos, x, y, z = pcall(Ess.Object.pos, uGuid)\n" +
      "local posStr = (okpos and x) and string.format(\"%.1f, %.1f, %.1f\", x, y, z) or nil\n" +
      "local descOk, desc = pcall(Ess.Probe.describeSafe, uGuid)\n" +
      "return { guid = Ess.Name(uGuid), name = name, pos = posStr, health = hp, maxHealth = maxhp,\n" +
      "  faction = fac, alive = alive, describe = (descOk and desc) or nil }";
  }
  function renderFields(obj) {
    fields.innerHTML = "";
    FIELDS.forEach(function (f) {
      var raw = obj[f.key];
      var text = raw === undefined ? "?" : (f.key === "alive" ? (raw === "true" ? "yes" : raw === "false" ? "no" : "?") : raw);
      var d = document.createElement("div"); d.className = "inspectfield";
      d.innerHTML = "<span class=\"ifk\">" + f.label + "</span><span class=\"ifv\">" + esc(text) + "</span>";
      fields.appendChild(d);
    });
  }
  function renderStatus(text, cls) {
    fields.innerHTML = "";
    var d = document.createElement("div"); d.className = "inspectstatus " + cls; d.textContent = text;
    fields.appendChild(d);
  }
  function poll() {
    if (!expr) return;
    if (!IDE.bridge.connected()) { renderStatus("· not connected", "dim"); return; }
    IDE.bridge.run(query(expr)).then(function (r) {
      if (!expr) return;   // stopped while the request was in flight
      if (r.error) { renderStatus(r.error, "err"); return; }
      if (r.timedOut) { renderStatus("timed out", "err"); return; }
      if (r.ok === false) { renderStatus("error: " + r.value, "err"); return; }
      if (r.value == null || r.value === "nil") { renderStatus("nil (not a live object)", "dim"); return; }
      renderFields(IDE.lua.parseTable(String(r.value)));
    });
  }
  function stop() {
    clearInterval(timer); timer = null; expr = null;
    head.classList.add("hidden");
    empty.classList.remove("hidden");
    fields.classList.add("hidden");
  }
  /* e: the Lua expression actually polled. shown: what the header displays -- for a grabbed/typed hex guid
     this is just the hex ("0x0012B69E"), not the Sys.StringToGuid(...) wrapper around it. */
  function inspect(e, shown) {
    clearInterval(timer);
    expr = e;
    var label = shown || e;
    exprEl.textContent = label; exprEl.title = label;
    head.classList.remove("hidden");
    empty.classList.add("hidden");
    fields.classList.remove("hidden");
    fields.innerHTML = "";
    poll();
    timer = setInterval(poll, INTERVAL);
    var tab = document.querySelector('.stab[data-p="inspect"]');
    if (tab) tab.click();
  }
  $("inspectClose").onclick = stop;
  IDE.bus.on("status", function (s) { if (s === "open" && expr) poll(); });

  /* ---- the player's two entry points: grab what you're aiming at, or type/paste a guid you already have.
     🔍 from a Results row (40_console.js) still works but is a minority case -- the compound query only
     ever makes sense against an actual guid, and most simple result values aren't one. */
  $("inspectGrab").onclick = function () {
    if (!IDE.bridge.connected()) { IDE.ui.flash($("inspectGrab"), "not connected"); return; }
    IDE.bridge.run(
      "local uGuid = Ess.Player.targetUnderReticle(0)\n" +
      "if not uGuid then return nil end\n" +
      "return Ess.Name(uGuid)"
    ).then(function (r) {
      if (!r.ok || r.value == null || r.value === "nil") { IDE.ui.flash($("inspectGrab"), "nothing aimed at"); return; }
      var hex = IDE.lua.unquote(r.value);
      if (!hex) { IDE.ui.flash($("inspectGrab"), "couldn't name that guid"); return; }
      inspect(guidExpr(hex), hex);
    });
  };
  function goInput() {
    var v = input.value.trim();
    if (!v) return;
    inspect(HEX_RE.test(v) ? guidExpr(v) : v, v);
    input.value = "";
  }
  $("inspectGo").onclick = goInput;
  input.addEventListener("keydown", function (e) { if (e.key === "Enter") goInput(); });

  IDE.inspector = { inspect: inspect };
})();
