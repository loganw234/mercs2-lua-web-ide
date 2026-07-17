/* 20_editor.js -- a dependency-free code editor: a transparent <textarea> over a highlighted <pre>, plus a
   line-number gutter, Lua syntax highlighting, tab/indent handling, and an Ess.* autocomplete popup.
   Exposes IDE.editor { get, set, selection, focus, insertSnippet }. */
(function () {
  var IDE = window.IDE, ta = IDE.$("ta"), hl = IDE.$("hl"), gutter = IDE.$("gutter"), code = ta.parentElement, ac = IDE.$("ac");
  var gnums = document.createElement("div"); gnums.id = "gnums"; gutter.appendChild(gnums);

  /* ---- Lua highlighter (single pass -> spans) ---- */
  var KW = {}; "and break do else elseif end false for function goto if in local nil not or repeat return then true until while".split(" ").forEach(function (k) { KW[k] = 1; });
  var GLOB = {}; "Ess Loader Object Player Pg Camera Ai Vehicle Human Hud Sys Net Event Graphics Airstrike Gui Junk Weapon".split(" ").forEach(function (g) { GLOB[g] = 1; });
  function esc(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function highlight(src) {
    var out = "", i = 0, n = src.length, m;
    while (i < n) {
      var c = src[i];
      if (c === "-" && src[i + 1] === "-") {
        var lb = /^--\[(=*)\[/.exec(src.slice(i, i + 8));
        if (lb) { var cl = "]" + lb[1] + "]"; var e = src.indexOf(cl, i); e = e < 0 ? n : e + cl.length; out += '<span class="tok-c">' + esc(src.slice(i, e)) + "</span>"; i = e; continue; }
        var e2 = src.indexOf("\n", i); e2 = e2 < 0 ? n : e2; out += '<span class="tok-c">' + esc(src.slice(i, e2)) + "</span>"; i = e2; continue;
      }
      if (c === "[" && (src[i + 1] === "[" || src[i + 1] === "=")) {
        var ls = /^\[(=*)\[/.exec(src.slice(i, i + 8));
        if (ls) { var cl2 = "]" + ls[1] + "]"; var e3 = src.indexOf(cl2, i); e3 = e3 < 0 ? n : e3 + cl2.length; out += '<span class="tok-s">' + esc(src.slice(i, e3)) + "</span>"; i = e3; continue; }
      }
      if (c === '"' || c === "'") {
        var j = i + 1; while (j < n && src[j] !== c) { if (src[j] === "\\") j++; j++; } j = Math.min(j + 1, n);
        out += '<span class="tok-s">' + esc(src.slice(i, j)) + "</span>"; i = j; continue;
      }
      if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] || ""))) {
        m = /^(0[xX][0-9a-fA-F]+|[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?)/.exec(src.slice(i));
        if (m) { out += '<span class="tok-n">' + esc(m[0]) + "</span>"; i += m[0].length; continue; }
      }
      if (/[A-Za-z_]/.test(c)) {
        var id = /^[A-Za-z_]\w*/.exec(src.slice(i))[0];
        var cls = KW[id] ? "tok-k" : (GLOB[id] ? "tok-b" : null);
        out += cls ? '<span class="' + cls + '">' + id + "</span>" : id;
        i += id.length; continue;
      }
      out += esc(c); i++;
    }
    return out;
  }

  function render() {
    var v = ta.value;
    hl.innerHTML = highlight(v) + "\n";
    var lines = v.split("\n").length;
    if (gnums.childElementCount !== lines) {
      var s = ""; for (var k = 1; k <= lines; k++) s += "<div>" + k + "</div>"; gnums.innerHTML = s;
    }
    IDE.bus.emit("editorchange");
  }
  function sync() {
    hl.style.transform = "translate(" + (-ta.scrollLeft) + "px," + (-ta.scrollTop) + "px)";
    gnums.style.transform = "translateY(" + (-ta.scrollTop) + "px)";
  }

  /* ---- token under caret + snippet insertion ---- */
  function currentToken() {
    var upto = ta.value.slice(0, ta.selectionStart);
    var m = /[A-Za-z_][\w.]*$/.exec(upto);
    return m ? { text: m[0], start: ta.selectionStart - m[0].length } : { text: "", start: ta.selectionStart };
  }
  function replaceRange(start, end, text) {
    var v = ta.value; ta.value = v.slice(0, start) + text + v.slice(end);
    var caret = start + text.length; ta.selectionStart = ta.selectionEnd = caret;
    render(); sync();
  }
  function insertSnippet(text) { replaceRange(ta.selectionStart, ta.selectionEnd, text); ta.focus(); }

  /* ---- autocomplete ---- */
  var acItems = [], acSel = 0;
  function caretXY() {
    var mirror = document.createElement("div"), st = getComputedStyle(ta);
    ["fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "paddingTop", "paddingBottom", "paddingLeft", "paddingRight", "tabSize"].forEach(function (p) { mirror.style[p] = st[p]; });
    mirror.style.position = "absolute"; mirror.style.visibility = "hidden"; mirror.style.whiteSpace = "pre";
    mirror.textContent = ta.value.slice(0, ta.selectionStart);
    var mark = document.createElement("span"); mark.textContent = "​"; mirror.appendChild(mark);
    code.appendChild(mirror);
    var x = mark.offsetLeft - ta.scrollLeft, y = mark.offsetTop - ta.scrollTop + parseInt(st.lineHeight, 10);
    code.removeChild(mirror);
    return { x: x, y: y };
  }
  function hideAC() { ac.hidden = true; acItems = []; }
  function showAC() {
    if (!IDE.api) return hideAC();
    var tok = currentToken();
    if (tok.text.length < 2 || tok.text.indexOf(".") < 0 && tok.text.slice(0, 3).toLowerCase() !== "ess") return hideAC();
    var q = tok.text.toLowerCase();
    acItems = IDE.api.completions().filter(function (c) { return c.toLowerCase().indexOf(q) === 0; }).slice(0, 60);
    if (!acItems.length) return hideAC();
    acSel = 0; acTok = tok;
    ac.innerHTML = acItems.map(function (c, i) {
      var rest = c.slice(tok.text.length);
      return '<div class="item' + (i === 0 ? " sel" : "") + '" data-i="' + i + '">' + c.slice(0, tok.text.length) + '<span class="sig">' + rest + "</span></div>";
    }).join("");
    var xy = caretXY();
    ac.style.left = Math.min(xy.x, code.clientWidth - 220) + "px";
    ac.style.top = Math.min(xy.y + 2, code.clientHeight - 40) + "px";
    ac.hidden = false;
  }
  var acTok = null;
  function acAccept() {
    if (ac.hidden || !acItems.length) return false;
    replaceRange(acTok.start, ta.selectionStart, acItems[acSel]);
    hideAC(); return true;
  }
  function acMove(d) {
    acSel = (acSel + d + acItems.length) % acItems.length;
    Array.prototype.forEach.call(ac.children, function (el, i) { el.classList.toggle("sel", i === acSel); });
    var sel = ac.children[acSel]; if (sel) sel.scrollIntoView({ block: "nearest" });
  }
  ac.addEventListener("mousedown", function (e) {
    var it = e.target.closest(".item"); if (!it) return;
    e.preventDefault(); acSel = +it.dataset.i; acAccept();
  });

  /* ---- keys ---- */
  ta.addEventListener("keydown", function (e) {
    if (!ac.hidden) {
      if (e.key === "ArrowDown") { e.preventDefault(); return acMove(1); }
      if (e.key === "ArrowUp") { e.preventDefault(); return acMove(-1); }
      if (e.key === "Enter" || e.key === "Tab") { if (acAccept()) { e.preventDefault(); return; } }
      if (e.key === "Escape") { e.preventDefault(); return hideAC(); }
    }
    var mod = e.ctrlKey || e.metaKey;
    if (mod && e.key === "Enter") { e.preventDefault(); return IDE.bus.emit("run"); }
    if (mod && (e.key === "s" || e.key === "S")) { e.preventDefault(); return IDE.bus.emit("save"); }
    if (mod && e.key === " ") { e.preventDefault(); return showAC(); }
    if (e.key === "Tab") {
      e.preventDefault();
      var s = ta.selectionStart, en = ta.selectionEnd;
      if (s === en) { replaceRange(s, en, "  "); }
      else { // indent/dedent selected lines
        var v = ta.value, ls = v.lastIndexOf("\n", s - 1) + 1;
        var block = v.slice(ls, en), lines = block.split("\n");
        var nb = lines.map(function (l) { return e.shiftKey ? l.replace(/^ {1,2}/, "") : "  " + l; }).join("\n");
        ta.value = v.slice(0, ls) + nb + v.slice(en); ta.selectionStart = ls; ta.selectionEnd = ls + nb.length; render(); sync();
      }
    }
  });
  ta.addEventListener("input", function () { render(); sync(); try { showAC(); } catch (x) { hideAC(); } });
  ta.addEventListener("scroll", sync);
  ta.addEventListener("blur", function () { setTimeout(hideAC, 120); });
  window.addEventListener("resize", sync);

  IDE.editor = {
    get: function () { return ta.value; },
    set: function (v) { ta.value = v; render(); sync(); },
    selection: function () { return ta.value.slice(ta.selectionStart, ta.selectionEnd); },
    focus: function () { ta.focus(); },
    insertSnippet: insertSnippet
  };
  render(); sync();
})();
