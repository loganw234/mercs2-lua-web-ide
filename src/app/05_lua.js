/* 05_lua.js -- small shared Lua text helpers, used wherever a compound multi-field bridge result needs to
   survive the trip without a hand-rolled separator that the bridge's serializer would mangle. 10_bridge.js's
   wrap()/__ideser %q-quotes any *string* return value -- and Lua's %q escapes tab bytes into literal "\9"
   text (confirmed against a faithful port of Lua 5.1's addquoted), so a tab-joined single string can never
   be split back apart client-side. Returning a real Lua TABLE instead goes through the serializer's
   per-field path, where each field is quoted correctly on its own; parseTable reads that "{k=v, ...}" text
   back out by key (not position), so field order -- unspecified by Lua's pairs() -- doesn't matter. */
(function () {
  var IDE = window.IDE;

  function quote(s) {
    return '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n") + '"';
  }
  /* scans a %q-quoted Lua string starting at s[i] === '"' -- returns {value, next}, next being the index
     just past the closing quote. */
  function scanQuoted(s, i) {
    var n = s.length, j = i + 1, buf = "";
    while (j < n && s[j] !== '"') {
      if (s[j] === "\\") {
        var c = s[j + 1];
        if (c === '"' || c === "\\") { buf += c; j += 2; }
        else if (c === "\n") { buf += "\n"; j += 2; }
        else if (/[0-9]/.test(c)) {
          var m = s.slice(j + 1).match(/^[0-9]{1,3}/)[0];
          buf += String.fromCharCode(parseInt(m, 10));
          j += 1 + m.length;
        } else { buf += c; j += 2; }
      } else { buf += s[j]; j++; }
    }
    return { value: buf, next: j + 1 };
  }
  function unquote(s) {
    s = String(s);
    return s.charAt(0) === '"' ? scanQuoted(s, 0).value : s;
  }
  function parseTable(s) {
    var obj = {}, i = 0, n = s.length;
    function skipWs() { while (i < n && /\s/.test(s[i])) i++; }
    skipWs();
    if (s[i] === "{") i++;
    while (i < n) {
      skipWs();
      if (s[i] === "}" || i >= n) break;
      var keyStart = i;
      while (i < n && /[A-Za-z0-9_]/.test(s[i])) i++;
      var key = s.slice(keyStart, i);
      skipWs();
      if (s[i] === "=") i++;
      skipWs();
      var val;
      if (s[i] === '"') {
        var r = scanQuoted(s, i);
        val = r.value; i = r.next;
      } else if (s[i] === "{") {
        var depth = 0, start = i;
        do { if (s[i] === "{") depth++; else if (s[i] === "}") depth--; i++; } while (depth > 0 && i < n);
        val = s.slice(start, i);
      } else {
        var start2 = i;
        while (i < n && s[i] !== "," && s[i] !== "}") i++;
        val = s.slice(start2, i).trim();
      }
      obj[key] = val;
      skipWs();
      if (s[i] === ",") i++;
    }
    return obj;
  }

  IDE.lua = { quote: quote, unquote: unquote, parseTable: parseTable };
})();
