/* 30_run.js -- run the selection (if any) or the whole file, and route the result to the Results panel. */
(function () {
  var IDE = window.IDE;
  function run() {
    var code = (IDE.editor.selection() || IDE.editor.get()).trim();
    if (!code) return;
    IDE.console.pending(code);
    IDE.bridge.run(code).then(function (r) { IDE.console.result(r); });
  }
  IDE.run = run;
  IDE.bus.on("run", run);
})();
