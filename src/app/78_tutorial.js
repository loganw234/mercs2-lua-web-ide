/* 78_tutorial.js -- the guided first-script tutorial: connect -> type your first line -> read your own
   position -> teleport to a known-safe street -> summon a taxi (and meet the TEARDOWN pattern) -> find a
   fare -> YOUR TURN: widen the search -> hold them -> mark pickup/drop-off -> YOUR TURN: place the
   drop-off -> deploy. One script, additively built in place; the learner's own edits (radius, drop-off)
   are preserved into every later step (the accumulated script is templated, not constant text).

   Why the early steps exist: a fresh player is standing INSIDE the PMC HQ -- summoning a vehicle there
   puts it in the lobby. So before anything spawns, the tutorial teaches pose (read where you are), then
   teleports to a live-verified street spot (captured in-game with Logan standing on it). And from the
   first spawn onward, every script starts by TEARING DOWN what the previous run left (Ess.State survives
   re-runs; the taxi is removed unless you're sitting in it; mark handles get cleared) -- hot-reload
   hygiene taught by example, and the teardown block visibly GROWS as the script gains props.

   Interaction contract (unchanged): every step advances off a REAL signal ("ran" carries the code AND the
   bridge result; "status"/"deployed" for the ends); per-step `need` markers keep unrelated runs from
   advancing or failing a step; code steps diff-select their new lines; each step explains its new calls;
   the needed button pulses; failures get step-specific coaching; ‹ › revisit; progress survives reload.
   All Lua in here was live-verified against a running game, including: the fare-finder's alive+nearest
   fix (the old first-match version could pick a corpse or someone 150 units off behind a wall; civilians
   also WANDER -- a "no one around, run it again" miss is normal and the copy says so), the teardown
   double-run (second run reports cleaning the first run's taxi), mark handle clearing, and the exact
   teleport call/coords. */
