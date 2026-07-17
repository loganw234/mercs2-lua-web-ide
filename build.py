#!/usr/bin/env python3
"""build.py -- merge src/ into ONE standalone dist/index.html.

Inlines everything (CSS, the generated Ess API JSON, the vendored ess-bridge.js, and every app/*.js) so
the output is a single self-contained file with zero external requests. That one file works three ways:
  * hosted on GitHub Pages (open the URL),
  * downloaded and opened straight off disk (file://),
  * served by the lua-bridge itself at http://127.0.0.1:27050/ (the bulletproof, all-browsers path).

Edit files under src/ (or regenerate the API with tools/gen_api.py), then re-run:  python build.py
"""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent
SRC = ROOT / "src"


def guard(s):
    # never let inlined content close the <script>/<style> early
    return s.replace("</script", "<\\/script").replace("</style", "<\\/style")


def main():
    html = (SRC / "index.html").read_text(encoding="utf-8")
    css = (SRC / "styles.css").read_text(encoding="utf-8")
    api = (SRC / "data" / "ess-api.json").read_text(encoding="utf-8")

    parts = [(SRC / "lib" / "ess-bridge.js").read_text(encoding="utf-8")]
    for p in sorted((SRC / "app").glob("*.js")):
        parts.append("/* ==== %s ==== */\n%s" % (p.name, p.read_text(encoding="utf-8")))
    app = "\n".join(parts)

    html = (html
            .replace("/*__CSS__*/", guard(css))
            .replace("/*__API__*/", "window.ESS_API=" + guard(api) + ";")
            .replace("/*__APP__*/", guard(app)))

    out = ROOT / "dist" / "index.html"
    out.parent.mkdir(exist_ok=True)
    out.write_text(html, encoding="utf-8")
    print("[build] wrote %s (%d KB, %d app modules)" % (out, out.stat().st_size // 1024, len(parts) - 1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
