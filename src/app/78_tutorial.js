/* 78_tutorial.js -- the guided first-script tutorial: connect -> type your first line -> summon a taxi ->
   find a fare -> WIDEN THE SEARCH YOURSELF -> make them wait -> mark pickup/drop-off -> PLACE THE DROP-OFF
   YOURSELF -> deploy. One script, additively built in place; the two "your turn" steps make the learner
   EDIT the code, and their edits are preserved into every later step (the accumulated script is templated
   on {radius, drop}, not constant text) -- nothing they change is ever silently reverted.

   Interaction contract:
   - every step advances off a REAL signal (30_run.js's "ran" event carrying the code AND the bridge
     result, bridge "status", 55_scripts' "deployed") -- never a bare Next click;
   - a "ran" event only counts for a step if the code that ran contains the step's `need` marker, so
     REPL/other runs mid-tutorial can't accidentally advance or fail a step;
   - each code step diff-selects the newly added lines in the editor (see what changed, not spot it);
   - the button a step needs pulses (.tutglow), each step explains its new calls line by line, failure
     gets a step-specific coaching line, ‹ › revisit earlier steps, progress survives a reload.
   All Lua was live-verified against a running game (incl. the "Civ" faction string) before landing here. */
(function () {
  var IDE = window.IDE, $ = IDE.$;
  var panel = $("tutorial"), stepLbl = $("tutStep"), dotsEl = $("tutDots"), titleEl = $("tutTitle"),
      bodyEl = $("tutBody"), explainEl = $("tutExplain"), toastEl = $("tutToast"), hintEl = $("tutHint"),
      doneEl = $("tutDone"), backBtn = $("tutBack"), fwdBtn = $("tutFwd"), startBtn = $("tutStart");
  var TUT_NAME = "Tutorial: Taxi Fare", KEY = "m2ide.tutorial.v1";
  var active = false, idx = -1, reached = 0, toastTimer = null, glowEl = null;
  var state = { radius: 150, drop: 30 };

  /* ---- the ONE script, accumulated stage by stage, templated on the learner's own edits ---- */
  function buildCode(stage) {
    var L = ['local uTaxi = Ess.Easy.Vehicle.summon("R90 Taxi")'];
    if (stage === 1) return L.concat(['return uTaxi and "your taxi\'s here" or "spawn failed -- try again"']).join("\n");
    L = L.concat(['',
      'local px, py, pz = Ess.Player.pose(0)',
      'local nearby = Ess.Probe.nearby(px, py, pz, ' + state.radius + ', "humans")',
      'local uFare = nil',
      'for _, g in ipairs(nearby) do',
      '  if Ess.Probe.getFaction(g) == "Civ" then uFare = g break end',
      'end']);
    if (stage === 2) return L.concat(['return uFare and ("found a fare: " .. Ess.Name(uFare)) or "no civilians nearby -- try driving somewhere busier"']).join("\n");
    L = L.concat(['if not uFare then return "no civilians nearby -- try driving somewhere busier" end', '',
      'Ess.AIOrders.command({ uFare }, "hold")']);
    if (stage === 3) return L.concat(['return "they\'re waiting for you now"']).join("\n");
    return L.concat(['Ess.Mark.object(uFare, { kind = "objective", disc = true, radius = 4 })', '',
      'local fx, fy, fz = Ess.Object.pos(uFare)',
      'Ess.Easy.Mark.zone(fx + ' + state.drop + ', fy, fz + ' + state.drop + ', 8)', '',
      'return "fare marked, destination ring dropped -- go pick them up!"']).join("\n");
  }

  function stripQ(s) { return String(s).replace(/^"|"$/g, ""); }
  function okRan(r) { return r && r.ok === true; }

  var STEPS = [
    { title: "Connect to your game",
      body: "This editor talks to your <b>actual running game</b> over a live socket. Hit <b>Connect</b> — the dot turns green once you're live.",
      watch: "status", glow: "connect" },

    { title: "Type your first line",
      body: "Prove the pipe works — <b>type</b> this in the editor (watch the autocomplete appear as you do), then press Ctrl/Cmd+Enter:<br><code>return Ess.VERSION</code>",
      watch: "ran", glow: "run", need: "Ess.VERSION",
      code: function () { return "-- Type your first line of Lua below:\n--   return Ess.VERSION\n\n"; },
      explain: [["return", "hands a value back to the Results panel — your window into the game"],
                ["Ess.VERSION", "the modding framework's version string. If it comes back, everything works."]],
      test: function (p) { return okRan(p.result) && p.result.value; },
      toast: function (p) { return "Ess " + stripQ(p.result.value) + " — you typed Lua and the game answered."; },
      fail: "Almost — the exact line is  return Ess.VERSION  (capital E, capital VERSION), on its own line." },

    { title: "Summon a taxi",
      body: "Now something you can touch. This spawns a taxi <b>and puts you in the driver's seat</b>. Hit Run.",
      watch: "ran", glow: "run", need: "summon",
      code: function () { return buildCode(1); },
      explain: [["Ess.Easy.Vehicle.summon(...)", "spawns a vehicle in front of you and seats you in it — one call"],
                ["local uTaxi = ...", "keeps the taxi's guid (the game's ID card for an object) in a variable"],
                ["a and b or c", "Lua's one-line if/else — the message depends on whether the spawn worked"]],
      test: function (p) { return okRan(p.result) && /here/.test(String(p.result.value)); },
      toast: function () { return "You're behind the wheel."; },
      fail: "Spawn failed usually means there's no room — step outside / away from walls and run it again." },

    { title: "Find a fare",
      body: "A taxi needs a fare. This asks the world for every human within " + "150 units and keeps the first <b>civilian</b>. Hit Run — no luck? Drive somewhere busier and run it again.",
      watch: "ran", glow: "run", need: "nearby",
      code: function () { return buildCode(2); },
      explain: [["Ess.Player.pose(0)", "your own position — the x, y, z the search is centred on"],
                ["Ess.Probe.nearby(...)", "returns a list of guids for everyone inside the radius"],
                ["getFaction(g) == \"Civ\"", "keeps civilians only — no gang members in this cab"],
                ["break", "stop looking after the first match"]],
      test: function (p) { return okRan(p.result) && /found a fare/.test(String(p.result.value)); },
      toast: function (p) { return stripQ(p.result.value) + "."; },
      fail: "No civilians in range is normal out in the wild — drive toward a town and re-run." },

    { title: "Your turn: widen the net",
      body: "150 units is a small circle. <b>Edit the code yourself</b>: find the <code>150</code> in the <code>nearby</code> line, change it to <code>300</code>, and Run. This is the whole job of modding — change a number, see what happens.",
      watch: "ran", glow: "run", need: "nearby",
      explain: [["the radius argument", "every number in a call like this is yours to play with — bigger circle, more candidates"]],
      test: function (p) {
        var m = /Ess\.Probe\.nearby\(\s*px\s*,\s*py\s*,\s*pz\s*,\s*(\d+)/.exec(p.code);
        if (!m || +m[1] < 200 || !okRan(p.result)) return false;
        state.radius = +m[1];
        return true;
      },
      toast: function () { return "Radius " + state.radius + " — your edit, your search. It sticks from here on."; },
      fail: "Only the number changes — the line should read  Ess.Probe.nearby(px, py, pz, 300, \"humans\")  (anything 200+ counts)." },

    { title: "Make them wait",
      body: "Found a fare — now tell them to stay put. One new line: an AI order. Orders always take a <b>list</b> of guids, even for one person. Hit Run.",
      watch: "ran", glow: "run", need: "AIOrders",
      code: function () { return buildCode(3); },
      explain: [["if not uFare then return ... end", "bail out early with a message instead of erroring on nil — a habit worth stealing"],
                ["Ess.AIOrders.command({ uFare }, \"hold\")", "the { } makes it a list — orders are built for squads, a single fare is a squad of one"]],
      test: function (p) { return okRan(p.result) && /waiting for you/.test(String(p.result.value)); },
      toast: function () { return "They're not going anywhere."; },
      fail: "Errored? Check the Results tab — the explainer under the red line usually names the exact problem." },

    { title: "Mark the pickup and drop-off",
      body: "Last mechanic: mark your fare so you can find them, and drop a \"go here\" ring past them for the drop-off. Hit Run, then look around in-game.",
      watch: "ran", glow: "run", need: "Mark.zone",
      code: function () { return buildCode(4); },
      explain: [["Ess.Mark.object(uFare, {...})", "pins an objective marker to a live object — it follows them"],
                ["Ess.Object.pos(uFare)", "reads the fare's coordinates so the ring is placed relative to them"],
                ["Ess.Easy.Mark.zone(x, y, z, r)", "a ground ring at a point — the universal \"go here\""]],
      test: function (p) { return okRan(p.result) && /marked/.test(String(p.result.value)); },
      toast: function () { return "Pickup marked, destination ringed."; },
      fail: "No civilians in range ends the run early (that's your own guard working) — get near people and re-run." },

    { title: "Your turn: place the drop-off",
      body: "The ring lands " + "a short hop past the fare. Make the ride worth taking: change <b>both</b> numbers in the <code>Mark.zone</code> line from <code>" + state.drop + "</code> to <code>80</code> (or anything 50+), and Run.",
      watch: "ran", glow: "run", need: "Mark.zone",
      explain: [["fx + 80, fy, fz + 80", "offsets from the fare's position — you're doing coordinate math now"]],
      test: function (p) {
        var m = /fx\s*\+\s*(\d+)\s*,\s*fy\s*,\s*fz\s*\+\s*(\d+)/.exec(p.code);
        if (!m || +m[1] < 50 || !okRan(p.result) || !/marked/.test(String(p.result.value))) return false;
        state.drop = +m[1];
        return true;
      },
      toast: function () { return "Drop-off at " + state.drop + " units — a proper ride."; },
      fail: "Change the numbers after  fx +  and  fz +  (both of them) to 50 or more, keep the rest of the line intact." },

    { title: "Make it a real mod",
      body: "This script is complete — spawn, find, hold, mark, in one hot-reloadable run. Open <b>Actions ▾</b> in the Scripts sidebar and pick <b>⬇ Deploy as OnKey</b>: it wraps this exact script for the game's own loader, bindable to a key.",
      watch: "deployed", glow: "scActions" }
  ];

  /* ---- rendering ---- */
  function setGlow(id) {
    if (glowEl) glowEl.classList.remove("tutglow");
    glowEl = id ? $(id) : null;
    if (glowEl) glowEl.classList.add("tutglow");
  }
  function renderDots() {
    dotsEl.innerHTML = "";
    STEPS.forEach(function (s, i) {
      var d = document.createElement("span");
      d.className = "tutdot" + (i < idx ? " done" : i === idx ? " on" : "");
      d.title = "Step " + (i + 1) + ": " + s.title;
      dotsEl.appendChild(d);
    });
  }
  function renderExplain(s) {
    explainEl.innerHTML = "";
    explainEl.classList.toggle("hidden", !s.explain);
    (s.explain || []).forEach(function (e) {
      var li = document.createElement("li");
      var c = document.createElement("code"); c.textContent = e[0];
      li.appendChild(c); li.appendChild(document.createTextNode(" — " + e[1]));
      explainEl.appendChild(li);
    });
  }
  function showToast(msg) {
    clearTimeout(toastTimer);
    toastEl.textContent = msg;
    toastEl.classList.remove("hidden");
    toastTimer = setTimeout(function () { toastEl.classList.add("hidden"); }, 4000);
  }

  /* the tutorial writes ONLY into its own library entry -- if the learner wandered to another script,
     switch back before touching the buffer (never clobber their other work) */
  function ensureTutorialScript() {
    var s = IDE.store.list().filter(function (x) { return x.name === TUT_NAME; })[0];
    if (!s) { IDE.store.create(TUT_NAME, ""); return; }
    if (IDE.store.active().id !== s.id) IDE.store.setActive(s.id);
  }

  /* replace the buffer, then SELECT the lines that changed -- "here's what's new" without a diff view */
  function setStepCode(newCode) {
    ensureTutorialScript();
    var old = IDE.editor.get();
    if (old === newCode) return;
    IDE.editor.set(newCode);
    if (!old.trim()) return;
    var a = old.split("\n"), b = newCode.split("\n");
    var pre = 0;
    while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
    var sa = a.length - 1, sb = b.length - 1;
    while (sa >= pre && sb >= pre && a[sa] === b[sb]) { sa--; sb--; }
    if (sb < pre) return;
    try {
      var doc = IDE.editor.cm.state.doc;
      var from = doc.line(Math.min(pre + 1, doc.lines)).from;
      var to = doc.line(Math.min(sb + 1, doc.lines)).to;
      IDE.editor.cm.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true });
    } catch (e) {}
  }

  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ idx: idx, reached: reached, radius: state.radius, drop: state.drop }));
    } catch (e) {}
  }
  function saved() {
    try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; }
  }
  function updateStartBtn() {
    var s = saved();
    startBtn.textContent = (s && s.idx > 0) ? "🎓 Resume tutorial" : "🎓 Tutorial";
  }

  function showStep() {
    var s = STEPS[idx];
    doneEl.classList.add("hidden");
    stepLbl.textContent = "Step " + (idx + 1) + " of " + STEPS.length;
    titleEl.textContent = s.title;
    bodyEl.innerHTML = s.body;
    hintEl.classList.add("hidden");
    renderDots();
    renderExplain(s);
    setGlow(s.glow);
    backBtn.disabled = idx === 0;
    fwdBtn.disabled = idx >= reached;
    if (s.code) setStepCode(s.code());
    persist();
    if (s.watch === "status" && IDE.bridge.connected()) advance();
  }
  function advance(toast) {
    if (toast) showToast(toast);
    idx++;
    reached = Math.max(reached, idx);
    if (idx >= STEPS.length) { finish(); return; }
    showStep();
  }
  function finish() {
    stepLbl.textContent = "All done";
    dotsEl.innerHTML = ""; titleEl.textContent = ""; bodyEl.innerHTML = "";
    explainEl.classList.add("hidden"); hintEl.classList.add("hidden"); toastEl.classList.add("hidden");
    setGlow(null);
    backBtn.disabled = fwdBtn.disabled = true;
    doneEl.classList.remove("hidden");
    active = false;
    try { localStorage.removeItem(KEY); } catch (e) {}
    updateStartBtn();
  }
  function stop() {
    active = false;
    panel.classList.add("hidden");
    setGlow(null);
    persist();
    updateStartBtn();
  }
  function start() {
    var s = saved();
    active = true;
    if (s && s.idx > 0 && s.idx < STEPS.length) {
      idx = s.idx; reached = s.reached || s.idx;
      state.radius = s.radius || 150; state.drop = s.drop || 30;
    } else {
      idx = 0; reached = 0;
      state.radius = 150; state.drop = 30;
    }
    ensureTutorialScript();
    document.querySelector('.stab[data-p="scripts"]').click();
    panel.classList.remove("hidden");
    showStep();
  }

  /* ---- the signals ---- */
  IDE.bus.on("status", function (s) {
    if (!active) return;
    var st = STEPS[idx];
    if (st && st.watch === "status" && s === "open") advance();
  });
  IDE.bus.on("ran", function (p) {
    if (!active) return;
    var s = STEPS[idx];
    if (!s || s.watch !== "ran") return;
    if (s.need && String(p.code).indexOf(s.need) < 0) return;   // some other run -- not this step's business
    if (s.test(p)) advance(s.toast ? s.toast(p) : null);
    else {
      hintEl.textContent = p.result.ok === false
        ? "That errored — check the Results tab (the » line explains it), fix it up, and run again."
        : (s.fail || "Not quite there yet — check the Results tab and try again.");
      hintEl.classList.remove("hidden");
    }
  });
  IDE.bus.on("deployed", function () {
    if (!active) return;
    var s = STEPS[idx];
    if (s && s.watch === "deployed") advance();
  });

  backBtn.onclick = function () { if (idx > 0) { idx--; showStep(); } };
  fwdBtn.onclick = function () { if (idx < reached) { idx++; showStep(); } };
  startBtn.onclick = start;
  $("tutClose").onclick = stop;
  $("tutDoneClose").onclick = stop;
  updateStartBtn();

  IDE.tutorial = { start: start, stop: stop, _state: function () { return { idx: idx, reached: reached, radius: state.radius, drop: state.drop, active: active }; } };
})();