(function () {
  var IDE = window.IDE, $ = IDE.$;
  var panel = $("tutorial"), stepLbl = $("tutStep"), dotsEl = $("tutDots"), titleEl = $("tutTitle"),
      bodyEl = $("tutBody"), explainEl = $("tutExplain"), toastEl = $("tutToast"), hintEl = $("tutHint"),
      doneEl = $("tutDone"), backBtn = $("tutBack"), fwdBtn = $("tutFwd"), startBtn = $("tutStart");
  var TUT_NAME = "Tutorial: Taxi Fare", KEY = "m2ide.tutorial.v1";
  var SPOT = "2865, -24.6, -1192, 69";   // a street outside the PMC HQ -- captured live, in-game
  var active = false, idx = -1, reached = 0, toastTimer = null, glowEl = null;
  var state = { radius: 150, drop: 30 };

  /* ---- the ONE script, accumulated stage by stage. The teardown block at the top grows a line for
     every prop the script learns to create -- that's the lesson, made visible. ---- */
  function buildCode(stage) {
    var L = [
      '-- reload-safe scratch space: survives re-runs, so old props can be cleaned up',
      'local S = Ess.State("taxi_tutorial", {})',
      '',
      '-- tear down whatever the LAST run left behind: clean re-runs make hot-reloading painless',
      'if S.taxi and Ess.Object.valid(S.taxi) and Ess.Player.inVehicle(0) ~= S.taxi then',
      '  Ess.Object.remove(S.taxi)',
      'end',
      'S.taxi = nil'];
    if (stage >= 4) L = L.concat([
      'if S.markFare then Ess.Mark.clear(S.markFare) S.markFare = nil end',
      'if S.markZone then Ess.Mark.clear(S.markZone) S.markZone = nil end']);
    L = L.concat(['', 'S.taxi = Ess.Easy.Vehicle.summon("R90 Taxi")']);
    if (stage === 1) return L.concat(['return S.taxi and "your taxi\'s here" or "spawn failed -- try again"']).join("\n");
    L = L.concat(['if not S.taxi then return "spawn failed -- try again" end', '',
      'local px, py, pz = Ess.Player.pose(0)',
      'local nearby = Ess.Probe.nearby(px, py, pz, ' + state.radius + ', "humans")',
      'local uFare, dist = nil, nil',
      'for _, g in ipairs(nearby) do',
      '  if Ess.Probe.getFaction(g) == "Civ" and Ess.Object.alive(g) then',
      '    local d = Ess.Object.distance(g, px, py, pz)',
      '    if d and (not dist or d < dist) then uFare, dist = g, d end',
      '  end',
      'end']);
    if (stage === 2) return L.concat(['return uFare and string.format("found a fare %.0f units away", dist) or "no one around right now -- run it again, or drive somewhere busier"']).join("\n");
    L = L.concat(['if not uFare then return "no one around right now -- run it again, or drive somewhere busier" end', '',
      'Ess.AIOrders.command({ uFare }, "hold")']);
    if (stage === 3) return L.concat(['return "they\'re waiting for you now"']).join("\n");
    return L.concat(['S.markFare = Ess.Mark.object(uFare, { kind = "objective", disc = true, radius = 4 })', '',
      'local fx, fy, fz = Ess.Object.pos(uFare)',
      'S.markZone = Ess.Easy.Mark.zone(fx + ' + state.drop + ', fy, fz + ' + state.drop + ', 8)', '',
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

    { title: "Where are you?",
      body: "Everything in this world has coordinates — including you. Read yours. Hit Run.",
      watch: "ran", glow: "run", need: "pose",
      code: function () {
        return 'local x, y, z, yaw = Ess.Player.pose(0)\n' +
               'return string.format("you\'re at x=%.0f  y=%.0f  z=%.0f, facing %.0f", x, y, z, yaw)';
      },
      explain: [["Ess.Player.pose(0)", "returns FOUR values at once — position x, y, z and yaw (which way you're facing). Lua functions can do that."],
                ["string.format(...)", "builds a tidy string — %.0f means \"that number, no decimals\""]],
      test: function (p) { return okRan(p.result) && /you're at/.test(String(p.result.value)); },
      toast: function () { return "Those numbers are about to matter."; },
      fail: "Run it as-is first — you can play with the format string after it works." },

    { title: "Teleport somewhere safe",
      body: "You're probably standing <b>inside the PMC HQ</b> — summon a car in there and it lands in the lobby. Every mod script deals with \"where am I / where should this happen\". Jump to a known-good street first. Hit Run.",
      watch: "ran", glow: "run", need: "teleport",
      code: function () {
        return 'Ess.Player.teleport(' + SPOT + ')\n' +
               'return "off you go -- watch the screen"';
      },
      explain: [["Ess.Player.teleport(x, y, z, yaw)", "the same four numbers pose() gave you, fed back in — coordinates are just numbers you can reuse"],
                ["this exact spot", "a quiet street outside the HQ, verified in-game — open ground where a spawned car can actually land"]],
      test: function (p) { return okRan(p.result) && /off you go/.test(String(p.result.value)); },
      toast: function () { return "Solid ground, open sky. Now we can build."; },
      fail: "Keep the four numbers exactly as given this time — they're a verified safe spot. You can teleport anywhere you like after the tutorial." },

    { title: "Summon a taxi — and clean up after yourself",
      body: "Now something you can touch: spawn a taxi <b>and get seated in it</b>. Notice the top of the script: it <b>tears down the previous run's taxi first</b>. Run this twice and you'll see why — no parking lot of leftovers, ever. Hit Run.",
      watch: "ran", glow: "run", need: "summon",
      code: function () { return buildCode(1); },
      explain: [["Ess.State(\"taxi_tutorial\", {})", "a scratch table that SURVIVES re-runs — this is how a script can remember its last run's props"],
                ["the teardown if", "removes last run's taxi — unless you're sitting in it (check first, act second)"],
                ["Ess.Easy.Vehicle.summon(...)", "spawns a vehicle in front of you and puts you in the driver's seat"]],
      test: function (p) { return okRan(p.result) && /here/.test(String(p.result.value)); },
      toast: function () { return "You're behind the wheel. Run it again sometime — watch the old one vanish."; },
      fail: "Spawn failed usually means no room — make sure you did the teleport step (open street), then run again." },

    { title: "Find a fare",
      body: "A taxi needs a fare. This scans everyone within 150 units and keeps the <b>nearest living civilian</b> — corpses and distant strangers need not apply. Hit Run. Nobody around? Civilians wander — running it again usually works.",
      watch: "ran", glow: "run", need: "nearby",
      code: function () { return buildCode(2); },
      explain: [["Ess.Probe.nearby(...)", "returns a list of guids for everyone inside the radius"],
                ["getFaction(g) == \"Civ\" and Ess.Object.alive(g)", "civilians only, breathing only — the world is full of things you don't want in your cab"],
                ["the dist comparison", "classic nearest-tracking: keep the best candidate seen so far. You'll write this loop a hundred times."]],
      test: function (p) { return okRan(p.result) && /found a fare/.test(String(p.result.value)); },
      toast: function (p) { return stripQ(p.result.value) + "."; },
      fail: "\"No one around\" is normal — civilians wander. Run it again; still empty, drive somewhere busier and re-run." },

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
      body: "Mark your fare so you can find them, and drop a \"go here\" ring past them for the drop-off. The marks' <b>handles go into S</b> — scroll up: the teardown grew two lines to clear them next run. Hit Run, then look around in-game.",
      watch: "ran", glow: "run", need: "Mark.zone",
      code: function () { return buildCode(4); },
      explain: [["S.markFare = Ess.Mark.object(...)", "marker calls return a HANDLE — keep it, and the teardown can clear it next run. Props you can't tear down are props you've littered."],
                ["Ess.Object.pos(uFare)", "reads the fare's coordinates so the ring lands relative to them"],
                ["Ess.Easy.Mark.zone(x, y, z, r)", "a ground ring at a point — the universal \"go here\""]],
      test: function (p) { return okRan(p.result) && /marked/.test(String(p.result.value)); },
      toast: function () { return "Pickup marked, destination ringed — and the teardown knows about both."; },
      fail: "\"No one around\" ends the run early (that's your own guard working) — re-run until it finds a fare." },

    { title: "Your turn: place the drop-off",
      body: "The ring lands a short hop past the fare. Make the ride worth taking: change <b>both</b> numbers in the <code>Mark.zone</code> line from <code>30</code> to <code>80</code> (or anything 50+), and Run.",
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
      body: "This script is complete — teleport-safe, self-cleaning, hot-reloadable: the shape every good mod script has. Open <b>Actions ▾</b> in the Scripts sidebar and pick <b>⬇ Deploy as OnKey</b> to bind it to a key in the real game.",
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
