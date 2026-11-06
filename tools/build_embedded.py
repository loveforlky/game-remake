import base64, io, os, re
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ITEMS = os.path.join(ROOT, "assets", "items")
manifest = open(os.path.join(ITEMS, "manifest.js"), encoding="utf-8").read()

entries = []
pattern = re.compile(
    r"name:\s*'([^']*)'.*?c1:\s*'([^']*)',\s*c2:\s*'([^']*)'", re.S)
for m in pattern.finditer(manifest):
    entries.append({"name": m.group(1), "c1": m.group(2), "c2": m.group(3)})

if len(entries) != 11:
    raise SystemExit("expected 11 entries, got %d" % len(entries))

lines = [
    "/* 内嵌形象：11 张图以 base64 JPEG 直接写在 JS 里，",
    " * 页面不请求任何图片文件，避免手机端图片加载/缓存问题。",
    " * 由 tools/build_embedded.py 生成。",
    " */",
    "window.ITEM_ASSETS = [",
]

total = 0
for i, e in enumerate(entries, start=1):
    png = os.path.join(ITEMS, "%02d.png" % i)
    im = Image.open(png).convert("RGBA")
    bg = Image.new("RGBA", im.size, (255, 243, 224, 255))
    bg.alpha_composite(im)
    bg = bg.convert("RGB").resize((384, 384), Image.LANCZOS)
    buf = io.BytesIO()
    bg.save(buf, "JPEG", quality=86, optimize=True)
    raw = buf.getvalue()
    total += len(raw)
    uri = "data:image/jpeg;base64," + base64.b64encode(raw).decode("ascii")
    lines.append(
        "  { name: '%s', file: '%s', crop: 'circle', c1: '%s', c2: '%s' }," %
        (e["name"], uri, e["c1"], e["c2"])
    )

lines.append("];")
out = os.path.join(ITEMS, "embedded.js")
with open(out, "w", encoding="utf-8") as f:
    f.write("\n".join(lines) + "\n")

print("written", out, "jpeg bytes", total, "file KB", os.path.getsize(out) // 1024)
