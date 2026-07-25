/* 80_provider.js -- provider-agnostic chat transport for the AI assistant.
 *
 * The IDE talks to whatever endpoint the user configures, in the browser, with
 * the user's own key. Nothing is proxied through a server we run: that keeps
 * cost at zero for us, keeps the key on the user's machine, and is the ONLY way
 * a local model can work at all (a hosted Worker cannot reach localhost).
 *
 * Nearly every provider speaks the OpenAI chat-completions shape, so one adapter
 * covers DeepSeek, OpenAI, OpenRouter, Groq, Together, Fireworks, vLLM, Ollama,
 * LM Studio, llama.cpp and LocalAI. Anthropic needs its own (different message
 * shape, different SSE events, and an explicit opt-in header for browser calls).
 *
 * Exposes IDE.provider:
 *   presets()                  -> [{id, label, baseUrl, model, needsKey, local, note}]
 *   get() / set(cfg)           -> persisted config
 *   configured()               -> bool
 *   chat(messages, opts)       -> Promise, streams via opts.onDelta / onReasoning
 */
(function () {
  var IDE = window.IDE;
  var KEY = "m2ide.ai.cfg";                  /* legacy single config -- migrated from */
  var PKEY = "m2ide.ai.profiles.v1";         /* { active, profiles: [{id, name, ...cfg}] } */

  /* Presets. `tested` marks what we have actually exercised; everything else is
     "should work, unverified" -- CORS is the usual failure and it is
     provider-specific, so we do not claim more than we know. */
  var PRESETS = [
    { id: "deepseek", label: "DeepSeek (recommended)", api: "openai",
      baseUrl: "https://api.deepseek.com/v1", model: "deepseek-v4-pro",
      needsKey: true, local: false, tested: true,
      note: "1M context -- the only option that fits the full reference pack." },

    { id: "openai", label: "OpenAI", api: "openai",
      baseUrl: "https://api.openai.com/v1", model: "gpt-5.6-terra",
      needsKey: true, local: false, tested: false },

    { id: "openrouter", label: "OpenRouter (free tier works)", api: "openai",
      baseUrl: "https://openrouter.ai/api/v1", model: "deepseek/deepseek-v4-pro:free",
      needsKey: true, local: false, tested: false,
      note: "The FREE tier works here: make a free account, create a key, and " +
            "pick a model whose name ends in ':free' (rate-limited, no card " +
            "needed). Drop the ':free' suffix to use the paid tier. Designed " +
            "for browser calls; also a good fallback if another host blocks CORS." },

    { id: "anthropic", label: "Anthropic", api: "anthropic",
      baseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-5",
      needsKey: true, local: false, tested: false,
      note: "Sends the direct-browser-access opt-in header." },

    /* api:"ollama" drives Ollama's NATIVE /api/chat, not its OpenAI-compatible
       shim. That is the only way to send num_ctx and keep_alive per request --
       the shim silently ignores both, which meant the IDE could not control the
       single setting that decides whether the reference pack fits (and
       OLLAMA_CONTEXT_LENGTH does not stick while the tray app is running).
       tools/bench_tools.py already used the native endpoint for exactly this
       reason; the app now agrees with the benchmark. */
    { id: "ollama", label: "Ollama (local)", api: "ollama",
      baseUrl: "http://localhost:11434", model: "qwen3:14b",
      needsKey: false, local: true, tested: true,
      note: "qwen3:14b is the tested pick -- 7/7 on tool use and zero invented " +
            "identifiers. The context window and keep-alive are set per request " +
            "now, so no OLLAMA_* environment variables are needed for those. " +
            "Raise OLLAMA_LOAD_TIMEOUT if a big model loads from disk slowly." },

    { id: "lmstudio", label: "LM Studio (local)", api: "openai",
      baseUrl: "http://localhost:1234/v1", model: "local-model",
      needsKey: false, local: true, tested: false,
      note: "Enable CORS in LM Studio's server settings." },

    { id: "llamacpp", label: "llama.cpp server (local)", api: "openai",
      baseUrl: "http://localhost:8080/v1", model: "local-model",
      needsKey: false, local: true, tested: false,
      note: "Start llama-server with --host and CORS allowed." },

    { id: "custom", label: "Custom (OpenAI-compatible)", api: "openai",
      baseUrl: "", model: "", needsKey: false, local: false, tested: false }
  ];

  var DEFAULT = {
    preset: "deepseek",
    api: "openai",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-v4-pro",
    key: "",
    packTier: "small",    /* which bundled tier -- see window.MERCS_PACK_INFO */
    packUrl: "",          /* optional URL override; blank = use packTier */
    modelCtx: 0,          /* user's model context window, tokens; 0 = unknown */
    maxTokens: 4000,
    sendEditor: true,
    sendLog: true,
    agentMode: false,
    /* Advanced, per-profile context tuning — sensible defaults, exposed in settings so a
       profile can be matched to its model (a 40k local model wants different knobs than a
       hosted 1M one). */
    editorMode: "diff",   /* "diff" = full script once then diffs; "full" = whole script every turn */
    trimHistory: true,    /* auto-trim old messages to the model's context window */
    logSend: 0,           /* game-log lines per message; 0 = derive from the window (see budget()) */
    keepRawResults: 0,    /* agent: tool results kept verbatim; 0 = derive from the window */
    maxSteps: 10,         /* agent: max tool-call steps per run */
    promptCache: true,    /* Anthropic: cache_control breakpoint on the reference pack */
    /* Ollama-native knobs (api:"ollama"). num_ctx 0 = load at the model's own default. */
    numCtx: 0,            /* per-request context window; the ONLY override of a Modelfile pin */
    keepAlive: "60m",     /* keep the model resident so the next question isn't a reload */
    /* Reasoning models: "" = don't send the parameter at all (correct for every
       non-reasoning model, and for providers that reject an unknown field). */
    reasoningEffort: "",  /* "" | minimal | low | medium | high */
    ctxDetected: 0        /* what autodetect last measured, so we can tell it from a typed value */
  };

  /* Context windows for hosted models we cannot ask. Only used as a last resort,
     and only as a PREFILL -- a wrong guess here is visible and editable in
     settings, whereas no value at all silently disables history trimming. */
  var MODEL_CTX = [
    [/^deepseek-(v4|chat|reasoner)/i, 1000000],
    [/^claude-(fable|opus|sonnet|haiku)-[45]/i, 200000],
    [/^claude-3/i, 200000],
    [/^gpt-5|^gpt-6|^o[1-9](-|$)/i, 400000],
    [/^gpt-4\.1/i, 1000000],
    [/^gpt-4o/i, 128000],
    [/^gemini-[12]\.\d-(pro|flash)/i, 1000000],
    [/^qwen3(\.\d)?:(30b|32b|35b)/i, 262144],
    [/^qwen.*1m/i, 1000000],
    [/^qwen3(\.\d)?:/i, 40960],
    [/^llama-?3\.[13]/i, 131072],
    [/^mistral|^mixtral/i, 32768]
  ];

  function guessCtx(model) {
    for (var i = 0; i < MODEL_CTX.length; i++) {
      if (MODEL_CTX[i][0].test(model || "")) return MODEL_CTX[i][1];
    }
    return 0;
  }

  /* Provider PROFILES. Users keep several named setups -- a free local model, a
     paid frontier one, a hosted DeepSeek -- and switch between them. Internally
     that is a list of profiles with one active; externally get()/set() operate
     on the ACTIVE profile, so every consumer (the panel, agent loop, budget bar)
     is unchanged. Same shape as the chats store: many named things, one current. */
  var store = null;   /* { active, profiles: [{id, name, <DEFAULT fields>}] } */

  function pid() { return "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  function mkProfile(name, src) {
    var p = { id: pid(), name: name || "Profile" };
    for (var k in DEFAULT) p[k] = (src && k in src) ? src[k] : DEFAULT[k];
    return p;
  }

  function activeProfile() {
    if (!store) return null;
    for (var i = 0; i < store.profiles.length; i++) {
      if (store.profiles[i].id === store.active) return store.profiles[i];
    }
    return store.profiles[0] || null;
  }

  function load() {
    if (store) return activeProfile();
    try { store = JSON.parse(localStorage.getItem(PKEY)); } catch (e) { store = null; }
    if (!store || !Array.isArray(store.profiles) || !store.profiles.length) {
      /* First run on profiles: fold the legacy single config into "Default",
         then delete the old key so there is one home for provider settings. */
      var old = null;
      try { old = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
      var first = mkProfile("Default", old || {});
      store = { active: first.id, profiles: [first] };
      save();
      try { localStorage.removeItem(KEY); } catch (e) {}
    }
    /* backfill any field added since a profile was written; repair bad ids */
    store.profiles.forEach(function (p) {
      for (var k in DEFAULT) if (!(k in p)) p[k] = DEFAULT[k];
      if (!p.id) p.id = pid();
      if (!p.name) p.name = "Profile";
    });
    /* One-time: logSend/keepRawResults gained an "auto" mode (0 = derive from
       the model's window -- see budget()). Profiles written before that carry
       the OLD DEFAULTS, which are indistinguishable from a deliberate choice
       and would pin those two knobs forever. Anything still sitting on the old
       default is moved to auto once; a value the user actually picked is left
       alone, and so is anything they set after this runs. */
    if (!store.autoBudget) {
      store.profiles.forEach(function (p) {
        if (p.logSend === 40) p.logSend = 0;
        if (p.keepRawResults === 2) p.keepRawResults = 0;
      });
      store.autoBudget = 1;
      save();
    }
    if (!activeProfile()) store.active = store.profiles[0].id;
    return activeProfile();
  }

  /* Persist and VERIFY it landed. A silent catch here was hiding real failures
     (private-mode / quota / a file:// origin the browser won't grant storage) --
     the settings looked saved and evaporated on reload. Now the failure is
     visible: save() returns false and stashes why, so the panel can say so. */
  var saveErr = null;
  function save() {
    try {
      localStorage.setItem(PKEY, JSON.stringify(store));
      if (localStorage.getItem(PKEY) == null) throw new Error("write did not stick");
      saveErr = null;
      return true;
    } catch (e) {
      saveErr = (e && (e.name || e.message)) || "unknown";
      try { console.warn("[ai] settings NOT persisted:", saveErr); } catch (_) {}
      return false;
    }
  }

  /* ---- transport --------------------------------------------------------
     Retry on 429 and 5xx with bounded backoff.
     Why this is not optional: the setup this project actively recommends to
     people with no budget is OpenRouter's free tier, which rate-limits hard --
     in our own cross-ecosystem run two models scored 0/11 and 7/11 purely from
     HTTP 429s, i.e. the harness measured the rate limiter, not the model. A
     user hitting that sees "HTTP 429" and concludes the IDE is broken.

     Only retried before the body is touched, so a half-streamed answer is never
     silently restarted. An abort is never retried. Retry-After is honoured when
     the provider sends one, because guessing shorter than they asked just burns
     the next attempt too. */
  var RETRY_STATUS = { 429: 1, 500: 1, 502: 1, 503: 1, 504: 1, 529: 1 };

  function retryDelay(res, attempt) {
    var ra = res && res.headers && res.headers.get && res.headers.get("retry-after");
    if (ra) {
      var secs = parseFloat(ra);
      if (!isNaN(secs) && secs >= 0) return Math.min(secs * 1000, 30000);
      var when = Date.parse(ra);
      if (!isNaN(when)) return Math.max(0, Math.min(when - Date.now(), 30000));
    }
    return Math.min(1000 * Math.pow(2, attempt), 8000);   /* 1s, 2s, 4s, 8s */
  }

  function fetchRetry(url, init, opts, onRetry) {
    var max = 2, attempt = 0;
    function go() {
      return fetch(url, init).then(function (res) {
        if (res.ok || !RETRY_STATUS[res.status] || attempt >= max) return res;
        if (opts && opts.signal && opts.signal.aborted) return res;
        var wait = retryDelay(res, attempt);
        attempt++;
        if (onRetry) onRetry(res.status, wait, attempt, max);
        /* Drain so the connection can be reused rather than left dangling. */
        try { res.body && res.body.cancel && res.body.cancel(); } catch (e) {}
        return new Promise(function (resolve, reject) {
          var t = setTimeout(function () { resolve(go()); }, wait);
          if (opts && opts.signal) {
            opts.signal.addEventListener("abort", function () {
              clearTimeout(t);
              var err = new Error("aborted"); err.name = "AbortError"; reject(err);
            }, { once: true });
          }
        });
      });
    }
    return go();
  }

  /* A provider can return HTTP 200 and then report the failure INSIDE the
     stream (OpenRouter does this for upstream rate limits). The frame carries
     no `choices`, so the old handler dropped it and the user got a silent empty
     answer with no explanation at all. Recognise it and fail loudly instead. */
  function frameError(o) {
    if (!o) return null;
    var e = o.error || (o.response && o.response.error);
    if (!e) return null;
    var msg = (typeof e === "string") ? e : (e.message || e.type || JSON.stringify(e));
    return new Error("The provider reported an error mid-stream: " + msg);
  }

  /* ---- SSE line reader shared by both adapters ---------------------------
     Providers differ in what they put in a frame, not in how frames arrive. */
  function readSSE(res, onFrame) {
    var reader = res.body.getReader();
    var dec = new TextDecoder();
    var buf = "";
    function pump() {
      return reader.read().then(function (c) {
        if (c.done) return;
        buf += dec.decode(c.value, { stream: true });
        var frames = buf.split("\n\n");
        buf = frames.pop();
        for (var i = 0; i < frames.length; i++) {
          var lines = frames[i].split("\n");
          for (var j = 0; j < lines.length; j++) {
            var line = lines[j].trim();
            if (line.lastIndexOf("data:", 0) !== 0) continue;
            var payload = line.slice(5).trim();
            if (payload === "[DONE]") continue;
            var obj = null;
            try { obj = JSON.parse(payload); } catch (e) { continue; }
            var err = frameError(obj);
            if (err) throw err;
            onFrame(obj);
          }
        }
        return pump();
      });
    }
    return pump();
  }

  /* Ollama's native /api/chat streams NDJSON -- one complete JSON object per
     line -- not SSE. Same job, different framing. */
  function readNDJSON(res, onFrame) {
    var reader = res.body.getReader();
    var dec = new TextDecoder();
    var buf = "";
    function pump() {
      return reader.read().then(function (c) {
        if (c.done) {
          var tail = buf.trim();
          if (tail) { try { onFrame(JSON.parse(tail)); } catch (e) {} }
          return;
        }
        buf += dec.decode(c.value, { stream: true });
        var lines = buf.split("\n");
        buf = lines.pop();
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();
          if (!line) continue;
          var obj = null;
          try { obj = JSON.parse(line); } catch (e) { continue; }
          var err = frameError(obj);
          if (err) throw err;
          onFrame(obj);
        }
        return pump();
      });
    }
    return pump();
  }

  function httpError(res) {
    return res.text().then(function (t) {
      var msg = "";
      try { var j = JSON.parse(t); msg = (j.error && (j.error.message || j.error)) || j.message || ""; }
      catch (e) { msg = t.slice(0, 300); }
      var hint = "";
      if (res.status === 401 || res.status === 403) hint = " -- check the API key.";
      else if (res.status === 404) hint = " -- check the base URL and model name.";
      else if (res.status === 429) hint = " -- rate limited by the provider.";
      throw new Error("HTTP " + res.status + (msg ? ": " + msg : "") + hint);
    });
  }

  /* ---- adapters --------------------------------------------------------- */

  /* Reasoning models take `max_completion_tokens`; `max_tokens` is rejected
     outright by some and, where accepted, is spent on reasoning tokens before
     the answer starts -- so a 4k cap can silently produce an empty reply.
     There is no reliable way to know from the model id alone (every provider
     names them differently and the list rots), so: guess from the id, and if
     the provider objects, flip the field and retry ONCE. Self-healing beats a
     table nobody remembers to update. */
  var REASONING_ID = /^(o[1-9]|gpt-5|gpt-6|deepseek-reasoner|.*-thinking)/i;

  function openAIBody(c, messages, tools, useCompletionTokens) {
    var body = { model: c.model, messages: messages, stream: true };
    body[useCompletionTokens ? "max_completion_tokens" : "max_tokens"] = c.maxTokens;
    if (c.reasoningEffort) body.reasoning_effort = c.reasoningEffort;
    if (tools && tools.length) { body.tools = tools; body.tool_choice = "auto"; }
    return body;
  }

  function postOpenAI(c, messages, tools, opts) {
    var headers = { "content-type": "application/json" };
    if (c.key) headers.authorization = "Bearer " + c.key;
    var url = c.baseUrl.replace(/\/+$/, "") + "/chat/completions";

    function attempt(useCompletionTokens) {
      return fetchRetry(url, {
        method: "POST", headers: headers, signal: opts.signal,
        body: JSON.stringify(openAIBody(c, messages, tools, useCompletionTokens))
      }, opts, opts.onRetry).then(function (res) {
        if (res.ok) return res;
        if (res.status !== 400 || useCompletionTokens) return httpError(res);
        /* Peek at the 400 before giving up: is it complaining about the very
           field we guessed at? */
        return res.text().then(function (t) {
          if (/max_completion_tokens|max_tokens/i.test(t)) return attempt(true);
          return httpError(new Response(t, { status: res.status }));
        });
      });
    }
    return attempt(REASONING_ID.test(c.model || ""));
  }

  function chatOpenAI(c, messages, opts) {
    return postOpenAI(c, messages, null, opts).then(function (res) {
      return readSSE(res, function (o) {
        var d = o.choices && o.choices[0] && o.choices[0].delta;
        if (!d) return;
        /* Chain-of-thought streams under different names per provider:
           DeepSeek says reasoning_content, Ollama/OpenRouter say reasoning.
           Missing this looks like "streaming is broken" on a thinking model --
           every token until the final answer is silently dropped. */
        var r = d.reasoning_content || d.reasoning;
        if (r && opts.onReasoning) opts.onReasoning(r);
        if (d.content && opts.onDelta) opts.onDelta(d.content);
      });
    });
  }

  /* ---- Ollama native (/api/chat) ----------------------------------------
   *
   * The OpenAI-compatible shim cannot set num_ctx or keep_alive: it ignores
   * both silently. num_ctx is the only thing that overrides a model's
   * Modelfile-pinned context, and context -- not parameter count -- is what
   * decides whether the reference pack survives (a model that cannot hold the
   * pack does not warn you; it truncates from the FRONT, where the
   * anti-invention rules live, and answers confidently anyway).
   *
   * Differences from the OpenAI shape, all handled here so the rest of the app
   * stays provider-blind:
   *   - NDJSON framing, not SSE
   *   - tool-call arguments are a JSON OBJECT, not a JSON string
   *   - reasoning arrives as message.thinking
   *   - one whole message per frame (already-assembled tool calls)
   */
  function ollamaRoot(c) {
    return c.baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
  }

  function toOllama(messages) {
    return messages.map(function (m) {
      if (m.role === "tool") {
        /* Ollama keys tool results by name, not by call id. */
        return { role: "tool", content: String(m.content || ""), tool_name: m.name || "" };
      }
      if (m.role === "assistant" && m.tool_calls && m.tool_calls.length) {
        return {
          role: "assistant", content: m.content || "",
          tool_calls: m.tool_calls.map(function (tc) {
            var args = {};
            try { args = JSON.parse((tc.function && tc.function.arguments) || "{}"); }
            catch (e) { args = {}; }
            return { function: { name: tc.function && tc.function.name, arguments: args } };
          })
        };
      }
      return { role: m.role, content: String(m.content || "") };
    });
  }

  function ollamaOptions(c) {
    var o = {};
    if (c.numCtx && c.numCtx > 0) o.num_ctx = c.numCtx;
    return o;
  }

  function postOllama(c, messages, tools, opts) {
    var body = {
      model: c.model,
      messages: toOllama(messages),
      stream: true,
      keep_alive: c.keepAlive || "60m",
      options: ollamaOptions(c)
    };
    if (tools && tools.length) body.tools = tools;
    return fetchRetry(ollamaRoot(c) + "/api/chat", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(body), signal: opts.signal
    }, opts, opts.onRetry).then(function (res) {
      if (!res.ok) return httpError(res);
      return res;
    });
  }

  function chatOllama(c, messages, opts) {
    return postOllama(c, messages, null, opts).then(function (res) {
      return readNDJSON(res, function (o) {
        var m = o.message;
        if (!m) return;
        if (m.thinking && opts.onReasoning) opts.onReasoning(m.thinking);
        if (m.content && opts.onDelta) opts.onDelta(m.content);
      });
    });
  }

  function completeOllama(c, messages, tools, opts) {
    var content = "", reasoning = "", calls = [];
    return postOllama(c, messages, tools, opts).then(function (res) {
      return readNDJSON(res, function (o) {
        var m = o.message;
        if (!m) return;
        if (m.thinking) { reasoning += m.thinking; if (opts.onReasoning) opts.onReasoning(m.thinking); }
        if (m.content) { content += m.content; if (opts.onDelta) opts.onDelta(m.content); }
        if (m.tool_calls) {
          m.tool_calls.forEach(function (tc, i) {
            var f = tc.function || {};
            /* Back to the OpenAI shape the agent loop executes against: it
               wants arguments as a STRING, and an id to pair the result with. */
            calls.push({
              id: f.name ? (f.name + "_" + (calls.length + i)) : ("call_" + calls.length),
              type: "function",
              function: {
                name: f.name || "",
                arguments: typeof f.arguments === "string"
                  ? f.arguments : JSON.stringify(f.arguments || {})
              }
            });
          });
        }
      }).then(function () {
        var raw = { role: "assistant", content: content };
        if (calls.length) raw.tool_calls = calls;
        return { content: content, toolCalls: calls, reasoning: reasoning, raw: raw };
      });
    });
  }

  function chatAnthropic(c, messages, opts) {
    /* Anthropic takes the system prompt as a top-level field, not a message. */
    var system = "";
    var rest = [];
    for (var i = 0; i < messages.length; i++) {
      if (messages[i].role === "system") system += (system ? "\n\n" : "") + messages[i].content;
      else rest.push({ role: messages[i].role, content: messages[i].content });
    }
    return fetch(c.baseUrl.replace(/\/+$/, "") + "/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": c.key,
        "anthropic-version": "2023-06-01",
        /* required for calls made straight from a browser */
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({
        model: c.model, system: anthropicSystem(c, system), messages: rest,
        max_tokens: c.maxTokens, stream: true
      }),
      signal: opts.signal
    }).then(function (res) {
      if (!res.ok) return httpError(res);
      return readSSE(res, function (o) {
        if (o.type === "content_block_delta" && o.delta) {
          if (o.delta.type === "text_delta" && o.delta.text && opts.onDelta) opts.onDelta(o.delta.text);
          if (o.delta.type === "thinking_delta" && o.delta.thinking && opts.onReasoning) {
            opts.onReasoning(o.delta.thinking);
          }
        }
      });
    });
  }

  /* Streamed completion, with optional tools.
   *
   * This IS streamed, so agent mode shows the model thinking and answering live
   * -- locally-hosted users specifically want to watch and abort a run that
   * goes off the rails. Tool calls are assembled from the SSE deltas: the
   * OpenAI shape sends, per call index, the id + name in the first frame and
   * the JSON arguments in fragments across later frames, so id/name are set
   * once and arguments are concatenated. content and reasoning forward live via
   * opts.onDelta / opts.onReasoning. Returns the same shape as before. */
  function completeOpenAI(c, messages, tools, opts) {
    var content = "", reasoning = "", calls = [];
    return postOpenAI(c, messages, tools, opts).then(function (res) {
      return readSSE(res, function (o) {
        var d = o.choices && o.choices[0] && o.choices[0].delta;
        if (!d) return;
        var r = d.reasoning_content || d.reasoning;
        if (r) { reasoning += r; if (opts.onReasoning) opts.onReasoning(r); }
        if (d.content) { content += d.content; if (opts.onDelta) opts.onDelta(d.content); }
        if (d.tool_calls) {
          for (var i = 0; i < d.tool_calls.length; i++) {
            var tc = d.tool_calls[i];
            var idx = tc.index != null ? tc.index : i;
            if (!calls[idx]) calls[idx] = { id: "", type: "function", function: { name: "", arguments: "" } };
            /* id and name arrive whole in the first frame (some backends resend
               them every frame) -- set once. Arguments are the streamed part. */
            if (tc.id && !calls[idx].id) calls[idx].id = tc.id;
            if (tc.function) {
              if (tc.function.name && !calls[idx].function.name) calls[idx].function.name = tc.function.name;
              if (tc.function.arguments) calls[idx].function.arguments += tc.function.arguments;
            }
          }
        }
      }).then(function () {
        var toolCalls = calls.filter(Boolean);
        var raw = { role: "assistant", content: content };
        if (toolCalls.length) raw.tool_calls = toolCalls;
        return { content: content, toolCalls: toolCalls, reasoning: reasoning, raw: raw };
      });
    });
  }

  /* The agent loop (86_agent.js) speaks the OpenAI shape throughout -- its
     conversation carries OpenAI-style assistant tool_calls and {role:"tool"}
     results. This converts that conversation on every request rather than
     making the loop provider-aware: system messages lift to the top-level
     field, tool results fold into user-role tool_result blocks (consecutive
     ones merged -- Anthropic wants them in ONE user turn), and assistant
     tool_calls become tool_use blocks. */
  /* Prompt caching. OpenAI/DeepSeek cache a stable prefix automatically (no markup) — we
     already keep [pack, …turns] ordering so that just works. Anthropic needs an explicit
     cache_control breakpoint: mark the whole system block (the reference pack, the big stable
     prefix — 11k–241k tokens) so a warm turn re-reads it from cache instead of re-billing it.
     Below Anthropic's ~1k-token minimum, caching does nothing, so leave the plain string. */
  function anthropicSystem(c, system) {
    if (c.promptCache !== false && system && system.length >= 4096) {
      return [{ type: "text", text: system, cache_control: { type: "ephemeral" } }];
    }
    return system;
  }

  function toAnthropic(messages) {
    var system = "", out = [];
    for (var i = 0; i < messages.length; i++) {
      var m = messages[i];
      if (m.role === "system") { system += (system ? "\n\n" : "") + m.content; continue; }
      if (m.role === "tool") {
        var block = { type: "tool_result", tool_use_id: m.tool_call_id || "",
                      content: String(m.content || "") };
        var prev = out[out.length - 1];
        if (prev && prev.role === "user" && Array.isArray(prev.content)) prev.content.push(block);
        else out.push({ role: "user", content: [block] });
        continue;
      }
      if (m.role === "assistant" && m.tool_calls && m.tool_calls.length) {
        var content = [];
        if (m.content) content.push({ type: "text", text: String(m.content) });
        for (var t = 0; t < m.tool_calls.length; t++) {
          var tc = m.tool_calls[t], input = {};
          try { input = JSON.parse((tc.function && tc.function.arguments) || "{}"); }
          catch (e) { input = {}; }
          content.push({ type: "tool_use", id: tc.id,
                         name: tc.function && tc.function.name, input: input });
        }
        out.push({ role: "assistant", content: content });
        continue;
      }
      out.push({ role: m.role, content: m.content });
    }
    return { system: system, messages: out };
  }

  /* Streams, like every other adapter. This used to be stream:false, which made
     agent mode on Anthropic go dark between steps -- no live tokens, nothing to
     watch, and no way to abort a run mid-generation -- while the docs claimed
     streaming was the design. Assembling tool_use here is the mirror of the
     OpenAI path: content_block_start carries the block's type/id/name, the
     deltas carry partial JSON for tool input, and content_block_stop closes it. */
  function completeAnthropic(c, messages, tools, opts) {
    var conv = toAnthropic(messages);
    var body = { model: c.model, system: anthropicSystem(c, conv.system), messages: conv.messages,
                 max_tokens: c.maxTokens, stream: true };
    if (tools && tools.length) {
      body.tools = tools.map(function (t) {
        return { name: t.function.name, description: t.function.description,
                 input_schema: t.function.parameters };
      });
    }
    var text = "", reasoning = "", blocks = [];
    return fetchRetry(c.baseUrl.replace(/\/+$/, "") + "/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": c.key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify(body), signal: opts.signal
    }, opts, opts.onRetry).then(function (res) {
      if (!res.ok) return httpError(res);
      return readSSE(res, function (o) {
        var i = o.index;
        if (o.type === "content_block_start" && o.content_block) {
          blocks[i] = { type: o.content_block.type, id: o.content_block.id,
                        name: o.content_block.name, json: "" };
          return;
        }
        if (o.type === "content_block_delta" && o.delta) {
          var d = o.delta;
          if (d.type === "text_delta" && d.text) {
            text += d.text; if (opts.onDelta) opts.onDelta(d.text);
          } else if (d.type === "thinking_delta" && d.thinking) {
            reasoning += d.thinking; if (opts.onReasoning) opts.onReasoning(d.thinking);
          } else if (d.type === "input_json_delta" && blocks[i]) {
            blocks[i].json += d.partial_json || "";
          }
        }
      });
    }).then(function () {
      var toolCalls = [];
      blocks.forEach(function (b) {
        if (!b || b.type !== "tool_use") return;
        /* back to the OpenAI shape the loop executes against */
        toolCalls.push({ id: b.id, type: "function",
          function: { name: b.name, arguments: b.json || "{}" } });
      });
      /* raw is what the loop pushes back into the conversation, so it must be
         OpenAI-shaped too -- toAnthropic re-converts it on the next round. */
      var raw = { role: "assistant", content: text };
      if (toolCalls.length) raw.tool_calls = toolCalls;
      return { content: text, toolCalls: toolCalls, reasoning: reasoning, raw: raw };
    });
  }

  IDE.provider = {
    presets: function () { return PRESETS.slice(); },
    /* Used by the agent loop. Both adapters return the same OpenAI-shaped
       {content, toolCalls, reasoning, raw} so the loop stays provider-blind. */
    complete: function (messages, tools, opts) {
      var c = load();
      opts = opts || {};
      var fn = c.api === "anthropic" ? completeAnthropic
             : c.api === "ollama" ? completeOllama : completeOpenAI;
      return fn(c, messages, tools, opts);
    },

    /* ---- context autodetection -------------------------------------------
       The model's context window is the single number everything else scales
       off: history trimming, the pack tier that fits, how much of a wiki page a
       tool may return. It used to default to 0 -- meaning "unknown", meaning no
       trimming at all -- and the only way to set it was for the user to know
       their model's internals and type them in. Meanwhile checkContext() was
       already READING the true value from Ollama and merely warning with it.

       So ask, in order of authority: the running server (it knows), then a
       table for hosted models we cannot ask. Returns {ctx, caps, source} with
       ctx 0 when genuinely undiscoverable. Never throws -- a detection failure
       must not break sending a message. */
    detectContext: function () {
      var c = load();
      var root = c.api === "ollama" ? ollamaRoot(c)
               : c.baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
      var isOllama = c.api === "ollama" || /:11434(\/|$)/.test(c.baseUrl);

      function fallback(why) {
        var g = guessCtx(c.model);
        return { ctx: g, caps: null, source: g ? "known model id" : (why || "unavailable") };
      }

      if (isOllama) {
        return fetch(root + "/api/show", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ model: c.model })
        }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
          if (!d || !d.model_info) return fallback("Ollama did not report model info");
          var ctx = 0;
          for (var k in d.model_info) {
            if (/\.context_length$/.test(k)) { ctx = d.model_info[k]; break; }
          }
          if (!ctx) return fallback("Ollama reported no context_length");
          return { ctx: ctx, caps: d.capabilities || [], source: "Ollama /api/show" };
        }).catch(function () { return fallback("could not reach Ollama"); });
      }

      /* OpenAI-compatible servers vary in what they expose; OpenRouter reports
         context_length, LM Studio max_context_length, some report nothing. */
      var headers = {};
      if (c.key) headers.authorization = "Bearer " + c.key;
      return fetch(c.baseUrl.replace(/\/+$/, "") + "/models", { headers: headers })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          var list = (d && (d.data || d.models)) || [];
          for (var i = 0; i < list.length; i++) {
            var m = list[i];
            if (String(m.id || m.name) !== c.model) continue;
            var ctx = m.context_length || m.max_context_length ||
                      m.context_window || m.loaded_context_length ||
                      (m.top_provider && m.top_provider.context_length) || 0;
            if (ctx) return { ctx: ctx, caps: null, source: "the provider's /models" };
            break;
          }
          return fallback("the provider's /models did not report a window");
        })
        .catch(function () { return fallback("could not reach the provider"); });
    },
    preset: function (id) {
      for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].id === id) return PRESETS[i];
      return null;
    },

    /* ---- derived limits ---------------------------------------------------
       Everything that used to be a fixed constant scattered across the app --
       how much of a wiki page a tool may return, how many log lines ride along,
       how many tool results stay verbatim -- is really "some fraction of the
       model's window". As constants they were wrong at both ends of the range
       this fork targets: truncating a wiki page to 14k chars throws away the
       grounding a 1M-context flagship was given the window to hold, while the
       same 14k is a third of a 40k local model's entire budget in ONE result.

       Fractions, clamped at both ends, with the old constants as the
       unknown-window fallback so behaviour is unchanged until a window is
       known. A profile that sets one of these explicitly (>0) always wins. */
    budget: function (kind) {
      var c = load();
      var w = (c.modelCtx && c.modelCtx > 0) ? c.modelCtx : 0;
      function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, Math.round(v))); }
      switch (kind) {
        case "pageChars":                       /* one wiki page / tool result */
          return w ? clamp(w * 0.10 * 4, 6000, 120000) : 14000;
        case "editorChars":                     /* the attached editor buffer */
          return w ? clamp(w * 0.25 * 4, 20000, 400000) : 60000;
        case "selChars":
          return w ? clamp(w * 0.08 * 4, 8000, 120000) : 20000;
        case "logLines":
          if (c.logSend && c.logSend > 0) return c.logSend;
          return w ? clamp(w / 1000, 20, 400) : 40;
        case "keepRaw":                         /* tool results kept verbatim */
          if (c.keepRawResults && c.keepRawResults > 0) return c.keepRawResults;
          return w ? clamp(w / 32000, 2, 12) : 2;
        case "stubChars":                       /* what an elided result shrinks to */
          return w ? clamp(w / 100, 220, 2000) : 220;
        default:
          return 0;
      }
    },
    get: function () { return load(); },
    set: function (patch) {
      var c = load();
      for (var k in patch) if (k in DEFAULT) c[k] = patch[k];
      var ok = save();
      IDE.bus.emit("ai:config", c);
      return ok;                      /* false = did not persist (see saveError) */
    },
    saveError: function () { return saveErr; },

    /* ---- profiles ---------------------------------------------------------
       Named provider setups, one active. get()/set() above act on the active
       one, so these are the only extra surface a caller needs. */
    profiles: function () {
      load();
      return store.profiles.map(function (p) { return { id: p.id, name: p.name }; });
    },
    activeProfileId: function () { load(); return store.active; },
    switchProfile: function (id) {
      load();
      for (var i = 0; i < store.profiles.length; i++) {
        if (store.profiles[i].id === id) {
          store.active = id; save();
          IDE.bus.emit("ai:config", store.profiles[i]);
          IDE.bus.emit("ai:profiles");
          return true;
        }
      }
      return false;
    },
    /* Create a profile and make it active. `copyActive` starts it from the
       current profile's values (tweak one field) rather than blank defaults. */
    newProfile: function (name, copyActive) {
      load();
      var p = mkProfile(name, copyActive ? activeProfile() : null);
      store.profiles.push(p);
      store.active = p.id;
      save();
      IDE.bus.emit("ai:config", p);
      IDE.bus.emit("ai:profiles");
      return p.id;
    },
    renameProfile: function (id, name) {
      load();
      if (!name || !name.trim()) return false;
      for (var i = 0; i < store.profiles.length; i++) {
        if (store.profiles[i].id === id) {
          store.profiles[i].name = name.trim(); save();
          IDE.bus.emit("ai:profiles");
          return true;
        }
      }
      return false;
    },
    deleteProfile: function (id) {
      load();
      if (store.profiles.length <= 1) return false;   /* always keep one */
      var idx = -1;
      for (var i = 0; i < store.profiles.length; i++) if (store.profiles[i].id === id) { idx = i; break; }
      if (idx < 0) return false;
      store.profiles.splice(idx, 1);
      if (store.active === id) store.active = store.profiles[0].id;
      save();
      IDE.bus.emit("ai:config", activeProfile());
      IDE.bus.emit("ai:profiles");
      return true;
    },
    configured: function () {
      var c = load();
      if (!c.baseUrl || !c.model) return false;
      var p = this.preset(c.preset);
      if (p && p.needsKey && !c.key) return false;
      return true;
    },
    /* messages: [{role, content}] -- system first. Streams through opts. */
    chat: function (messages, opts) {
      var c = load();
      opts = opts || {};
      if (!c.baseUrl || !c.model) {
        return Promise.reject(new Error("No provider configured -- open Assistant settings."));
      }
      var fn = c.api === "anthropic" ? chatAnthropic
             : c.api === "ollama" ? chatOllama : chatOpenAI;
      return fn(c, messages, opts).catch(function (e) {
        if (e && e.name === "AbortError") throw e;
        /* A browser CORS rejection surfaces as an opaque TypeError, which is
           useless on its own -- name the likely cause instead. */
        if (e instanceof TypeError) {
          /* The browser gives an opaque TypeError for both "nothing is
             listening" and "CORS refused" -- it deliberately will not tell a
             page which. Name both, most likely first for a local endpoint. */
          var local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(c.baseUrl);
          throw new Error(
            "Could not reach " + c.baseUrl + ". Either nothing is listening there" +
            (local ? " (is the server actually running?)" : "") +
            ", or the provider refused the request from this page's origin (CORS). " +
            "The browser will not say which. Local servers usually need CORS " +
            "enabled explicitly: Ollama OLLAMA_ORIGINS, LM Studio has a toggle.");
        }
        throw e;
      });
    }
  };
})();
