/* 30_run.js -- run the selection (if any) or the whole file. Before anything leaves the page, the code
   goes through IDE.lint: a syntax error BLOCKS the run with a plain-English message (and jumps the caret
   there) -- a beginner should never wonder why the game ignored a script that could not have parsed.
   Warnings never block. */
(function () {
  var IDE = window.IDE;
  function run() {
    var sel = IDE.editor.selection(), code = (sel || IDE.editor.get()).trim();
    if (!code) return;

    if (IDE.lint) {
      var v = IDE.lint.validate(code);
      if (v.errors.length) {
        var e = v.errors[0];
        IDE.console.pending(code);
        IDE.console.result({ ok: false, error: "didn't send it — line " + e.line + ": " + e.message });
        if (!sel) IDE.editor.jumpTo(e.line, e.col);
        IDE.editor.relint();
        return;
      }
    }

    if (!IDE.bridge.connected()) {
      IDE.console.pending(code);
      IDE.console.result({ ok: false, error: "not connected to the game — hit Connect (top right). Green dot = live, then Run again." });
      return;
    }

    IDE.console.pending(code);
    IDE.bridge.run(code).then(function (r) { IDE.console.result(r); });
  }
  IDE.run = run;
  IDE.bus.on("run", run);
})();
