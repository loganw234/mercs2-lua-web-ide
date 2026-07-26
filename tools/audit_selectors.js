/* audit_selectors.js -- find CSS class-name collisions of the kind that produced
 * the 48px grab bar.
 *
 * THE BUG THIS EXISTS FOR. The dock built its direction modifier as a bare word:
 *
 *     box.className = "dsplit " + node.dir;      // -> "dsplit row"
 *
 * and the results list happens to style a bare `.row`. So every horizontal split
 * and every vertical gutter silently inherited `padding: 5px 48px 5px 0` and a
 * border-bottom -- gutters rendered 48px wide instead of 6, and each row split
 * lost 48px off its right edge. `.col` has no such rule, which is exactly why
 * only the vertical bars looked wrong and nobody suspected CSS.
 *
 * WHAT IT LOOKS FOR. Not "generic class names" -- shared utilities like `.btn`,
 * `.hidden` and `.spacer` are deliberate and land everywhere by design. The
 * signature is narrower: a class worn as a SECONDARY modifier on one component
 * that also carries a BARE rule of its own authored for a different component.
 * Base + specific layering within one subsystem (`btn small go exload`,
 * `ai-note ai-profnote`) is normal and is reported separately as expected.
 *
 * Run:  node tools/audit_selectors.js      (needs tools/vendor/node_modules)
 * Exits non-zero only on an UNEXPECTED pairing, so it can gate CI later.
 */
const fs = require("fs");
const path = require("path");

/* jsdom lives in tools/vendor (the same install smoke.js uses), so resolve it
   from there rather than requiring the caller to set NODE_PATH. */
let JSDOM, VirtualConsole;
try {
  ({ JSDOM, VirtualConsole } = require("jsdom"));
} catch (e) {
  try {
    ({ JSDOM, VirtualConsole } =
      require(path.join(__dirname, "vendor", "node_modules", "jsdom")));
  } catch (e2) {
    console.error("jsdom not found. Install it once:  cd tools/vendor && npm install");
    process.exit(2);
  }
}

/* Pairs already reviewed and understood: base class + specific class inside one
   component. Add to this list only after checking the two rules really are meant
   to compose. */
const EXPECTED = new Set([
  "hlrulerow+hladdrow",   // the "add a rule" row IS a rule row, with extra spacing
  "btn+exload",           // button base + the examples card's show-on-open rule
  "ai-note+ai-profnote",  // note base + a smaller variant
]);

const DIST = path.join(__dirname, "..", "dist", "index.html");
if (!fs.existsSync(DIST)) {
  console.error("No dist/index.html -- run `python build.py` first.");
  process.exit(2);
}
const html = fs.readFileSync(DIST, "utf8");

const dom = new JSDOM(html, {
  runScripts: "dangerously", url: "http://127.0.0.1:27050/", pretendToBeVisual: true,
  virtualConsole: new VirtualConsole(),
  beforeParse(w) {
    const r = () => ({ top:0, bottom:0, left:0, right:0, width:0, height:0, x:0, y:0 });
    w.Range.prototype.getClientRects = function () { const l=[r()]; l.item=i=>l[i]; return l; };
    w.Range.prototype.getBoundingClientRect = r;
    w.Element.prototype.getClientRects = function () { const l=[r()]; l.item=i=>l[i]; return l; };
    w.Element.prototype.scrollIntoView = function () {};
    w.WebSocket = class { constructor(){ setTimeout(()=>this.onclose&&this.onclose({}),5); } send(){} close(){} };
    w.fetch = () => Promise.resolve({ ok:true, json:()=>Promise.resolve({}) });
  },
});

setTimeout(() => {
  const D = dom.window.document;
  const css = html.slice(html.indexOf("<style>") + 7, html.indexOf("</style>"));

  /* Classes with a rule of their own written as a bare `.foo{...}` -- the only
     ones that can leak onto anything else wearing the same word. */
  const bare = new Set();
  let m, re = /([^{}]+)\{([^{}]*)\}/g;
  while ((m = re.exec(css))) {
    if (!m[2].trim()) continue;
    for (const part of m[1].split(",")) {
      const t = /^\s*\.([A-Za-z][\w-]*)\s*$/.exec(part);
      if (t) bare.add(t[1]);
    }
  }

  const UTILITIES = new Set(["hidden"]);   // deliberately applied to anything

  const pairs = new Map();                 // "primary+modifier" -> count
  for (const el of D.querySelectorAll("*")) {
    const cls = [...el.classList];
    if (cls.length < 2) continue;
    const [primary, ...mods] = cls;
    for (const mod of mods) {
      if (!bare.has(mod) || UTILITIES.has(mod)) continue;
      const key = primary + "+" + mod;
      pairs.set(key, (pairs.get(key) || 0) + 1);
    }
  }

  const unexpected = [...pairs.keys()].filter(k => !EXPECTED.has(k));
  const expected = [...pairs.keys()].filter(k => EXPECTED.has(k));

  console.log("Class-collision audit (the .row shape)\n");
  if (expected.length) {
    console.log("Reviewed and expected (base + specific within one component):");
    expected.forEach(k => console.log("  ok    ." + k.replace("+", "  +  .")));
    console.log("");
  }
  if (!unexpected.length) {
    console.log("[ok] No unexpected collisions: every secondary class either has no bare");
    console.log("     rule of its own, is a known utility, or is a reviewed pairing.");
    process.exit(0);
  }
  console.log("UNEXPECTED -- a component is wearing another component's styled class:");
  unexpected.forEach(k => {
    const [p, mod] = k.split("+");
    console.log(`  RISK  .${p} also wears .${mod}  (${pairs.get(k)} element(s))`);
    console.log(`        Either namespace the modifier (the dock now uses d-row/d-col),`);
    console.log(`        or add "${k}" to EXPECTED if the two rules are meant to compose.`);
  });
  process.exit(1);
}, 500);
