#!/usr/bin/env python3
"""Bundle index.html + css/ + js/ + assets/ into one self-contained dist.html.

Usage: python3 build.py
"""
import base64, hashlib, json, pathlib, re

ROOT = pathlib.Path(__file__).resolve().parent
MIME = {".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".gif": "image/gif"}


def data_uri(rel):
    p = ROOT / rel
    return "data:%s;base64,%s" % (MIME[p.suffix.lower()], base64.b64encode(p.read_bytes()).decode())


def swap(html, old, new):
    if old not in html:
        raise SystemExit("build.py: expected to find %r in index.html" % old)
    return html.replace(old, new)


index = json.loads((ROOT / "assets/asset_index.json").read_text("utf8"))
files = {}
for cfg in index["order"]:
    for layer, names in index[cfg].items():
        for name in names:
            rel = "assets/img/%s/%s/%s" % (cfg, layer, name)
            files[rel] = data_uri(rel)
files["assets/img/cult_coin.png"] = data_uri("assets/img/cult_coin.png")

script = "\n".join([
    "window.INLINE_ASSET_INDEX=" + json.dumps(index, separators=(",", ":")) + ";",
    "window.INLINE_FILES=" + json.dumps(files, separators=(",", ":")) + ";",
    (ROOT / "js/data.js").read_text("utf8"),
    (ROOT / "js/fx.js").read_text("utf8"),
    (ROOT / "js/game.js").read_text("utf8"),
    (ROOT / "js/ambient.js").read_text("utf8"),
    (ROOT / "js/music.js").read_text("utf8"),
])

# Stamp the page with a version made from the code itself, so a browser never runs an old script against a new
# page: index.html asks for js/game.js?v=<stamp>, and version.json lets an open tab notice that it has gone stale.
stamp = hashlib.sha256(b"".join((ROOT / f).read_bytes() for f in ("js/data.js", "js/fx.js", "js/game.js", "js/ambient.js", "js/music.js", "css/style.css"))).hexdigest()[:10]
page = (ROOT / "index.html").read_text("utf8")
stamped = re.sub(r'(href="css/style\.css|src="js/data\.js|src="js/fx\.js|src="js/game\.js|src="js/ambient\.js|src="js/music\.js)(\?v=[0-9a-f]+)?"', lambda m: m.group(1) + "?v=" + stamp + '"', page)
if stamped != page:
    (ROOT / "index.html").write_text(stamped, "utf8")
(ROOT / "version.json").write_text(json.dumps({"v": stamp}) + "\n", "utf8")
# the service worker keeps this version's code for offline play: a new stamp is a new worker, and the old one's cache goes
sw = (ROOT / "sw.js").read_text("utf8")
sw_stamped = re.sub(r'const V = "[0-9a-f]+";', 'const V = "%s";' % stamp, sw)
if sw_stamped != sw:
    (ROOT / "sw.js").write_text(sw_stamped, "utf8")

html = re.sub(r'\?v=[0-9a-f]+"', '"', stamped)
html = swap(html, '<link rel="stylesheet" href="css/style.css">',
            "<style>\n" + (ROOT / "css/style.css").read_text("utf8") + "</style>")
html = swap(html, '<script src="js/data.js"></script>\n', "")
html = swap(html, '<script src="js/fx.js"></script>\n', "")
html = swap(html, '<script src="js/ambient.js"></script>\n', "")
html = swap(html, '<script src="js/music.js"></script>', "")
html = swap(html, '<script src="js/game.js"></script>', "<script>\n" + script + "\n</script>")
sister = "assets/img/cancel.png"  # the companion game's badge, in the title screen and the header
html = swap(html, 'src="%s"' % sister, 'src="%s"' % data_uri(sister))
for icon in ("assets/icons/favicon-32.png", "assets/icons/icon-192.png"):
    html = swap(html, 'href="%s"' % icon, 'href="%s"' % data_uri(icon))

(ROOT / "dist.html").write_text(html, "utf8")

# the service checks grass spent on perks against grass earned, so it needs to know what each perk costs
data_js = (ROOT / "js/data.js").read_text("utf8")
perks_src = data_js[data_js.index("const PERKS = ["):]
perks_src = perks_src[:perks_src.index("];")]
perks = {m.group(1): int(m.group(2)) for m in re.finditer(r'\{ id:"(\w+)",[^\n]*?cost:(\d+)', perks_src)}
ch_src = data_js[data_js.index("const CHALLENGES"):]
challenges = re.findall(r'\{ id:"(\w+)"', ch_src[:ch_src.index("];")])
(ROOT / "server/net_spec.json").write_text(json.dumps({"perks": perks, "challenges": challenges}, indent=1) + "\n", "utf8")
print("dist.html: %.1f MB, %d inlined assets, version %s" % (len(html.encode()) / 1e6, len(files), stamp))
