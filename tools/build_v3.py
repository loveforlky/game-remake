import base64, io, os, re
from pathlib import Path
from PIL import Image

ROOT = Path(r"C:\Users\Lenovo\Desktop\hecheng")
SRC = ROOT / "new"
OUT = ROOT / "v3"
SIZE = 384

# 自然排序（242, 243, ..., 252）
def key(p):
    m = re.search(r"_(\d{3})_", p.name)
    return int(m.group(1)) if m else p.name

files = sorted([p for p in SRC.iterdir() if p.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp")], key=key)
if len(files) != 11:
    raise SystemExit("expected 11 images, got %d" % len(files))

def fit_cutout(im):
    im = im.convert("RGBA")
    bbox = im.getchannel("A").getbbox()
    if bbox:
        im = im.crop(bbox)
    inner = int(SIZE * 0.98)
    im.thumbnail((inner, inner), Image.LANCZOS)
    canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    canvas.paste(im, ((SIZE - im.width) // 2, (SIZE - im.height) // 2), im)
    return canvas

def colors(im):
    small = im.resize((32, 32), Image.LANCZOS)
    px = small.load()
    rs = gs = bs = wsum = 0.0
    for y in range(32):
        for x in range(32):
            r, g, b, a = px[x, y]
            if a < 90:
                continue
            w = a / 255.0
            rs += r * w; gs += g * w; bs += b * w; wsum += w
    if not wsum:
        return "#ffd9c4", "#ff7d6b"
    import colorsys
    r, g, b = rs / wsum / 255, gs / wsum / 255, bs / wsum / 255
    h, s, v = colorsys.rgb_to_hsv(r, g, b)
    s = min(1.0, max(0.32, s * 1.15))
    v = min(1.0, max(0.62, v))
    def hx(hh, ss, vv):
        rr, gg, bb = colorsys.hsv_to_rgb(hh, ss, vv)
        return "#%02x%02x%02x" % (round(rr * 255), round(gg * 255), round(bb * 255))
    return hx(h, max(0, s * 0.55), min(1, v + 0.30)), hx(h, min(1, s * 1.05), max(0.2, v - 0.12))

entries = []
for p in files:
    im = Image.open(p)
    tile = fit_cutout(im)
    buf = io.BytesIO()
    tile.save(buf, "PNG", optimize=True)
    uri = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")
    c1, c2 = colors(tile)
    code = key(p)
    entries.append(
        "  { name: '形态 %s', file: '%s', crop: 'none', c1: '%s', c2: '%s' },"
        % (code, uri, c1, c2)
    )
    print("item", code, "png KB", len(buf.getvalue()) // 1024, c1, c2)

embedded = "/* 内嵌大头贴：透明 PNG，直接用脸作为球 */\nwindow.ITEM_ASSETS = [\n" + "\n".join(entries) + "\n];\n"

html = (ROOT / "v2.html").read_text(encoding="utf-8")
css = (ROOT / "style.css").read_text(encoding="utf-8")
game = (ROOT / "game.js").read_text(encoding="utf-8")

game = game.replace("const BUILD = '20261106e';", "const BUILD = '20261107a';")
game = game.replace("title:    '合成大作战'", "title:    '合成小啊伟'")
game = game.replace("subtitle: '相同的撞在一起，越合越大'", "subtitle: '换了一批新面孔，相同的撞在一起'")

html = re.sub(r'<link rel="stylesheet" href="style\.css[^"]*">', "<style>\n" + css + "\n</style>", html)
html = re.sub(r'<script src="assets/items/embedded\.js[^"]*"></script>', "<script>\n" + embedded + "\n</script>", html)
html = re.sub(r'<script src="game\.js[^"]*"></script>', "<script>\n" + game + "\n</script>", html)
html = html.replace("<title>合成大作战 · 内嵌版</title>", "<title>合成小啊伟</title>")

OUT.mkdir(exist_ok=True)
(OUT / "index.html").write_text(html, encoding="utf-8")
print("written", OUT / "index.html", (OUT / "index.html").stat().st_size // 1024, "KB")
