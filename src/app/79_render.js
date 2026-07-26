/* 79_render.js -- turning model output into DOM-safe HTML.
 *
 * Split out of 82_assist.js, which had grown to ~1500 lines doing context
 * capture, rendering, DOM, settings and the budget bar at once -- the file most
 * likely to need changes and the hardest to change safely. Everything here is
 * PURE (string in, string out, no DOM, no IDE state), which is the whole reason
 * it was worth separating: it can be tested directly, and it is the one part of
 * the assistant that handles untrusted text.
 *
 * Loads before 80_provider.js so IDE.render exists by the time the panel wires
 * itself up.
 *
 * Exposes IDE.render:
 *   esc(s)          HTML-escape, including quotes
 *   inline(md)      code spans, bold, autolinks -- operates on ESCAPED text
 *   prose(text)     paragraphs, headings, lists, tables
 *   hlLua(src)      the Lua highlighter used by code blocks and the diff gates
 *   splitThink(raw) separate inline reasoning from the answer
 *   md(text)        the whole pipeline: fenced code blocks + prose
 */
(function () {
  var IDE = window.IDE;

  /* Quotes are escaped too. They matter because inline() interpolates matched
     text into an href="..." attribute: a URL containing a double quote closed
     the attribute early and everything after it was parsed as further
     attributes -- including event handlers. Model output is not trusted input
     (a wiki page it read, or a custom pack URL, can steer what it emits), and
     this page holds the user's provider key in localStorage, so the cost of
     getting this wrong is not purely theoretical even without a server. */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  /* Runs on ALREADY-ESCAPED text -- callers escape first, so the only markup
     introduced here is what this function itself adds. */
  function inline(md) {
    return String(md)
      .replace(/`([^`\n]+)`/g, function (_, c) { return "<code>" + c + "</code>"; })
      .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
      /* http/https only -- never javascript:. &quot; is what an escaped quote
         looks like by this point, so excluding & from the URL body stops a
         crafted link from reopening the attribute. */
      .replace(/(^|[\s(])((?:https?:\/\/)[^\s<>&)]+[^\s<>&).,])/g,
        '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
  }

  /* A table only starts once its |---| separator has arrived. Without this
     look-ahead the first row of a streaming table is claimed by no branch and
     the paragraph loop spins forever. */
  function isTable(lines, i) {
    return /^\s*\|.*\|\s*$/.test(lines[i]) && i + 1 < lines.length &&
      /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1]);
  }

  function prose(text) {
    var lines = esc(text).split("\n"), html = "", i = 0;
    while (i < lines.length) {
      if (!lines[i].trim()) { i++; continue; }
      if (isTable(lines, i)) {
        var rows = [];
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(lines[i++]);
        html += '<div class="ai-tw"><table>';
        rows.forEach(function (r, n) {
          var cells = r.replace(/^\||\|$/g, "").split("|").map(function (c) { return c.trim(); });
          if (n === 1 && cells.every(function (c) { return /^:?-{2,}:?$/.test(c); })) return;
          var tag = n === 0 ? "th" : "td";
          html += "<tr>" + cells.map(function (c) {
            return "<" + tag + ">" + inline(c) + "</" + tag + ">";
          }).join("") + "</tr>";
        });
        html += "</table></div>";
        continue;
      }
      var h = lines[i].match(/^(#{1,6})\s+(.*)$/);
      if (h) { html += '<div class="ai-h">' + inline(h[2]) + "</div>"; i++; continue; }
      if (/^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        var ordered = /^\s*\d+\./.test(lines[i]), items = [];
        while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, "")); i++;
        }
        var t = ordered ? "ol" : "ul";
        html += "<" + t + ">" + items.map(function (x) { return "<li>" + inline(x) + "</li>"; }).join("") + "</" + t + ">";
        continue;
      }
      var para = [];
      while (i < lines.length && lines[i].trim() &&
             !/^(#{1,6})\s|^\s*([-*]|\d+\.)\s/.test(lines[i]) && !isTable(lines, i)) {
        para.push(lines[i]); i++;
      }
      if (!para.length) { para.push(lines[i]); i++; }
      html += "<p>" + inline(para.join("<br>")) + "</p>";
    }
    return html;
  }

  /* Tiny Lua highlighter for code blocks, on the same design tokens the editor
     uses. Tokenises the RAW code (so string/comment contents never match the
     keyword branch) and escapes per token. */
  var LUA_KW = /^(and|break|do|else|elseif|end|false|for|function|goto|if|in|local|nil|not|or|repeat|return|then|true|until|while)$/;
  var LUA_GLOBAL = /^(Ess|Pg|Sys|Player|Ai|Vz|Easy|Game|World|Cam|Ui|Debug|Net)$/;
  function hlLua(src) {
    var re = /--\[(=*)\[[\s\S]*?\]\1\]|--[^\n]*|\[(=*)\[[\s\S]*?\]\2\]|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|\b0[xX][0-9a-fA-F]+\b|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b|\b[A-Za-z_]\w*\b/g;
    var out = "", last = 0, m;
    src = String(src == null ? "" : src);
    while ((m = re.exec(src))) {
      out += esc(src.slice(last, m.index));
      var t = m[0], cls = "";
      if (t.lastIndexOf("--", 0) === 0) cls = "hl-c";
      else if (t[0] === '"' || t[0] === "'" || t[0] === "[") cls = "hl-s";
      else if (/^\d|^0[xX]/.test(t)) cls = "hl-n";
      else if (LUA_KW.test(t)) cls = "hl-k";
      else if (LUA_GLOBAL.test(t)) cls = "hl-g";
      out += cls ? '<span class="' + cls + '">' + esc(t) + "</span>" : esc(t);
      last = m.index + t.length;
    }
    return out + esc(src.slice(last));
  }

  /* Pull a model's inline reasoning out of the answer text. Reasoning that
     arrives as a separate `reasoning`/`reasoning_content` field is handled in
     the provider; this is for models (the Qwen family especially) that put it
     inline. Two inline shapes occur, and only handling the first was why a Qwen
     on LM Studio showed no thought panel:

       1. <think> ... </think> rest      -- explicit open + close.
       2. ... reasoning ... </think> rest -- CLOSE ONLY. Qwen chat templates
          inject the opening <think> into the prompt, so the model streams the
          reasoning text and just the closing tag; there is no opening tag in
          the output at all. */
  function splitThink(raw) {
    raw = String(raw == null ? "" : raw);
    var open = raw.indexOf("<think>");
    var close = raw.indexOf("</think>");
    if (open !== -1 && /^\s*$/.test(raw.slice(0, open))) {
      var s = open + 7;
      if (close === -1) return { think: raw.slice(s), rest: "" };
      return { think: raw.slice(s, close), rest: raw.slice(close + 8).replace(/^\s+/, "") };
    }
    if (close !== -1 && (open === -1 || open > close)) {
      return { think: raw.slice(0, close), rest: raw.slice(close + 8).replace(/^\s+/, "") };
    }
    return { think: "", rest: raw };
  }

  /* The whole pipeline: split on fences, highlight Lua, prose the rest. Lua
     blocks get Insert/Replace actions wired up by the panel. */
  function md(text) {
    var out = "", parts = String(text == null ? "" : text).split("```");
    for (var i = 0; i < parts.length; i++) {
      if (i % 2 === 1) {
        var m = parts[i].match(/^([a-zA-Z0-9_-]*)\n([\s\S]*)$/);
        var lang = m ? (m[1] || "code") : "code";
        var code = (m ? m[2] : parts[i]).replace(/\n$/, "");
        var isLua = /^lua$/i.test(lang);
        out += '<div class="ai-code"><div class="ai-codehead"><span>' + esc(lang) +
          '</span><span class="ai-codeacts">' +
          '<button type="button" class="ai-act ai-copy" title="Copy code">Copy</button>' +
          (isLua ? '<button type="button" class="ai-act ai-insert" title="Insert at the cursor">Insert</button>' +
            '<button type="button" class="ai-act ai-replace" title="Replace the whole script">Replace</button>' : "") +
          '</span></div><pre><code>' + (isLua ? hlLua(code) : esc(code)) + "</code></pre></div>";
      } else {
        out += prose(parts[i]);
      }
    }
    return out;
  }

  IDE.render = { esc: esc, inline: inline, prose: prose, hlLua: hlLua,
                 splitThink: splitThink, md: md };
})();
